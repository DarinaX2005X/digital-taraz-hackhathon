import { describe, expect, it } from 'vitest';

import type { AvailabilityVersion, WorkResource } from '@/features/operations/contracts';
import {
  proposeWorkPlan,
  type PlanResourceReadResult,
  type PlanResourceSnapshot,
  type ProposeWorkPlanInput,
} from '@/features/operations/domain/propose-work-plan';
import type { OperationalPlanContent, OperationalPlanEntry } from '@/features/operations/domain/model';

const workspaceId = '00000000-0000-4000-8000-000000000101';
const actorId = '00000000-0000-4000-8000-000000000102';
const resourceA = '00000000-0000-4000-8000-000000000111';
const resourceB = '00000000-0000-4000-8000-000000000112';
const availabilityA = '00000000-0000-4000-8000-000000000121';
const availabilityB = '00000000-0000-4000-8000-000000000122';
const sourceId = '00000000-0000-4000-8000-000000000131';
const sourceVersionId = '00000000-0000-4000-8000-000000000132';
const monday = { start: '2026-01-05T00:00:00.000Z', end: '2026-01-06T00:00:00.000Z' };

function task(id: string, patch: Partial<OperationalPlanEntry> = {}): OperationalPlanEntry {
  return {
    id,
    title: id,
    status: 'todo',
    resourceIds: [],
    availabilityVersionIds: [],
    assignments: [],
    dependencies: [],
    checklist: [],
    durationMinutes: 60,
    effort: { decimal: '1', unit: 'person-hours' },
    ...patch,
  };
}

function plan(...entries: OperationalPlanEntry[]): OperationalPlanContent {
  return { kind: 'plan', schemaVersion: 1, timezone: 'UTC', entries };
}

