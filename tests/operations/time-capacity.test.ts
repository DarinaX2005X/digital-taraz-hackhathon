import { describe, expect, it } from 'vitest';

import type { AvailabilityVersion, WorkResource } from '@/features/operations/contracts';
import { assessPlanCapacity, capacityAssessmentKey } from '@/features/operations/domain/capacity';
import { shiftEntry, type OperationalPlanContent, type OperationalPlanEntry } from '@/features/operations/domain/model';
import { addCalendarDays, localDateMinuteToInstant, zonedParts } from '@/features/operations/domain/time';

const workspaceId = '00000000-0000-4000-8000-000000000010';
const resourceId = '00000000-0000-4000-8000-000000000011';
const versionId = '00000000-0000-4000-8000-000000000012';
const actorId = '00000000-0000-4000-8000-000000000013';
const resource: WorkResource = { id: resourceId, workspaceId, displayName: 'Aruzhan', kind: 'person', status: 'active', membershipId: null, timezone: 'Asia/Qyzylorda', accessClass: 'internal', revision: 1, currentAvailabilityVersionId: versionId, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const availability: AvailabilityVersion = { id: versionId, workspaceId, resourceId, revision: 1, timezone: 'Asia/Qyzylorda', effectiveFrom: '2026-01-01', effectiveTo: null, weekdays: [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }], exceptions: [], sourceRefs: [], verifiedAt: '2026-01-01T00:00:00.000Z', createdBy: actorId, createdAt: '2026-01-01T00:00:00.000Z' };
const task = (id: string, patch: Partial<OperationalPlanEntry> = {}): OperationalPlanEntry => ({ id, title: id, status: 'todo', resourceIds: [resourceId], availabilityVersionIds: [versionId], assignments: [{ resourceId, resourceRevision: 1, availabilityVersionId: versionId, effort: { decimal: '1', unit: 'person-hours' } }], dependencies: [], checklist: [], ...patch });
const plan = (...entries: OperationalPlanEntry[]): OperationalPlanContent => ({ kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries });

describe('calendar arithmetic and known capacity', () => {
  it('keeps local dates stable and excludes a daylight-saving gap', () => {
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
    const start = localDateMinuteToInstant('2026-03-08', 60, 'America/New_York', 'start');
    const end = localDateMinuteToInstant('2026-03-08', 240, 'America/New_York', 'end');
    expect((end - start) / 60_000).toBe(120);
  });

  it('moves a timed task by local calendar day across DST without a 24-hour shortcut', () => {
    const original: OperationalPlanContent = { kind: 'plan', schemaVersion: 1, timezone: 'America/New_York', entries: [{ ...task('task_dst'), startAt: '2026-03-07T06:30:00.000Z', endAt: '2026-03-07T08:30:00.000Z' }] };
    const shifted = shiftEntry(original, 'task_dst', 1).entries[0]!;
    expect(zonedParts(shifted.startAt!, original.timezone)).toMatchObject({ date: '2026-03-08', hour: 1, minute: 30 });
    expect(zonedParts(shifted.endAt!, original.timezone)).toMatchObject({ date: '2026-03-08', hour: 3, minute: 30 });
    expect((Date.parse(shifted.endAt!) - Date.parse(shifted.startAt!)) / 60_000).toBe(60);
  });

  it('separates elapsed duration from assigned effort', () => {
    const result = assessPlanCapacity({
      plan: plan(task('task_a', { startAt: '2026-01-05T04:00:00.000Z', endAt: '2026-01-05T05:00:00.000Z', assignments: [{ resourceId, availabilityVersionId: versionId, effort: { decimal: '2', unit: 'person-hours' } }] })),
      resources: [resource], availabilityVersions: [availability],
    });
    expect(result).toContainEqual(expect.objectContaining({ status: 'conflict', demandedMinutes: 120, availableMinutes: 60, reasons: expect.arrayContaining(['effort-exceeds-window']) }));
  });

  it('detects combined overlap only when summed effort exceeds known availability', () => {
    const entries = ['task_a', 'task_b'].map((id) => task(id, { startAt: '2026-01-05T04:00:00.000Z', endAt: '2026-01-05T05:00:00.000Z', assignments: [{ resourceId, availabilityVersionId: versionId, effort: { decimal: '0.75', unit: 'person-hours' } }] }));
    const result = assessPlanCapacity({ plan: plan(...entries), resources: [resource], availabilityVersions: [availability] });
    expect(result).toContainEqual(expect.objectContaining({ status: 'conflict', demandedMinutes: 90, availableMinutes: 60, affectedEntryIds: ['task_a', 'task_b'], reasons: ['overlapping-effort-exceeds-capacity'] }));
    const conflict = result.find((item) => item.reasons.includes('overlapping-effort-exceeds-capacity'))!;
    expect(capacityAssessmentKey({ ...conflict, demandedMinutes: 91 })).not.toBe(capacityAssessmentKey(conflict));
  });

  it('keeps missing duration and missing availability explicitly unknown', () => {
    const dated = task('task_a', { startDate: '2026-01-05', endDate: '2026-01-05', durationMinutes: undefined });
    const missingDuration = assessPlanCapacity({ plan: plan(dated), resources: [resource], availabilityVersions: [availability] });
    expect(missingDuration[0]).toMatchObject({ status: 'availability-unknown', reasons: expect.arrayContaining(['duration-missing']) });
    const missingAvailability = assessPlanCapacity({ plan: plan(task('task_b', { assignments: [{ resourceId, effort: { decimal: '1', unit: 'person-hours' } }], availabilityVersionIds: [] })), resources: [resource], availabilityVersions: [] });
    expect(missingAvailability[0]).toMatchObject({ status: 'availability-unknown', reasons: expect.arrayContaining(['availability-version-missing', 'schedule-missing']) });
  });

  it('treats a timed task outside the version effective range as unknown', () => {
    const future = { ...availability, effectiveFrom: '2026-02-01' };
    const result = assessPlanCapacity({ plan: plan(task('task_early', { startAt: '2026-01-05T04:00:00.000Z', endAt: '2026-01-05T05:00:00.000Z' })), resources: [resource], availabilityVersions: [future] });
    expect(result[0]).toMatchObject({ status: 'availability-unknown', reasons: expect.arrayContaining(['availability-not-effective']) });
    expect(result[0]?.reasons).not.toContain('scheduled-outside-availability');
  });
});
