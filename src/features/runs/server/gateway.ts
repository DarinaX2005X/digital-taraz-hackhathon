import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RunError } from '../domain/errors';
import { RUN_LIMITS } from '../domain/limits';
import { exceedsUsd, usdString } from '../domain/money';
import type { BudgetLedger } from './budget';
import { boundedObject, hash, hashKey, type JsonObject, type RunFence } from './data';
import { validatePricing, type PricingSnapshot } from './pricing';
import { assertModelRoute, type ModelRoute } from './model-policy';

export interface AuthorizedImage {
  bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' | 'image/webp'; sha256: string;
  sourceVersionId: string; pageId: string;
}
export interface ModelToolCall { id: string; name: string; arguments: string }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; toolCallId?: string; toolCalls?: ModelToolCall[] }
export interface ModelRequest {
  fence: RunFence; operationKey: string; messages: ModelMessage[]; maxOutputTokens: number;
  jsonSchema?: { name: string; schema: JsonObject }; tools?: { name: string; description: string; parameters: JsonObject }[];
  toolChoice?: 'auto' | 'required'; images?: AuthorizedImage[]; signal?: AbortSignal;
}
export const ModelOutputSchema = z.strictObject({
  content: z.string().max(100_000).nullable(),
  toolCalls: z.array(z.strictObject({ id: z.string().min(1).max(128), name: z.string().min(1).max(100), arguments: z.string().max(32_768) })).max(20),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export interface GatewayOptions {
  ledger: BudgetLedger; apiKey: string; authorizationId: string; pricing: () => Promise<PricingSnapshot>;
  fetch?: typeof fetch; safe429Retries?: 0 | 1 | 2; allowedRoutes?: readonly ModelRoute[]; proofRunId?: string;
}
const usageSchema = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), cost: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)]), prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }).optional() });
const responseSchema = z.object({
  id: z.string().min(1).max(160), model: z.string().min(1).max(128),
  choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({
    content: z.string().max(100_000).nullable().optional(), tool_calls: z.array(z.object({ id: z.string().min(1).max(128), type: z.literal('function'), function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(32_768) }) })).max(20).optional(),
  }) })).length(1), usage: usageSchema,
});
async function readBody(response: Response, maximum = RUN_LIMITS.providerResponseBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new RunError('invalid_result');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) throw new RunError('invalid_result');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => undefined); }
}
function imageData(image: AuthorizedImage) {
  if (!image.bytes.length || image.bytes.length > 10_485_760 || !z.uuid().safeParse(image.sourceVersionId).success || !image.pageId || image.pageId.length > 100) throw new RunError('invalid_result');
  const data = Buffer.from(image.bytes);
  const detected = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'image/jpeg' : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (detected !== image.mime || createHash('sha256').update(data).digest('hex') !== image.sha256) throw new RunError('invalid_result');
  // The byte digest is checked separately from provenance, which the source service authorizes.
  return { type: 'image_url', image_url: { url: `data:${image.mime};base64,${data.toString('base64')}` } };
}
export function createModelGateway(options: GatewayOptions) {
  const send = options.fetch ?? fetch;
  async function complete(request: ModelRequest): Promise<ModelOutput> {
    if (request.signal?.aborted) throw new RunError('cancelled');
    z.string().min(1).max(90).regex(/^[A-Za-z0-9_-]+$/).parse(request.operationKey);
    z.number().int().min(1).max(100_000).parse(request.maxOutputTokens);
    const callSchema = z.strictObject({ id: z.string().min(1).max(128), name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), arguments: z.string().max(32_768) });
    const messages = z.array(z.strictObject({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string().max(200_000).nullable(), toolCallId: z.string().min(1).max(128).optional(), toolCalls: z.array(callSchema).min(1).max(20).optional() }).refine((message) => (
      (message.role === 'assistant' || message.toolCalls === undefined)
      && (message.role === 'tool' ? message.toolCallId !== undefined && message.content !== null : message.toolCallId === undefined)
      && (message.content !== null || (message.role === 'assistant' && message.toolCalls !== undefined))
    ))).min(1).max(100).parse(request.messages);
    if (Buffer.byteLength(JSON.stringify(messages)) > 524_288 || (request.images?.length ?? 0) > 4) throw new RunError('invalid_result');
    const modelTools = request.tools ? z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), description: z.string().min(1).max(2000), parameters: z.record(z.string(), z.unknown()) })).min(1).max(30).parse(request.tools).map((tool) => ({ ...tool, parameters: boundedObject(tool.parameters) })) : [];
    if (request.toolChoice && !modelTools.length) throw new RunError('unsupported_parameters');
    const toolChoice = modelTools.length ? z.enum(['auto', 'required']).parse(request.toolChoice ?? 'auto') : null;
    const images = request.images?.map(imageData) ?? [];
    if (images.length && messages.at(-1)?.role !== 'user') throw new RunError('unsupported_parameters');
    const structured = request.jsonSchema ? { name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).parse(request.jsonSchema.name), schema: boundedObject(request.jsonSchema.schema) } : null;
    const inputHash = hash({ messages, maxOutputTokens: request.maxOutputTokens, tools: modelTools, toolChoice, structured, images: request.images?.map((image) => ({ sha256: image.sha256, mime: image.mime, sourceVersionId: image.sourceVersionId, pageId: image.pageId })) ?? [] });
    const previous = await options.ledger.lookupOperation({ fence: request.fence, operationKey: request.operationKey, inputHash });
    if (previous?.usage.state === 'succeeded') {
      if (!previous.output) throw new RunError('invalid_result');
      return ModelOutputSchema.parse(previous.output);
    }
    if (!options.apiKey || !options.authorizationId) throw new RunError('configuration');
    const parameters = ['max_tokens', ...(structured ? ['response_format'] : []), ...(modelTools.length ? ['tools', 'tool_choice'] : [])];
    const pricing = await options.pricing();
    assertModelRoute(pricing, options.allowedRoutes);
    const { price, reservedUsd } = validatePricing(pricing, { kind: 'text', maxOutputTokens: request.maxOutputTokens, parameters, candidateProof: options.proofRunId === request.fence.runId });
    if (images.length && !price.vision) throw new RunError('unsupported_parameters');
    const providerMessages = messages.map((message, index) => ({ role: message.role, content: images.length && index === messages.length - 1 ? [{ type: 'text', text: message.content }, ...images] : message.content, ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}), ...(message.toolCalls ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) }));
    const body: JsonObject = {
      model: price.model, messages: structured && price.jsonMode !== 'json_schema' ? [{ role: 'system', content: `Return one JSON object matching this schema. The application validates the result: ${JSON.stringify(structured.schema)}` }, ...providerMessages] : providerMessages,
      max_tokens: request.maxOutputTokens, stream: false,
      provider: { only: [price.endpoint], allow_fallbacks: false, require_parameters: true, max_price: { prompt: new Decimal(price.inputUsd).times(1_000_000).toNumber(), completion: new Decimal(price.outputUsd).times(1_000_000).toNumber() }, ...(price.quantization ? { quantizations: [price.quantization] } : {}) },
      ...(price.supportedParameters.includes('reasoning') ? { reasoning: { enabled: false } } : {}),
      ...(price.supportedParameters.includes('include_reasoning') ? { include_reasoning: false } : {}),
      ...(structured ? { response_format: price.jsonMode === 'json_schema' ? { type: 'json_schema', json_schema: { name: structured.name, strict: true, schema: structured.schema } } : { type: 'json_object' } } : {}),
      ...(modelTools.length ? { tools: modelTools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: toolChoice } : {}),
    };
    for (let attempt = 0; attempt <= (options.safe429Retries ?? 0); attempt++) {
      if (request.signal?.aborted) throw new RunError('cancelled');
      const reservation = await options.ledger.reserve({ fence: request.fence, operationKey: request.operationKey, attemptKey: `${request.operationKey}_${request.fence.epoch}_${attempt}`, inputHash, reservedUsd, pricing: price, maxOutputTokens: request.maxOutputTokens, authorizationId: options.authorizationId, keyFingerprint: hashKey(options.apiKey) });
      if (reservation.usage.state === 'succeeded') {
        if (!reservation.output) throw new RunError('invalid_result');
        return ModelOutputSchema.parse(reservation.output);
      }
      try { await options.ledger.dispatch(request.fence, reservation.usage.id); }
      catch (error) { await options.ledger.releaseUndispatched({ runId: request.fence.runId, usageId: reservation.usage.id }); throw error; }
      const timeout = AbortSignal.timeout(RUN_LIMITS.modelDeadlineMs);
      const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
      let settled = false;
      try {
        const response = await send('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
        if (response.status === 429) {
          await response.body?.cancel();
          await options.ledger.settle(reservation.usage.id, { state: 'released', knownRejected: true });
          settled = true;
          if (attempt < (options.safe429Retries ?? 0)) {
            await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt) + Math.floor(Math.random() * 150)));
            continue;
          }
          throw new RunError('provider');
        }
        if (!response.ok) { await response.body?.cancel(); throw new RunError('provider'); }
        const raw = await readBody(response);
        const parsed = responseSchema.safeParse(raw);
        const usage = z.object({ usage: usageSchema, id: z.string().min(1).max(160) }).safeParse(raw);
        if (!usage.success) throw new RunError('ambiguous_charge');
        const actualUsd = usdString(new Decimal(usage.data.usage.cost));
        const choice = parsed.success ? parsed.data.choices[0] : undefined;
        let output = choice && parsed.success && [price.model, price.canonicalModel].includes(parsed.data.model) && !['length', 'content_filter', 'error'].includes(choice.finish_reason ?? '')
          ? ModelOutputSchema.safeParse({ content: choice.message.content ?? null, toolCalls: choice.message.tool_calls?.map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })) ?? [] }) : null;
        if (output?.success && ((!output.data.content && !output.data.toolCalls.length) || output.data.toolCalls.some((call) => !request.tools?.some((tool) => tool.name === call.name)))) output = null;
        if (output?.success) {
          try {
            boundedObject(output.data, 131_072);
            for (const call of output.data.toolCalls) boundedObject(JSON.parse(call.arguments));
            if (structured) boundedObject(JSON.parse(output.data.content ?? ''));
          } catch { output = null; }
        }
        const overrun = exceedsUsd(reservation.usage.reserved_usd, actualUsd);
        await options.ledger.settle(reservation.usage.id, { state: 'succeeded', actualUsd, inputTokens: usage.data.usage.prompt_tokens, outputTokens: usage.data.usage.completion_tokens, cachedInputTokens: usage.data.usage.prompt_tokens_details?.cached_tokens, providerRequestId: usage.data.id, ...(output?.success && !overrun ? { output: output.data } : {}) });
        settled = true;
        if (overrun) throw new RunError('price_exceeded');
        if (!output?.success || (!output.data.content && !output.data.toolCalls.length)) throw new RunError('invalid_result');
        return output.data;
      } catch (error) {
        if (!settled) await options.ledger.settle(reservation.usage.id, { state: 'ambiguous' });
        if (error instanceof RunError) throw error;
        throw new RunError(signal.aborted ? 'provider_timeout' : 'ambiguous_charge');
      }
    }
    throw new RunError('provider');
  }
  return { complete };
}
export type ModelGateway = ReturnType<typeof createModelGateway>;
