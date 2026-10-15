import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runEventStream } from '../../src/features/runs/server/stream';
import { IdentityError } from '../../src/features/identity/server/http';
import type { RunEventsPage } from '../../src/contracts/runs';
const runId = randomUUID();
const principal = { kind: 'session' as const, userId: randomUUID(), sessionId: randomUUID() };
const empty: RunEventsPage = { runId, events: [], cursor: 0, hasMore: false, terminal: false };
describe('authorized run stream', () => {
  it('rechecks the session even during idle streams and sends access loss before closing', async () => {
    const events = vi.fn().mockRejectedValue(new IdentityError('NOT_FOUND', 'runs.errors.notFound'));
    const response = runEventStream({ request: new Request('http://localhost/api/runs/events'), principal, service: { events }, first: empty, pollMs: 1, durationMs: 1000 });
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    const content = await response.text();
    expect(events).toHaveBeenCalledWith(principal, runId, 0);
    expect(content).toContain('event: failure');
    expect(content).toContain('NOT_FOUND');
  });
  it('drains persisted pages in sequence and then closes a terminal stream', async () => {
    const first: RunEventsPage = { ...empty, events: [{ id: randomUUID(), runId, sequence: 1, at: new Date().toISOString(), kind: 'run_state', state: 'running', resultRefs: [] }], cursor: 1, hasMore: true };
    const last: RunEventsPage = { ...empty, events: [{ id: randomUUID(), runId, sequence: 2, at: new Date().toISOString(), kind: 'run_state', state: 'completed', resultRefs: [] }], cursor: 2, terminal: true };
    const events = vi.fn().mockResolvedValue(last);
    const content = await runEventStream({ request: new Request('http://localhost/api/runs/events'), principal, service: { events }, first, pollMs: 1 }).text();
    expect(content.indexOf('id: 1')).toBeLessThan(content.indexOf('id: 2'));
    expect(content).toContain('event: settled');
    expect(events).toHaveBeenCalledOnce();
  });
  it('stops polling when the reader disconnects', async () => {
    const events = vi.fn().mockResolvedValue(empty);
    const response = runEventStream({ request: new Request('http://localhost/api/runs/events'), principal, service: { events }, first: empty, pollMs: 1000 });
    await response.body?.cancel();
    expect(events).not.toHaveBeenCalled();
  });
});
