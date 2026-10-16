import { describe, expect, it } from 'vitest';

import { evaluateK2Scheduling, K2_SCHEDULING_EVAL_CASES } from '../../evals/operations/k2-scheduling';
import { ProposeWorkPlanResultSchema, type ProposeWorkPlanInput } from '@/features/operations/domain/propose-work-plan';

const resourceId = '00000000-0000-4000-8000-000000000201';
const availabilityId = '00000000-0000-4000-8000-000000000202';
const input: ProposeWorkPlanInput = {
  plan: { kind: 'plan', schemaVersion: 1, timezone: 'UTC', entries: [{ id: 'task', title: 'Task', status: 'todo', durationMinutes: 60, effort: { decimal: '1', unit: 'person-hours' }, resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: [], checklist: [] }] },
  resourceRefs: [{ id: resourceId, revision: 1, availabilityVersionId: availabilityId }],
  window: { start: '2026-01-05T00:00:00.000Z', end: '2026-01-06T00:00:00.000Z' },
  lockedEntryIds: [], materialConstraints: [], objective: 'earliest-finish',
};
const candidate = { ...input.plan, entries: [{ ...input.plan.entries[0]!, startAt: '2026-01-05T09:00:00.000Z', endAt: '2026-01-05T10:00:00.000Z', resourceIds: [resourceId], availabilityVersionIds: [availabilityId], assignments: [{ resourceId, resourceRevision: 1, availabilityVersionId: availabilityId, effort: { decimal: '1', unit: 'person-hours' } }] }] };
const result = ProposeWorkPlanResultSchema.parse({
  status: 'feasible', candidate, changedEntryIds: ['task'], unresolved: [], conflicts: [],
  checkReceipt: { algorithmVersion: 'k2-interval-search-v1', visitedNodes: 1, searchLimit: 100, capacityAssessments: [], inputRevisionVector: { [resourceId]: 1, [availabilityId]: 1 } },
});

describe('K2 scheduling evaluation rubric', () => {
  it('covers change sensitivity, fixed work, unknown materials, and bounded search', () => {
    expect(K2_SCHEDULING_EVAL_CASES.map((item) => item.id)).toEqual(['authoritative-constraint-change', 'fixed-work-and-dependencies', 'unknown-material-date', 'bounded-search']);
  });

  it('accepts a reviewed, revision-bound feasible candidate', () => {
    expect(evaluateK2Scheduling({ input, result, candidateApplied: false })).toEqual({ pass: true, findings: [] });
  });

  it('rejects silent apply and misclassified bounded-search exhaustion', () => {
    const exhausted = ProposeWorkPlanResultSchema.parse({ ...result, status: 'partial', unresolved: [{ entryId: 'task', code: 'search-exhausted', sourceRefs: [] }] });
    expect(evaluateK2Scheduling({ input, result: exhausted, candidateApplied: true })).toMatchObject({ pass: false, findings: expect.arrayContaining(['candidate-applied-before-review', 'search-exhaustion-misclassified']) });
  });
});
