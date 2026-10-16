import { describe, expect, it, vi } from 'vitest';

import { createOperationsClient } from '@/features/operations/client/transport';

const workspaceId = '00000000-0000-4000-8000-000000000301';
const userId = '00000000-0000-4000-8000-000000000302';
const resourceId = '00000000-0000-4000-8000-000000000303';
const availabilityId = '00000000-0000-4000-8000-000000000304';
const plan = { kind: 'plan' as const, schemaVersion: 1 as const, timezone: 'UTC', entries: [{ id: 'task', title: 'Task', status: 'todo' as const, durationMinutes: 60, effort: { decimal: '1', unit: 'person-hours' }, resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: [], checklist: [] }] };

describe('operations proposal transport', () => {
  it('posts a read-only candidate request without pretending it is an idempotent mutation', async () => {
    const result = {
      status: 'unknown', candidate: plan, changedEntryIds: [],
      unresolved: [{ entryId: 'task', code: 'resource-capability-missing', sourceRefs: [] }], conflicts: [],
      checkReceipt: { algorithmVersion: 'k2-interval-search-v1', visitedNodes: 0, searchLimit: 50_000, capacityAssessments: [], inputRevisionVector: {} },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = createOperationsClient(fetcher);
    const response = await client.propose({
      workspaceId, expectedAuthzVersion: 1,
      input: { plan, resourceRefs: [], window: { start: '2026-01-05T00:00:00.000Z', end: '2026-01-06T00:00:00.000Z' }, lockedEntryIds: [], materialConstraints: [], objective: 'earliest-finish' },
    }, { userId });
    expect(response.status).toBe('unknown');
    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    const [path, init] = call!;
    expect(init).toBeDefined();
    expect(path).toBe('/api/operations/plan-proposals');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    const headers = new Headers(init!.headers);
    expect(headers.get('X-Tirlik-User-Id')).toBe(userId);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('Idempotency-Key')).toBe(false);
  });

  it('rejects a malformed proposal receipt at the client boundary', async () => {
    const client = createOperationsClient(async () => new Response(JSON.stringify({ status: 'feasible' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(client.propose({
      workspaceId, expectedAuthzVersion: 1,
      input: { plan, resourceRefs: [{ id: resourceId, revision: 1, availabilityVersionId: availabilityId }], window: { start: '2026-01-05T00:00:00.000Z', end: '2026-01-06T00:00:00.000Z' }, lockedEntryIds: [], materialConstraints: [], objective: 'earliest-finish' },
    }, { userId })).rejects.toMatchObject({ status: 502, messageKey: 'operations.errors.invalidResponse' });
  });
});
