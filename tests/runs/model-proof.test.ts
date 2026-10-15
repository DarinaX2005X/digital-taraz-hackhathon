import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { modelProofRegistration } from '../../src/features/runs/server/model-proof';
import type { ModelRequest } from '../../src/features/runs/server/gateway';
import type { ToolContext } from '../../src/features/runs/server/registry';

const proof = { quantity: 7, unitPrice: 123, marker: 'A1B2C3D4' };
const expected = { ...proof, total: 861 };
function fixture() {
  const complete = vi.fn(async (request: ModelRequest) => request.operationKey === 'proof_vision'
    ? { content: null, toolCalls: [{ id: 'call_test', name: 'multiply_receipt', arguments: JSON.stringify(proof) }] }
    : { content: JSON.stringify(expected), toolCalls: [] });
  const registration = modelProofRegistration({} as Pool, () => ({ complete }));
  const initial = registration.capability.initialize({ workspaceId: randomUUID(), projectId: null, capabilityId: registration.capability.id, capabilityVersion: 1, goal: 'Synthetic', locale: 'en', inputRefs: [] }, proof);
  const context: ToolContext = { fence: { runId: randomUUID(), stepId: randomUUID(), epoch: 1, leaseOwner: randomUUID() }, workspaceId: randomUUID(), projectId: null, userId: randomUUID(), authzVersion: 1, context: initial.context, signal: new AbortController().signal, checkpoint: async () => { throw new Error('unused'); } };
  return { complete, registration, context };
}
describe('private model proof', () => {
  it('requires vision, executes typed local math, and passes its actual result to a second model call', async () => {
    const { registration, complete, context } = fixture();
    expect(registration.capability.publicStart).toBe(false);
    for (const tool of registration.tools) {
      const prepared = await tool.prepare?.({}, context);
      const outcome = await tool.execute({} as PoolClient, {}, prepared, context);
      tool.output.parse(outcome.output);
      context.context = outcome.context ?? context.context;
    }
    expect(complete).toHaveBeenCalledTimes(2);
    const first = complete.mock.calls[0]?.[0];
    expect(first?.messages[0]?.content).not.toContain(proof.marker);
    expect(first?.images?.[0]?.bytes.length).toBeGreaterThan(1000);
    expect(first?.toolChoice).toBe('required');
    const last = complete.mock.calls[1]?.[0];
    expect(last?.messages.at(-1)).toEqual({ role: 'tool', content: JSON.stringify(expected), toolCallId: 'call_test' });
    expect(last?.jsonSchema?.schema.additionalProperties).toBe(false);
    expect(context.context.verified).toEqual(expected);
  });
  it('rejects a guessed vision value before a typed tool receipt can succeed', async () => {
    const { registration, context } = fixture();
    const tool = registration.tools[0];
    if (!tool) throw new Error('missing');
    await expect(tool.execute({} as PoolClient, {}, { content: null, toolCalls: [{ id: 'call_wrong', name: 'multiply_receipt', arguments: JSON.stringify({ ...proof, unitPrice: 124 }) }] }, context)).rejects.toMatchObject({ failure: 'invalid_result' });
  });
  it('rejects a final answer that differs from the actual local result', async () => {
    const { registration, context } = fixture();
    context.context.toolResult = expected;
    const tool = registration.tools[2];
    if (!tool) throw new Error('missing');
    await expect(tool.execute({} as PoolClient, {}, { ...expected, total: 862 }, context)).rejects.toMatchObject({ failure: 'invalid_result' });
  });
});
