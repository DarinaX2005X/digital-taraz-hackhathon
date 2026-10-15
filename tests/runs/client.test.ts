import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { consumeRunEvents, openRunEvents } from '../../src/features/runs/client/events';
import { runCatalog } from '../../src/features/runs/locales';
import { RunActionSchema, RunFailureSchema, RunStateSchema, RunStepStateSchema } from '../../src/contracts/runs';
import { observableRun } from '../../src/features/runs/client/state';

const runId = randomUUID();
const userId = randomUUID();
function event(sequence: number, overrides = {}) { return { id: randomUUID(), runId, sequence, at: new Date().toISOString(), kind: 'run_state', state: 'running', resultRefs: [], ...overrides }; }
function block(value: ReturnType<typeof event>) { return `id: ${value.sequence}\r\nevent: run\r\ndata: ${JSON.stringify(value)}\r\n\r\n`; }
function response(chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk))); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
describe('run event client', () => {
  it('keeps observing mutable idle runs and retryable failures, including read-only viewers', () => {
    for (const state of ['queued', 'running', 'waiting_input', 'review_ready'] as const) expect(observableRun({ state, steps: [] })).toBe(true);
    expect(observableRun({ state: 'failed', steps: [{ retryable: true }] })).toBe(true);
    for (const state of ['failed', 'completed', 'cancelled'] as const) expect(observableRun({ state, steps: [{ retryable: false }] })).toBe(false);
  });
  it('reconstructs split CRLF messages and ignores duplicate replay events', async () => {
    const first = event(1, { kind: 'projection_changed', projectionRevision: 1 }), second = event(2, { kind: 'branch_state', branchId: 'capacity_check', branchState: 'running' });
    const text = `: connected\r\n\r\n${block(first)}${block(first)}${block(second)}event: settled\r\ndata: {}\r\n\r\n`;
    const received = vi.fn();
    const result = await consumeRunEvents(response(Array.from(text)), runId, 0, received);
    expect(received.mock.calls.map(([value]) => value.sequence)).toEqual([1, 2]);
    expect(received.mock.calls.map(([value]) => value.kind)).toEqual(['projection_changed', 'branch_state']);
    expect(result).toEqual({ cursor: 2, settled: true });
  });
  it('returns the last durable cursor after an interrupted incomplete message', async () => {
    expect(await consumeRunEvents(response([block(event(1)), 'id: 2\nevent: run\ndata: {']), runId, 0, vi.fn())).toEqual({ cursor: 1, settled: false });
  });
  it('rejects a gap or another run instead of applying out-of-order state', async () => {
    await expect(consumeRunEvents(response([block(event(3))]), runId, 1, vi.fn())).rejects.toMatchObject({ status: 409 });
    await expect(consumeRunEvents(response([block(event(1, { runId: randomUUID() }))]), runId, 0, vi.fn())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('propagates access revocation and sends the actor identity on reconnect', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([`event: failure\ndata: ${JSON.stringify({ code: 'NOT_FOUND', messageKey: 'runs.errors.unavailable', retryable: false, requestId: randomUUID() })}\n\n`]));
    await expect(openRunEvents(runId, 7, vi.fn(), { userId }, fetcher)).rejects.toMatchObject({ status: 404 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/runs/${runId}/events?after=7`);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Tirlik-User-Id': userId });
  });
  it('rejects non-stream responses, oversized frames and aborted callers', async () => {
    await expect(consumeRunEvents(new Response('{}'), runId, 0, vi.fn())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(consumeRunEvents(response(['x'.repeat(262_145)]), runId, 0, vi.fn())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const controller = new AbortController(); controller.abort();
    await expect(consumeRunEvents(response([]), runId, 0, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
describe('run locale coverage', () => {
  it('covers every public state, action and failure in all three languages', () => {
    for (const locale of ['ru', 'kk', 'en'] as const) {
      const copy = runCatalog[locale];
      for (const key of RunStateSchema.options) expect(copy.states[key]).toBeTruthy();
      for (const key of RunStepStateSchema.options) expect(copy.stepStates[key]).toBeTruthy();
      for (const key of RunActionSchema.options) expect(copy.actions[key]).toBeTruthy();
      for (const key of RunFailureSchema.options) expect(copy.failures[key]).toBeTruthy();
    }
  });
});
