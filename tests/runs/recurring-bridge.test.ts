import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { Run } from '../../src/contracts/runs';
import { createRecurringRunBridge } from '../../src/features/runs/server/recurring-bridge';

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

function run(idValue: string, state: Run['state'], epoch = 0) {
  return { id: idValue, state, epoch } as Run;
}

describe('recurring run bridge', () => {
  it('starts the canonical business run with pinned authority, inputs, context, locale, and budget', async () => {
    const runId = id('9');
    const service = {
      create: vi.fn(async () => run(runId, 'review_ready')),
      read: vi.fn(),
      cancel: vi.fn(),
    } as unknown as Parameters<typeof createRecurringRunBridge>[1];
    const pool = { query: vi.fn(async () => ({ rows: [{ locale: 'kk' }] })) } as unknown as Pool;
    const bridge = createRecurringRunBridge(pool, service);
    const principal = { kind: 'job' as const, userId: id('1'), authzVersion: 7 };
    const sourceId = id('2'), sourceVersionId = id('3'), branchId = id('4'), contextId = id('5'), occurrenceId = id('6'), ruleId = id('7');
    const definition = {
      goal: 'Келесі кезеңге материал дайындау',
      sourceSelectors: [{ sourceId, required: true }],
      contextRefs: [{ contextId, revision: 3, itemIds: ['customer'] }],
      capability: { id: 'business.goal', version: 1 }, procedureVersion: 1,
      trigger: { kind: 'manual' as const }, timezone: 'Asia/Qyzylorda',
      outputPolicy: { mode: 'new-branch' as const, baseArtifact: null, reviewRequired: true as const, externalEffects: 'forbidden' as const },
      budget: { maximumUsd: '0.25', maxOccurrencesPerDay: 4 },
    };
    const occurrence = {
      id: occurrenceId, workspaceId: id('8'), projectId: id('a'), ruleId, ruleVersion: 2,
      trigger: { kind: 'manual' as const, at: '2026-10-17T08:00:00.000Z', sourceRefs: [] },
      state: 'queued' as const, runId: null, branchId, reasonCode: null, restartedFrom: null,
      createdAt: '2026-10-17T08:00:00.000Z', updatedAt: '2026-10-17T08:00:00.000Z', completedAt: null,
    };
    const sourceRef = { sourceId, sourceVersionId, revision: 4 };
    const result = await bridge.start({ principal, operationId: occurrenceId, workspaceId: occurrence.workspaceId, projectId: occurrence.projectId, authzVersion: 7, definition, occurrence, sourceRefs: [sourceRef], branchId });

    expect(result).toEqual({ runId, state: 'queued' });
    expect(service.create).toHaveBeenCalledWith(principal, {
      workspaceId: occurrence.workspaceId, projectId: occurrence.projectId,
      capabilityId: 'business.goal', capabilityVersion: 1, goal: definition.goal, locale: 'kk',
      inputRefs: [{ kind: 'source', id: sourceId, revision: 4 }, { kind: 'artifact', id: branchId, revision: 0 }],
    }, occurrenceId, {
      trusted: true, budgetLimitUsd: '0.25', privateInput: {
        executionAuthority: { kind: 'rule', userId: principal.userId, ruleId, ruleVersion: 2, occurrenceId },
        businessContextRefs: definition.contextRefs,
        currentArtifact: { id: branchId, revision: 0 },
      },
    });
  });

  it('maps waiting input exactly, falls back to Russian, and cancels with the current epoch under the expected authorization version', async () => {
    const runId = id('9'), userId = id('1');
    const service = {
      create: vi.fn(async () => run(runId, 'waiting_input')),
      read: vi.fn(async () => run(runId, 'queued', 5)),
      cancel: vi.fn(async () => run(runId, 'cancelled', 6)),
    } as unknown as Parameters<typeof createRecurringRunBridge>[1];
    const pool = { query: vi.fn(async () => ({ rows: [{ locale: 'unexpected' }] })) } as unknown as Pool;
    const bridge = createRecurringRunBridge(pool, service);
    const occurrenceId = id('6'), ruleId = id('7');
    const definition = {
      goal: 'Prepare work', sourceSelectors: [], contextRefs: [], capability: { id: 'other.ignored', version: 9 }, procedureVersion: 1,
      trigger: { kind: 'manual' as const }, timezone: 'UTC',
      outputPolicy: { mode: 'new-branch' as const, baseArtifact: null, reviewRequired: true as const, externalEffects: 'forbidden' as const },
      budget: { maximumUsd: '0.1', maxOccurrencesPerDay: 1 },
    };
    const occurrence = { id: occurrenceId, workspaceId: id('8'), projectId: id('a'), ruleId, ruleVersion: 1, trigger: { kind: 'manual' as const, at: '2026-10-17T08:00:00.000Z', sourceRefs: [] }, state: 'queued' as const, runId: null, branchId: null, reasonCode: null, restartedFrom: null, createdAt: '2026-10-17T08:00:00.000Z', updatedAt: '2026-10-17T08:00:00.000Z', completedAt: null };
    const principal = { kind: 'job' as const, userId, authzVersion: 3 };
    expect(await bridge.start({ principal, operationId: occurrenceId, workspaceId: occurrence.workspaceId, projectId: occurrence.projectId, authzVersion: 3, definition, occurrence, sourceRefs: [], branchId: null })).toEqual({ runId, state: 'waiting_input' });
    expect(service.create).toHaveBeenCalledWith(principal, expect.objectContaining({ capabilityId: 'business.goal', capabilityVersion: 1, locale: 'ru' }), occurrenceId, expect.anything());

    const sessionPrincipal = { kind: 'session' as const, userId, sessionId: id('b') };
    await bridge.cancel({ principal: sessionPrincipal, runId, workspaceId: occurrence.workspaceId, expectedAuthzVersion: 11, operationId: id('c') });
    const jobPrincipal = { kind: 'job', userId, authzVersion: 11 };
    expect(service.read).toHaveBeenCalledWith(jobPrincipal, runId);
    expect(service.cancel).toHaveBeenCalledWith(jobPrincipal, runId, { expectedEpoch: 5 }, id('c'));
  });
});
