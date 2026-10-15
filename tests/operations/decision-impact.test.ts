import { describe, expect, it } from 'vitest';
import { assessDeliveryDate, latestActiveCompletionDate } from '@/features/operations/domain/decision';
import { assessAvailabilityVersionChange, assessPlanSourceImpact } from '@/features/operations/domain/impact';
import type { AvailabilityVersion, WorkResource } from '@/features/operations/contracts';
import type { OperationalPlanContent } from '@/features/operations/domain/model';

const workspaceId = '00000000-0000-4000-8000-000000000101';
const resourceId = '00000000-0000-4000-8000-000000000102';
const actorId = '00000000-0000-4000-8000-000000000103';
const sourceId = '00000000-0000-4000-8000-000000000104';
const sourceVersionId = '00000000-0000-4000-8000-000000000105';
const v1Id = '00000000-0000-4000-8000-000000000106';
const v2Id = '00000000-0000-4000-8000-000000000107';
const v3Id = '00000000-0000-4000-8000-000000000109';
const sourceRef = { sourceId, sourceVersionId, revision: 1 };
const resource: WorkResource = { id: resourceId, workspaceId, displayName: 'Aruzhan', kind: 'person', status: 'active', membershipId: null, timezone: 'Asia/Qyzylorda', accessClass: 'internal', revision: 1, currentAvailabilityVersionId: v1Id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const availability = (id: string, revision: number, exceptions: AvailabilityVersion['exceptions'] = []): AvailabilityVersion => ({ id, workspaceId, resourceId, revision, timezone: 'Asia/Qyzylorda', effectiveFrom: '2026-01-01', effectiveTo: null, weekdays: [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }], exceptions, sourceRefs: [sourceRef], verifiedAt: '2026-01-01T00:00:00.000Z', createdBy: actorId, createdAt: '2026-01-01T00:00:00.000Z' });
const plan = (versionId: string | undefined = v1Id): OperationalPlanContent => ({ kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{
  id: 'prepare', title: 'Prepare order', description: 'Prepare before opening', status: 'todo', startAt: '2026-01-05T04:00:00.000Z', endAt: '2026-01-05T05:00:00.000Z', durationMinutes: 60,
  resourceIds: [resourceId], availabilityVersionIds: versionId ? [versionId] : [], assignments: [{ resourceId, resourceRevision: 1, ...(versionId ? { availabilityVersionId: versionId } : {}), effort: { decimal: '1', unit: 'person-hours' } }],
  dependencies: [], checklist: [{ id: 'confirm', text: 'Confirm materials', done: false }], sourceRefs: [sourceRef],
}] });

describe('operational decision and change impact', () => {
  it('answers the J1 date question within known scope and exposes exact blockers', () => {
    const feasible = assessDeliveryDate({ title: 'Order', plan: plan(), requestedDate: '2026-01-05', openingDate: '2026-01-05', locale: 'en', resources: [resource], availabilityVersions: [availability(v1Id, 1)] });
    expect(feasible).toMatchObject({ verdict: 'can-meet-with-conditions', requestedDate: '2026-01-05', reasons: [], planDraft: { title: 'Order' } });
    expect(feasible.conditions.map((item) => item.code)).toContain('known-scope-only');

    const unknown = assessDeliveryDate({ title: 'Order', plan: plan(undefined), requestedDate: '2026-01-05', openingDate: null, locale: 'en', resources: [resource], availabilityVersions: [] });
    expect(unknown.verdict).toBe('cannot-confirm');
    expect(unknown.reasons.map((item) => item.code)).toContain('availability-unknown');
    expect(unknown.alternatives.map((item) => item.code)).toContain('provide-availability');

    const beforeOpening = assessDeliveryDate({ title: 'Order', plan: plan(), requestedDate: '2026-01-15', openingDate: '2026-01-16', locale: 'en', resources: [resource], availabilityVersions: [availability(v1Id, 1)] });
    expect(beforeOpening.verdict).toBe('cannot-meet');
    expect(beforeOpening.reasons.map((item) => item.code)).toContain('requested-before-opening');
    expect(beforeOpening.alternatives).toContainEqual(expect.objectContaining({ code: 'change-requested-date', suggestedDate: '2026-01-16' }));
    const afterOpening = assessDeliveryDate({ title: 'Order', plan: plan(), requestedDate: '2026-01-17', openingDate: '2026-01-16', locale: 'en', resources: [resource], availabilityVersions: [availability(v1Id, 1)] });
    expect(afterOpening.reasons.map((item) => item.code)).not.toContain('requested-before-opening');
  });

  it('previews a new unavailable-day version without moving or rewriting the plan', () => {
    const original = plan(), next = availability(v2Id, 2, [{ date: '2026-01-05', intervals: [], label: 'Unavailable' }]);
    const impact = assessAvailabilityVersionChange({ plan: original, resources: [resource], availabilityVersions: [availability(v1Id, 1)], resourceId, previousAvailabilityVersionId: v1Id, nextAvailabilityVersion: next });
    expect(impact.entries).toEqual([{ entryId: 'prepare', before: 'within-known-capacity', after: 'conflict', beforeReasons: [], afterReasons: ['scheduled-outside-availability', 'effort-exceeds-window'] }]);
    expect(original.entries[0]?.assignments?.[0]?.availabilityVersionId).toBe(v1Id);
    expect(impact.previewPlan.entries[0]?.assignments?.[0]?.availabilityVersionId).toBe(v2Id);
    expect(impact.previewPlan.entries[0]?.startAt).toBe(original.entries[0]?.startAt);
  });

  it('updates only assignments pinned to the replaced current availability version', () => {
    const old = { ...plan(v1Id).entries[0]!, id: 'old_pin' }, current = { ...plan(v2Id).entries[0]!, id: 'current_pin' };
    const mixed = { ...plan(), entries: [old, current] }, next = availability(v3Id, 3);
    const impact = assessAvailabilityVersionChange({ plan: mixed, resources: [{ ...resource, currentAvailabilityVersionId: v2Id }], availabilityVersions: [availability(v1Id, 1), availability(v2Id, 2)], resourceId, previousAvailabilityVersionId: v2Id, nextAvailabilityVersion: next });
    expect(impact.affectedEntryIds).toEqual(['current_pin']);
    expect(impact.previewPlan.entries.find((entry) => entry.id === 'old_pin')?.assignments?.[0]?.availabilityVersionId).toBe(v1Id);
    expect(impact.previewPlan.entries.find((entry) => entry.id === 'current_pin')?.assignments?.[0]?.availabilityVersionId).toBe(v3Id);
  });

  it('identifies only plan entries pinned to an older source version', () => {
    const extra = { ...plan().entries[0]!, id: 'unrelated', sourceRefs: [] };
    const impact = assessPlanSourceImpact({ ...plan(), entries: [plan().entries[0]!, extra] }, { sourceId, newSourceVersionId: '00000000-0000-4000-8000-000000000108', newRevision: 2 });
    expect(impact.affected.map((item) => item.entryId)).toEqual(['prepare']);
    expect(impact.unaffectedEntryIds).toEqual(['unrelated']);
  });

  it('excludes cancelled late work from the active completion date', () => {
    const active = plan().entries[0]!, cancelled = { ...active, id: 'cancelled_late', status: 'cancelled' as const, startDate: '2026-03-01', endDate: '2026-03-10', startAt: undefined, endAt: undefined };
    expect(latestActiveCompletionDate({ ...plan(), entries: [active, cancelled] })).toBe('2026-01-05');
  });
});
