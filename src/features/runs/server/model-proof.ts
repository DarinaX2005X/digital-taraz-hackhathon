import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { RunError } from '../domain/errors';
import type { JsonObject } from './data';
import { applicationModelGateway } from './model-runtime';
import { MODEL_PROOF_CAPABILITY } from './model-policy';
import { ModelOutputSchema, type ModelGateway } from './gateway';
import type { RunCapability, RunTool } from './registry';

const policy = { scope: 'edit' as const, confidential: false };
const empty = z.strictObject({});
const operands = z.strictObject({ quantity: z.number().int().min(2).max(99), unitPrice: z.number().int().min(2).max(999) });
const proofInput = operands.extend({ marker: z.string().regex(/^[A-Z0-9]{8}$/) });
const argumentsSchema = proofInput;
const finalSchema = proofInput.extend({ total: z.number().int().positive() });
const toolDefinition = { name: 'multiply_receipt', description: 'Calculate the total using the exact quantity, unit price and marker visible in the synthetic image.', parameters: { type: 'object', properties: { quantity: { type: 'integer' }, unitPrice: { type: 'integer' }, marker: { type: 'string' } }, required: ['quantity', 'unitPrice', 'marker'], additionalProperties: false } };
const finalJson: JsonObject = { type: 'object', properties: { quantity: { type: 'integer' }, unitPrice: { type: 'integer' }, marker: { type: 'string' }, total: { type: 'integer' } }, required: ['quantity', 'unitPrice', 'marker', 'total'], additionalProperties: false };
const visionPrompt = 'This is a synthetic runtime verification image, not customer data. Read its quantity, unit price, and marker. Call multiply_receipt exactly once with those values. Do not calculate the total yourself.';

export function modelProofRegistration(pool: Pool, gateway: (runId: string) => ModelGateway = (runId) => applicationModelGateway(pool, runId)): { capability: RunCapability; tools: RunTool[] } {
  return {
    capability: {
      id: MODEL_PROOF_CAPABILITY, version: 1, publicStart: false, policy,
      initialize: (_input, privateInput) => {
        const proof = proofInput.parse(privateInput);
        return { context: { synthetic: true, proof, imageSourceId: randomUUID() }, steps: [
          { tool: 'runtime.proof-vision', version: 1, action: 'read_sources', input: {} },
          { tool: 'runtime.proof-multiply', version: 1, action: 'calculate', input: {} },
          { tool: 'runtime.proof-result', version: 1, action: 'validate', input: {} },
        ] };
      },
    },
    tools: [
      {
        name: 'runtime.proof-vision', version: 1, purpose: 'Verify image reading and a real typed model tool request', input: empty, output: ModelOutputSchema, policy, costClass: 'model', deadlineMs: 60_000, idempotency: 'receipt',
        prepare: async (_input, context) => {
          const proof = proofInput.parse(context.context.proof);
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="white"/><g font-family="Arial" font-size="30" fill="black"><text x="32" y="52">SYNTHETIC RECEIPT</text><text x="32" y="105">Quantity: ${proof.quantity}</text><text x="32" y="150">Unit price: ${proof.unitPrice}</text><text x="32" y="200">Marker: ${proof.marker}</text></g></svg>`;
          const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
          return gateway(context.fence.runId).complete({ fence: context.fence, operationKey: 'proof_vision', messages: [{ role: 'user', content: visionPrompt }], images: [{ bytes, mime: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex'), sourceVersionId: z.uuid().parse(context.context.imageSourceId), pageId: 'synthetic-receipt' }], tools: [toolDefinition], toolChoice: 'required', maxOutputTokens: 500, signal: context.signal });
        },
        execute: async (_tx, _input, prepared, context) => {
          const output = ModelOutputSchema.parse(prepared);
          const call = output.toolCalls[0];
          if (output.toolCalls.length !== 1 || !call || call.name !== 'multiply_receipt') throw new RunError('invalid_result');
          const args = argumentsSchema.parse(JSON.parse(call.arguments));
          const expected = proofInput.parse(context.context.proof);
          if (args.quantity !== expected.quantity || args.unitPrice !== expected.unitPrice || args.marker !== expected.marker) throw new RunError('invalid_result');
          return { output, context: { ...context.context, vision: output } };
        },
      },
      {
        name: 'runtime.proof-multiply', version: 1, purpose: 'Execute the typed multiplication tool and persist its receipt', input: empty, output: finalSchema, policy, costClass: 'local', deadlineMs: 30_000, idempotency: 'receipt',
        execute: async (_tx, _input, _prepared, context) => {
          const vision = ModelOutputSchema.parse(context.context.vision);
          const args = argumentsSchema.parse(JSON.parse(vision.toolCalls[0]?.arguments ?? ''));
          const result = { ...args, total: args.quantity * args.unitPrice };
          return { output: result, context: { ...context.context, toolResult: result } };
        },
      },
      {
        name: 'runtime.proof-result', version: 1, purpose: 'Verify a strict JSON response using the actual local tool result', input: empty, output: finalSchema, policy, costClass: 'model', deadlineMs: 60_000, idempotency: 'receipt',
        prepare: async (_input, context) => {
          const vision = ModelOutputSchema.parse(context.context.vision);
          const result = finalSchema.parse(context.context.toolResult);
          const call = vision.toolCalls[0];
          if (!call) throw new RunError('invalid_result');
          const output = await gateway(context.fence.runId).complete({ fence: context.fence, operationKey: 'proof_result', messages: [
            { role: 'user', content: 'Return the verified receipt as JSON, copying the actual multiply_receipt tool result. Do not call more tools.' },
            { role: 'assistant', content: vision.content, toolCalls: vision.toolCalls },
            { role: 'tool', content: JSON.stringify(result), toolCallId: call.id },
          ], jsonSchema: { name: 'verified_receipt', schema: finalJson }, maxOutputTokens: 500, signal: context.signal });
          if (output.toolCalls.length) throw new RunError('invalid_result');
          return finalSchema.parse(JSON.parse(output.content ?? ''));
        },
        execute: async (_tx, _input, prepared, context) => {
          const result = finalSchema.parse(prepared), expected = finalSchema.parse(context.context.toolResult);
          if (result.total !== expected.total || result.quantity !== expected.quantity || result.unitPrice !== expected.unitPrice || result.marker !== expected.marker) throw new RunError('invalid_result');
          return { output: result, context: { ...context.context, verified: result }, state: 'completed' };
        },
      },
    ],
  };
}
