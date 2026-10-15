import { describe, expect, it } from 'vitest';

import { duplicateEntry, insertEntry, removeEntries, reorderEntry, requirePlan, updateEntry, type OperationalPlanContent, type OperationalPlanEntry } from '@/features/operations/domain/model';

const entry = (id: string, dependencies: string[] = []): OperationalPlanEntry => ({ id, title: id, status: 'todo', resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies, checklist: [] });
const plan = (...entries: OperationalPlanEntry[]): OperationalPlanContent => ({ kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries });

describe('operational plan model', () => {
  it('accepts canonical plan entries while validating operational extensions separately', () => {
    expect(requirePlan(plan(entry('task_a'))).entries[0]?.id).toBe('task_a');
  });
  it('keeps stable IDs through reorder and removes dangling dependencies', () => {
    const initial = plan(entry('task_a'), entry('task_b', ['task_a']), entry('task_c', ['task_b']));
    const reordered = reorderEntry(initial, 'task_c', 'task_a');
    expect(reordered.entries.map((item) => item.id)).toEqual(['task_c', 'task_a', 'task_b']);
    expect(reordered.entries.find((item) => item.id === 'task_c')?.dependencies).toEqual(['task_b']);
    const removed = removeEntries(reordered, ['task_b']);
    expect(removed.entries.find((item) => item.id === 'task_c')?.dependencies).toEqual([]);
  });

  it('rejects a dependency cycle at the edit boundary', () => {
    const initial = plan(entry('task_a'), entry('task_b', ['task_a']));
    expect(() => updateEntry(initial, 'task_a', { dependencies: ['task_b'] })).toThrow('cyclic-plan-dependency');
  });

  it('duplicates checklist identity while preserving the source entry', () => {
    const initial = plan({ ...entry('task_a'), checklist: [{ id: 'check_a', text: 'Review', done: true }] });
    const copied = duplicateEntry(initial, 'task_a', 'task_copy', () => 'check_copy');
    expect(copied.entries[0]?.checklist).toEqual([{ id: 'check_a', text: 'Review', done: true }]);
    expect(copied.entries[1]).toMatchObject({ id: 'task_copy', status: 'todo', checklist: [{ id: 'check_copy', text: 'Review', done: false }] });
  });

  it('normalizes a legacy resource assignment without inventing effort', () => {
    const resourceId = '00000000-0000-4000-8000-000000000001', availabilityId = '00000000-0000-4000-8000-000000000002';
    const result = insertEntry(plan(), { ...entry('task_a'), resourceIds: [resourceId], availabilityVersionIds: [availabilityId] });
    expect(result.entries[0]?.assignments).toEqual([{ resourceId, availabilityVersionId: availabilityId }]);
    expect(result.entries[0]?.assignments?.[0]?.effort).toBeUndefined();
  });
});