function snapshot(id: string, availabilityId: string, weekdays: AvailabilityVersion['weekdays'], revision = 1): PlanResourceSnapshot {
  const resource: WorkResource = {
    id,
    workspaceId,
    displayName: id === resourceA ? 'Aruzhan' : 'Bek',
    kind: 'person',
    status: 'active',
    membershipId: null,
    timezone: 'UTC',
    accessClass: 'internal',
    revision,
    currentAvailabilityVersionId: availabilityId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    resource,
    availabilityVersion: {
      id: availabilityId,
      workspaceId,
      resourceId: id,
      revision: 1,
      timezone: 'UTC',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      weekdays,
      exceptions: [],
      sourceRefs: [],
      verifiedAt: '2026-01-01T00:00:00.000Z',
      createdBy: actorId,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

const regularA = snapshot(resourceA, availabilityA, [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }]);
const regularB = snapshot(resourceB, availabilityB, [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }]);
const refs = (items: readonly PlanResourceSnapshot[]) => items.map((item) => ({ id: item.resource.id, revision: item.resource.revision, availabilityVersionId: item.availabilityVersion!.id }));
const input = (content: OperationalPlanContent, items: readonly PlanResourceSnapshot[], patch: Partial<ProposeWorkPlanInput> = {}): ProposeWorkPlanInput => ({
  plan: content,
  resourceRefs: refs(items),
  window: monday,
  lockedEntryIds: [],
  materialConstraints: [],
  objective: 'earliest-finish',
  ...patch,
});

async function run(value: ProposeWorkPlanInput, items: readonly PlanResourceSnapshot[], searchLimit = 1_000) {
  const read: PlanResourceReadResult = {
    resources: items,
    inputRevisionVector: Object.fromEntries(items.flatMap((item) => [[item.resource.id, item.resource.revision], [item.availabilityVersion!.id, item.availabilityVersion!.revision]])),
  };
  return proposeWorkPlan(value, {
    authorization: { workspaceId, actorId, authzVersion: 1 },
    searchLimit,
    readResources: async () => read,
  });
}

describe('K2 deterministic work-plan proposals', () => {
  it('keeps a locked task fixed and schedules its dependent task after it', async () => {
    const locked = task('locked', {
      startAt: '2026-01-05T09:00:00.000Z',
      endAt: '2026-01-05T10:00:00.000Z',
      resourceIds: [resourceA],
      availabilityVersionIds: [availabilityA],
      assignments: [{ resourceId: resourceA, resourceRevision: 1, availabilityVersionId: availabilityA, effort: { decimal: '1', unit: 'person-hours' } }],
    });
    const result = await run(input(plan(locked, task('next', { dependencies: ['locked'] })), [regularA], { lockedEntryIds: ['locked'] }), [regularA]);
    expect(result.status).toBe('feasible');
    expect(result.changedEntryIds).toEqual(['next']);
    expect(result.candidate.entries[0]).toEqual(locked);
    expect(result.candidate.entries[1]).toMatchObject({ startAt: '2026-01-05T10:00:00.000Z', endAt: '2026-01-05T11:00:00.000Z', resourceIds: [resourceA] });
  });

  it('uses weekend availability and preserves dependency order across resources', async () => {
    const saturdayA = snapshot(resourceA, availabilityA, [{ weekday: 6, intervals: [{ startMinute: 600, endMinute: 720 }] }]);
    const saturdayB = snapshot(resourceB, availabilityB, [{ weekday: 6, intervals: [{ startMinute: 600, endMinute: 720 }] }]);
    const saturday = { start: '2026-01-10T00:00:00.000Z', end: '2026-01-11T00:00:00.000Z' };
    const result = await run(input(plan(task('prepare'), task('deliver', { dependencies: ['prepare'] })), [saturdayA, saturdayB], { window: saturday }), [saturdayA, saturdayB]);
    expect(result.status).toBe('feasible');
    expect(result.candidate.entries.map((entry) => entry.startAt)).toEqual(['2026-01-10T10:00:00.000Z', '2026-01-10T11:00:00.000Z']);
    expect(new Set(result.candidate.entries.flatMap((entry) => entry.resourceIds)).size).toBeGreaterThanOrEqual(1);
  });

  it('delays work for a known material date and keeps an unknown material date unresolved', async () => {
    const sourceRef = { sourceId, sourceVersionId, revision: 1 };
    const known = await run(input(plan(task('pack')), [regularA], { materialConstraints: [{ entryId: 'pack', sourceRef, availableAt: '2026-01-05T13:00:00.000Z' }] }), [regularA]);
    expect(known.status).toBe('feasible');
    expect(known.candidate.entries[0]?.startAt).toBe('2026-01-05T13:00:00.000Z');
    const unknown = await run(input(plan(task('pack')), [regularA], { materialConstraints: [{ entryId: 'pack', sourceRef, availableAt: null }] }), [regularA]);
    expect(unknown.status).toBe('unknown');
    expect(unknown.changedEntryIds).toEqual([]);
    expect(unknown.unresolved).toContainEqual(expect.objectContaining({ entryId: 'pack', code: 'material-date-unknown', sourceRefs: [sourceRef] }));
  });

  it('changes the candidate when an authoritative constraint changes', async () => {
    const early = await run(input(plan(task('ship')), [regularA]), [regularA]);
    const delayed = await run(input(plan(task('ship')), [regularA], { materialConstraints: [{ entryId: 'ship', sourceRef: { sourceId, sourceVersionId, revision: 1 }, availableAt: '2026-01-05T15:00:00.000Z' }] }), [regularA]);
    expect(early.candidate.entries[0]?.startAt).toBe('2026-01-05T09:00:00.000Z');
    expect(delayed.candidate.entries[0]?.startAt).toBe('2026-01-05T15:00:00.000Z');
    expect(delayed.checkReceipt.inputRevisionVector[sourceId]).toBe(1);
  });

  it('distinguishes a proven unavailable window from bounded-search exhaustion', async () => {
    const unavailable = snapshot(resourceA, availabilityA, [{ weekday: 1, intervals: [] }]);
    const impossible = await run(input(plan(task('ship')), [unavailable]), [unavailable]);
    expect(impossible.status).toBe('infeasible');
    expect(impossible.conflicts).toContainEqual(expect.objectContaining({ entryIds: ['ship'], code: 'window-unavailable' }));

    const exhausted = await run(input(plan(task('one'), task('two')), [regularA, regularB]), [regularA, regularB], 1);
    expect(exhausted.status).toBe('unknown');
    expect(exhausted.checkReceipt).toMatchObject({ visitedNodes: 1, searchLimit: 1 });
    expect(exhausted.unresolved.some((issue) => issue.code === 'search-exhausted')).toBe(true);
  });

  it('never reports empty or unresolved unassigned work as feasible', async () => {
    expect((await run(input(plan(), []), [])).status).toBe('unknown');
    const missing = await run(input(plan(task('unassigned')), []), []);
    expect(missing.status).toBe('unknown');
    expect(missing.unresolved).toContainEqual(expect.objectContaining({ entryId: 'unassigned', code: 'resource-capability-missing' }));
  });

  it('rejects a locked task whose pinned resource facts are unavailable', async () => {
    const locked = task('locked', {
      startAt: '2026-01-05T09:00:00.000Z', endAt: '2026-01-05T10:00:00.000Z',
      resourceIds: [resourceA], availabilityVersionIds: [availabilityA],
      assignments: [{ resourceId: resourceA, resourceRevision: 1, availabilityVersionId: availabilityA, effort: { decimal: '1', unit: 'person-hours' } }],
    });
    const result = await run(input(plan(locked), [], { lockedEntryIds: ['locked'] }), []);
    expect(result.status).toBe('unknown');
    expect(result.unresolved).toContainEqual(expect.objectContaining({ entryId: 'locked', code: 'locked-assignment-invalid' }));
  });
});
