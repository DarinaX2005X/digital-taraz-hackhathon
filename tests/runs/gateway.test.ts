import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createModelGateway as createGateway, type GatewayOptions, type ModelRequest } from '../../src/features/runs/server/gateway';
import type { BudgetLedger, UsageRow } from '../../src/features/runs/server/budget';
import { validatePricing, type PricingSnapshot } from '../../src/features/runs/server/pricing';
import { boundedObject, canonical, hash } from '../../src/features/runs/server/data';
import { RunError } from '../../src/features/runs/domain/errors';
import { assertModelRoute, APPROVED_MODEL_ROUTES } from '../../src/features/runs/server/model-policy';

function createModelGateway(options: GatewayOptions) {
  return createGateway({ allowedRoutes: [{ model: 'synthetic/model', endpoint: 'synthetic/provider', kind: 'text', quantization: 'fp8' }], ...options });
}

export function syntheticPrice(overrides: Partial<PricingSnapshot> = {}): PricingSnapshot {
  return { model: 'synthetic/model', endpoint: 'synthetic/provider', provider: 'Synthetic', quantization: 'fp8', kind: 'text', inputUsd: '0.0000001', outputUsd: '0.000001', requestUsd: '0', imageUsd: '0', contextTokens: 100_000, maxOutputTokens: 1000, supportedParameters: ['max_tokens', 'response_format', 'tools', 'tool_choice'], checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), modelExpiresAt: null, proof: 'passed', proofRef: 'synthetic-unit-test', ...overrides };
}
function request(): ModelRequest { return { fence: { runId: randomUUID(), stepId: randomUUID(), epoch: 1, leaseOwner: randomUUID() }, operationKey: 'unit_operation', messages: [{ role: 'user', content: 'Synthetic fixture only' }], maxOutputTokens: 100 }; }
function ledgerFixture() {
  let usage: UsageRow | undefined;
  let output: Record<string, unknown> | null = null;
  const ledger = {
    lookupOperation: vi.fn(async (input) => {
      if (usage && usage.operation_key === input.operationKey && usage.input_hash !== input.inputHash) throw new RunError('conflict');
      if (!usage || usage.state === 'released') return null;
      if (usage.state === 'ambiguous' || usage.state === 'dispatched') throw new RunError('ambiguous_charge');
      if (usage.state === 'succeeded' && !output) throw new RunError('invalid_result');
      return { usage, replay: true, output };
    }),
    reserve: vi.fn(async (input) => { if (!usage || usage.state === 'released') usage = { id: randomUUID(), state: 'reserved', ...input, operation_key: input.operationKey, input_hash: input.inputHash, reserved_usd: input.reservedUsd }; return { usage, replay: false, output }; }),
    dispatch: vi.fn(async () => { if (!usage || usage.state !== 'reserved') throw new Error('duplicate'); usage.state = 'dispatched'; return usage; }),
    settle: vi.fn(async (_id, result) => { if (!usage) throw new Error('missing'); usage.state = result.state; output = result.output ?? null; return usage; }),
    releaseUndispatched: vi.fn(async () => { if (usage?.state !== 'reserved') return 0; usage.state = 'released'; return 1; }),
    recoverExpired: vi.fn(async () => []),
  };
  return { ledger: ledger as unknown as BudgetLedger, lookupOperation: ledger.lookupOperation, reserve: ledger.reserve, dispatch: ledger.dispatch, settle: ledger.settle, releaseUndispatched: ledger.releaseUndispatched };
}
function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ id: 'synthetic-provider-call', model: 'synthetic/model', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}', reasoning: 'private reasoning must not persist' } }], usage: { prompt_tokens: 42, completion_tokens: 8, cost: 0.0000122 }, ...overrides }), { status: 200 });
}
describe('runtime exact pricing and private boundary', () => {
  it('reserves the full context conservatively and rejects expired/unproven metadata', () => {
    expect(validatePricing(syntheticPrice(), { kind: 'text', maxOutputTokens: 100, parameters: ['max_tokens'] }).reservedUsd).toBe('0.0101');
    for (const price of [syntheticPrice({ proof: 'unproven' }), syntheticPrice({ expiresAt: new Date(0).toISOString() }), syntheticPrice({ modelExpiresAt: new Date(0).toISOString() })]) expect(() => validatePricing(price, { kind: 'text', maxOutputTokens: 100, parameters: [] })).toThrow();
    expect(() => validatePricing(syntheticPrice(), { kind: 'text', maxOutputTokens: 1001, parameters: [] })).toThrow();
    expect(() => validatePricing(syntheticPrice(), { kind: 'text', maxOutputTokens: 100, parameters: ['unrecognized'] })).toThrow();
  });
  it('canonicalizes only finite JSON and bounds private continuations', () => {
    expect(hash({ b: 1, a: 2 })).toBe(hash({ a: 2, b: 1 }));
    expect(hash({ '\u00e9': 1, 'e\u0301': 2 })).toBe(hash({ 'e\u0301': 2, '\u00e9': 1 }));
    expect(() => canonical({ value: Number.NaN })).toThrow();
    expect(() => canonical({ value: undefined })).toThrow();
    expect(() => boundedObject({ private: 'x'.repeat(65_536) })).toThrow();
  });
  it('has an independent exact route policy even when a callback asserts a passed proof', () => {
    for (const model of ['openai/gpt-5', 'anthropic/claude-4', 'synthetic/unapproved']) {
      expect(() => assertModelRoute({ ...syntheticPrice(), model })).toThrow();
    }
    for (const route of APPROVED_MODEL_ROUTES) expect(() => assertModelRoute(route)).not.toThrow();
    expect(() => assertModelRoute({ ...APPROVED_MODEL_ROUTES[0]!, endpoint: 'other-provider' })).toThrow();
    expect(() => assertModelRoute({ model: 'openai/gpt-5', endpoint: 'openai', kind: 'text', quantization: null }, [{ model: 'openai/gpt-5', endpoint: 'openai', kind: 'text', quantization: null }])).toThrow();
  });
});
describe('single model gateway', () => {
  it('records dispatch first, pins the route, settles exact actual cost, and replays without another request', async () => {
    const fixture = ledgerFixture();
    const send = vi.fn(async (_url, init) => { expect(fixture.dispatch).toHaveBeenCalledOnce(); const body = JSON.parse(init!.body as string); expect(body.provider).toEqual({ only: ['synthetic/provider'], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0.1, completion: 1 }, quantizations: ['fp8'] }); return response(); });
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic-secret', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: send as typeof fetch });
    const input = request();
    expect(await gateway.complete(input)).toEqual({ content: '{"ok":true}', toolCalls: [] });
    expect(fixture.settle).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: 'succeeded', actualUsd: '0.0000122', output: { content: '{"ok":true}', toolCalls: [] } }));
    expect(JSON.stringify(fixture.settle.mock.calls)).not.toContain('private reasoning');
    expect(await gateway.complete(input)).toEqual({ content: '{"ok":true}', toolCalls: [] });
    expect(send).toHaveBeenCalledOnce();
  });
  it('does not dispatch when authorization reservation fails', async () => {
    const fixture = ledgerFixture(); fixture.reserve.mockRejectedValueOnce(new Error('budget rejected'));
    const send = vi.fn();
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: send });
    await expect(gateway.complete(request())).rejects.toThrow('budget rejected');
    expect(send).not.toHaveBeenCalled(); expect(fixture.dispatch).not.toHaveBeenCalled();
  });
  it('refuses a forged proof for a forbidden model before reserving or sending', async () => {
    const fixture = ledgerFixture(); const send = vi.fn();
    const gateway = createGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice({ model: 'openai/gpt-5', endpoint: 'openai' }), fetch: send });
    await expect(gateway.complete(request())).rejects.toMatchObject({ failure: 'model_forbidden' });
    expect(fixture.reserve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('settles an over-quote liability without returning or caching a successful output', async () => {
    const fixture = ledgerFixture(); const send = vi.fn(async () => response({ usage: { prompt_tokens: 42, completion_tokens: 8, cost: '0.02' } }));
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: send });
    const input = request();
    await expect(gateway.complete(input)).rejects.toMatchObject({ failure: 'price_exceeded' });
    expect(fixture.settle).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: 'succeeded', actualUsd: '0.02' }));
    expect(fixture.settle.mock.calls[0]?.[1]).not.toHaveProperty('output');
    await expect(gateway.complete(input)).rejects.toThrow(); expect(send).toHaveBeenCalledOnce();
  });
  it('replays a successful semantic operation across epochs without fresh pricing or provider credentials', async () => {
    const fixture = ledgerFixture(); const send = vi.fn(async () => response());
    const pricing = vi.fn(async () => syntheticPrice());
    const input = request();
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing, fetch: send });
    const output = await gateway.complete(input);
    pricing.mockRejectedValue(new Error('metadata unavailable after restart'));
    const restarted = createModelGateway({ ledger: fixture.ledger, apiKey: '', authorizationId: '', pricing, fetch: send });
    const next = { ...input, fence: { ...input.fence, epoch: input.fence.epoch + 2, leaseOwner: randomUUID() } };
    expect(await restarted.complete(next)).toEqual(output);
    expect(pricing).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce(); expect(fixture.reserve).toHaveBeenCalledOnce();
    for (const changed of [{ messages: [{ role: 'user' as const, content: 'Changed synthetic data' }] }, { maxOutputTokens: input.maxOutputTokens + 1 }, { jsonSchema: { name: 'result', schema: { type: 'object' } } }, { tools: [{ name: 'calculate', description: 'Synthetic tool', parameters: { type: 'object' } }] }]) {
      await expect(restarted.complete({ ...next, ...changed })).rejects.toMatchObject({ failure: 'conflict' });
    }
    expect(send).toHaveBeenCalledOnce();
  });
  it('releases only an undispatched reservation when final authorization changes', async () => {
    const fixture = ledgerFixture(); fixture.dispatch.mockRejectedValueOnce(new Error('grant closed'));
    const send = vi.fn();
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: send });
    await expect(gateway.complete(request())).rejects.toThrow('grant closed');
    expect(send).not.toHaveBeenCalled(); expect(fixture.releaseUndispatched).toHaveBeenCalledOnce(); expect(fixture.settle).not.toHaveBeenCalled();
  });
  it('preserves a real assistant/tool-result conversation and uses proven JSON-object compatibility', async () => {
    const fixture = ledgerFixture();
    const send = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      expect(body.messages).toContainEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'actual_call', type: 'function', function: { name: 'calculate_quote', arguments: '{"quantity":3}' } }] });
      expect(body.messages).toContainEqual({ role: 'tool', content: '{"total":3750}', tool_call_id: 'actual_call' });
      expect(body.response_format).toEqual({ type: 'json_object' }); expect(body.reasoning).toEqual({ enabled: false }); expect(body.include_reasoning).toBe(false);
      return response({ model: 'synthetic/model-canonical' });
    });
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice({ canonicalModel: 'synthetic/model-canonical', supportedParameters: ['max_tokens', 'response_format', 'reasoning', 'include_reasoning'] }), fetch: send as typeof fetch });
    await expect(gateway.complete({ ...request(), messages: [{ role: 'user', content: 'Calculate a synthetic quote' }, { role: 'assistant', content: null, toolCalls: [{ id: 'actual_call', name: 'calculate_quote', arguments: '{"quantity":3}' }] }, { role: 'tool', toolCallId: 'actual_call', content: '{"total":3750}' }], jsonSchema: { name: 'synthetic_result', schema: { type: 'object' } } })).resolves.toEqual({ content: '{"ok":true}', toolCalls: [] });
  });
  it('holds an uncertain network charge and never repeats it automatically', async () => {
    const fixture = ledgerFixture(); const send = vi.fn(async () => { throw new TypeError('synthetic network interruption'); });
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: send, safe429Retries: 2 });
    await expect(gateway.complete(request())).rejects.toMatchObject({ failure: 'ambiguous_charge' });
    expect(send).toHaveBeenCalledOnce(); expect(fixture.settle).toHaveBeenCalledWith(expect.any(String), { state: 'ambiguous' });
  });
  it('has no default retry, but can perform bounded known-rejected 429 retries', async () => {
    for (const retries of [0, 2] as const) {
      const fixture = ledgerFixture(); const send = vi.fn(async () => new Response(null, { status: 429 }));
      const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: send, safe429Retries: retries });
      await expect(gateway.complete(request())).rejects.toMatchObject({ failure: 'provider' });
      expect(send).toHaveBeenCalledTimes(retries + 1);
      expect(new Set(fixture.reserve.mock.calls.map(([input]) => input.operationKey)).size).toBe(1);
      expect(new Set(fixture.reserve.mock.calls.map(([input]) => input.attemptKey)).size).toBe(retries + 1);
      expect(fixture.settle.mock.calls.every(([, value]) => value.state === 'released' && value.knownRejected === true)).toBe(true);
    }
  });
  it('records a billable malformed result without treating it as a reusable model result', async () => {
    const fixture = ledgerFixture();
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: vi.fn(async () => response({ choices: [] })) });
    await expect(gateway.complete(request())).rejects.toMatchObject({ failure: 'invalid_result' });
    expect(fixture.settle).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: 'succeeded', actualUsd: '0.0000122' }));
    expect(fixture.settle.mock.calls[0]?.[1]).not.toHaveProperty('output');
    const input = request();
    await expect(gateway.complete(input)).rejects.toMatchObject({ failure: 'invalid_result' });
    expect(fixture.reserve).toHaveBeenCalledOnce();
  });
  it('cannot accept provider-created tool names or retain reasoning', async () => {
    const fixture = ledgerFixture();
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: vi.fn(async () => response({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'delete-everything', arguments: '{}' } }] } }] })) });
    await expect(gateway.complete(request())).rejects.toMatchObject({ failure: 'invalid_result' });
    expect(fixture.settle.mock.calls[0]?.[1]).not.toHaveProperty('output');
  });
  it('fails closed for missing cost, oversized response, redirects, or a pre-aborted request', async () => {
    for (const reply of [() => response({ usage: { prompt_tokens: 1, completion_tokens: 1 } }), () => new Response('x'.repeat(1_048_577)), () => new Response(null, { status: 307 })]) {
      const fixture = ledgerFixture();
      const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: vi.fn(async () => reply()) });
      await expect(gateway.complete(request())).rejects.toThrow();
      expect(fixture.settle).toHaveBeenCalledWith(expect.any(String), { state: 'ambiguous' });
    }
    const fixture = ledgerFixture(); const send = vi.fn();
    const gateway = createModelGateway({ ledger: fixture.ledger, apiKey: 'synthetic', authorizationId: 'synthetic', pricing: async () => syntheticPrice(), fetch: send });
    await expect(gateway.complete({ ...request(), signal: AbortSignal.abort() })).rejects.toMatchObject({ failure: 'cancelled' });
    expect(send).not.toHaveBeenCalled();
  });
});
