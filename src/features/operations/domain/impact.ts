import type { SourceRef } from '@/contracts/artifacts';
import type { AvailabilityVersion, CapacityAssessment, WorkResource } from '../contracts';
import { assessPlanCapacity } from './capacity';
import { canonicalAssignments, validateOperationalPlan, type OperationalPlanContent } from './model';

export type CapacitySummary = CapacityAssessment['status'] | 'not-assigned';

export interface AvailabilityImpactEntry {
  entryId: string;
  before: CapacitySummary;
  after: CapacitySummary;
  beforeReasons: CapacityAssessment['reasons'];
  afterReasons: CapacityAssessment['reasons'];
}

export interface AvailabilityVersionImpact {
  resourceId: string;
  previousAvailabilityVersionId: string | null;
  nextAvailabilityVersionId: string;
  affectedEntryIds: string[];
  entries: AvailabilityImpactEntry[];
  /** A preview only. Applying the version remains an explicit checked edit. */
  previewPlan: OperationalPlanContent;
}

/**
 * Preview the exact entries whose capacity result would change if a new
 * immutable availability version were selected. It never reschedules work.
 */
export function assessAvailabilityVersionChange(input: {
  plan: OperationalPlanContent;
  resources: readonly WorkResource[];
  availabilityVersions: readonly AvailabilityVersion[];
  resourceId: string;
  previousAvailabilityVersionId?: string | null;
  nextAvailabilityVersion: AvailabilityVersion;
}): AvailabilityVersionImpact {
  if (input.nextAvailabilityVersion.resourceId !== input.resourceId) throw new Error('AVAILABILITY_RESOURCE_MISMATCH');
  const plan = validateOperationalPlan(input.plan);
  const affectedEntryIds = plan.entries.filter((entry) => canonicalAssignments(entry).some((assignment) => assignment.resourceId === input.resourceId
    && (input.previousAvailabilityVersionId === undefined || (assignment.availabilityVersionId ?? null) === input.previousAvailabilityVersionId))).map((entry) => entry.id);
  const affected = new Set(affectedEntryIds);
  const previewPlan = validateOperationalPlan({
    ...plan,
    entries: plan.entries.map((entry) => {
      if (!affected.has(entry.id)) return structuredClone(entry);
      const assignments = canonicalAssignments(entry).map((assignment) => assignment.resourceId === input.resourceId
        ? { ...assignment, availabilityVersionId: input.nextAvailabilityVersion.id }
        : assignment);
      return {
        ...structuredClone(entry),
        assignments,
        resourceIds: assignments.map((assignment) => assignment.resourceId),
        availabilityVersionIds: assignments.flatMap((assignment) => assignment.availabilityVersionId ? [assignment.availabilityVersionId] : []),
        capacityOverride: undefined,
      };
    }),
  });
  const versions = [...input.availabilityVersions.filter((version) => version.id !== input.nextAvailabilityVersion.id), input.nextAvailabilityVersion];
  const before = byEntry(assessPlanCapacity({ plan, resources: input.resources, availabilityVersions: input.availabilityVersions }));
  const after = byEntry(assessPlanCapacity({ plan: previewPlan, resources: input.resources, availabilityVersions: versions }));
  return {
    resourceId: input.resourceId,
    previousAvailabilityVersionId: input.previousAvailabilityVersionId ?? null,
    nextAvailabilityVersionId: input.nextAvailabilityVersion.id,
    affectedEntryIds,
    entries: affectedEntryIds.map((entryId) => ({
      entryId,
      before: summarize(before.get(entryId) ?? []),
      after: summarize(after.get(entryId) ?? []),
      beforeReasons: uniqueReasons(before.get(entryId) ?? []),
      afterReasons: uniqueReasons(after.get(entryId) ?? []),
    })),
    previewPlan,
  };
}

export interface PlanSourceImpact {
  sourceId: string;
  newSourceVersionId: string;
  newRevision: number;
  affected: { entryId: string; pinnedRefs: SourceRef[] }[];
  unaffectedEntryIds: string[];
}

/** Direct plan provenance impact. Transitive artifact effects belong to C6 DAG. */
export function assessPlanSourceImpact(plan: OperationalPlanContent, change: { sourceId: string; newSourceVersionId: string; newRevision: number }): PlanSourceImpact {
  const current = validateOperationalPlan(plan);
  const affected: PlanSourceImpact['affected'] = [], unaffectedEntryIds: string[] = [];
  for (const entry of current.entries) {
    const pinnedRefs = (entry.sourceRefs ?? []).filter((ref) => ref.sourceId === change.sourceId
      && (ref.sourceVersionId !== change.newSourceVersionId || ref.revision !== change.newRevision));
    if (pinnedRefs.length) affected.push({ entryId: entry.id, pinnedRefs: structuredClone(pinnedRefs) });
    else unaffectedEntryIds.push(entry.id);
  }
  return { ...change, affected, unaffectedEntryIds };
}

function byEntry(assessments: readonly CapacityAssessment[]) {
  const result = new Map<string, CapacityAssessment[]>();
  for (const assessment of assessments) for (const entryId of assessment.affectedEntryIds) {
    result.set(entryId, [...(result.get(entryId) ?? []), assessment]);
  }
  return result;
}

function summarize(assessments: readonly CapacityAssessment[]): CapacitySummary {
  if (assessments.some((assessment) => assessment.status === 'conflict')) return 'conflict';
  if (assessments.some((assessment) => assessment.status === 'availability-unknown')) return 'availability-unknown';
  if (assessments.some((assessment) => assessment.status === 'within-known-capacity')) return 'within-known-capacity';
  return 'not-assigned';
}

function uniqueReasons(assessments: readonly CapacityAssessment[]): CapacityAssessment['reasons'] {
  return [...new Set(assessments.flatMap((assessment) => assessment.reasons))];
}
