import Decimal from 'decimal.js';
import { z } from 'zod';

import { SourceRefSchema, type SourceRef } from '@/contracts/artifacts';
import { RevisionVectorSchema } from '@/contracts/commands';
import { IdSchema, InstantSchema, RevisionSchema } from '@/contracts/primitives';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import {
  AvailabilityVersionSchema,
  CapacityAssessmentSchema,
  WorkResourceSchema,
  type AvailabilityVersion,
  type WorkResource,
} from '../contracts';
import { assessPlanCapacity } from './capacity';
import {
  canonicalAssignments,
  validateOperationalPlan,
  type OperationalPlanContent,
  type OperationalPlanEntry,
} from './model';
import { availabilityWindows, localDateMinuteToInstant, type InstantWindow } from './time';

export const PlanObjectiveSchema = z.enum(['earliest-finish', 'least-change', 'lowest-known-cost']);
export const PlanConstraintCodeSchema = z.enum([
  'assignment-missing',
  'availability-missing',
  'capacity-conflict',
  'cost-unknown',
  'dependency-unresolved',
  'dependency-order',
  'duration-missing',
  'effort-missing',
  'effort-unit-unknown',
  'locked-assignment-invalid',
  'material-after-window',
  'material-date-unknown',
  'resource-archived',
  'resource-capability-missing',
  'resource-missing',
  'resource-revision-changed',
  'search-exhausted',
  'window-unavailable',
]);

export type PlanConstraintCode = z.infer<typeof PlanConstraintCodeSchema>;
export type PlanObjective = z.infer<typeof PlanObjectiveSchema>;

const OperationalPlanContentSchema = z.custom<OperationalPlanContent>((value) => {
  try {
    validateOperationalPlan(value as OperationalPlanContent);
    return true;
  } catch {
    return false;
  }
}, 'A canonical operational plan is required.');

export const PlanResourceRefSchema = z.strictObject({
  id: IdSchema,
  revision: RevisionSchema.refine((value) => value >= 1),
  availabilityVersionId: IdSchema,
});

export const PlanMaterialConstraintSchema = z.strictObject({
  entryId: z.string().min(1).max(128),
  sourceRef: SourceRefSchema,
  availableAt: InstantSchema.nullable(),
});

export const ProposeWorkPlanInputSchema = z.strictObject({
  plan: OperationalPlanContentSchema,
  resourceRefs: z.array(PlanResourceRefSchema).max(2_000),
  window: z.strictObject({ start: InstantSchema, end: InstantSchema }),
  lockedEntryIds: z.array(z.string().min(1).max(128)).max(20_000),
  materialConstraints: z.array(PlanMaterialConstraintSchema).max(20_000),
  objective: PlanObjectiveSchema,
}).superRefine((input, context) => {
  if (Date.parse(input.window.end) <= Date.parse(input.window.start)) context.addIssue({ code: 'custom', path: ['window'], message: 'The planning window must have positive length.' });
  if (new Set(input.resourceRefs.map((item) => item.id)).size !== input.resourceRefs.length) context.addIssue({ code: 'custom', path: ['resourceRefs'], message: 'Resource references must be unique.' });
  if (new Set(input.lockedEntryIds).size !== input.lockedEntryIds.length) context.addIssue({ code: 'custom', path: ['lockedEntryIds'], message: 'Locked entries must be unique.' });
  const entryIds = new Set(input.plan.entries.map((entry) => entry.id));
  for (const [index, id] of input.lockedEntryIds.entries()) if (!entryIds.has(id)) context.addIssue({ code: 'custom', path: ['lockedEntryIds', index], message: 'A locked entry must exist in the plan.' });
  for (const [index, item] of input.materialConstraints.entries()) if (!entryIds.has(item.entryId)) context.addIssue({ code: 'custom', path: ['materialConstraints', index, 'entryId'], message: 'A material constraint must target an existing entry.' });
});

export const ProposeWorkPlanRequestSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  input: ProposeWorkPlanInputSchema,
});

export const PlanProposalIssueSchema = z.strictObject({
  entryId: z.string().min(1).max(128),
  code: PlanConstraintCodeSchema,
  sourceRefs: z.array(SourceRefSchema).max(1_000),
});

export const PlanProposalConflictSchema = z.strictObject({
  entryIds: z.array(z.string().min(1).max(128)).min(1).max(20_000),
  resourceId: IdSchema.optional(),
  code: PlanConstraintCodeSchema,
  sourceRefs: z.array(SourceRefSchema).max(1_000),
});

export const WorkPlanCheckReceiptSchema = z.strictObject({
  algorithmVersion: z.literal('k2-interval-search-v1'),
  visitedNodes: z.number().int().nonnegative(),
  searchLimit: z.number().int().positive(),
  capacityAssessments: z.array(CapacityAssessmentSchema).max(40_000),
  inputRevisionVector: RevisionVectorSchema,
});

export const ProposeWorkPlanResultSchema = z.strictObject({
  status: z.enum(['feasible', 'partial', 'unknown', 'infeasible']),
  candidate: OperationalPlanContentSchema,
  changedEntryIds: z.array(z.string().min(1).max(128)).max(20_000),
  unresolved: z.array(PlanProposalIssueSchema).max(40_000),
  conflicts: z.array(PlanProposalConflictSchema).max(40_000),
  checkReceipt: WorkPlanCheckReceiptSchema,
});

export type ProposeWorkPlanInput = z.infer<typeof ProposeWorkPlanInputSchema>;
export type ProposeWorkPlanRequest = z.infer<typeof ProposeWorkPlanRequestSchema>;
export type ProposeWorkPlanResult = z.infer<typeof ProposeWorkPlanResultSchema>;
export type K2Input = ProposeWorkPlanInput;
export type K2Result = ProposeWorkPlanResult;

export interface PlanResourceSnapshot {
  resource: WorkResource;
  availabilityVersion: AvailabilityVersion | null;
  /** When present, the authoritative reader has already applied capability rules. */
  eligibleEntryIds?: readonly string[];
  /** Comparable only when every candidate uses the same currency. */
  knownCostPerHourMinorUnits?: number;
  costCurrency?: string;
}

export interface PlanResourceReadResult {
  resources: readonly PlanResourceSnapshot[];
  inputRevisionVector: Record<string, number>;
}

export interface PlanAuthorization {
  workspaceId: string;
  actorId: string;
  authzVersion: number;
}

export interface ProposeWorkPlanContext {
  authorization: PlanAuthorization;
  searchLimit: number;
  readResources: (
    refs: readonly z.infer<typeof PlanResourceRefSchema>[],
    authorization: PlanAuthorization,
  ) => Promise<PlanResourceReadResult>;
}

export type K2Context = ProposeWorkPlanContext;

interface Placement {
  entryId: string;
  resourceId: string;
  resourceRevision: number;
  availabilityVersionId: string;
  start: number;
  end: number;
  effort: { decimal: string; unit: string };
}

interface SearchState {
  placements: Map<string, Placement>;
  occupied: Map<string, InstantWindow[]>;
  finishByEntry: Map<string, number>;
}

interface SearchResult {
  complete: boolean;
  exhausted: boolean;
  best: SearchState;
  failedEntryId?: string;
}

const active = (entry: OperationalPlanEntry) => entry.status === 'todo' || entry.status === 'in-progress';
const uniqueRefs = (refs: readonly SourceRef[]) => [...new Map(refs.map((ref) => [JSON.stringify(ref), structuredClone(ref)])).values()];
const entryRefs = (entry: OperationalPlanEntry) => uniqueRefs(entry.sourceRefs ?? []);

/**
 * K2 deterministic planner. It reads immutable resource facts through the
 * caller's authorization boundary and returns a candidate only. Applying the
 * candidate remains a separate checked artifact command.
 */
export async function proposeWorkPlan(rawInput: ProposeWorkPlanInput, context: ProposeWorkPlanContext): Promise<ProposeWorkPlanResult> {
  const input = ProposeWorkPlanInputSchema.parse(rawInput);
  const plan = validateOperationalPlan(input.plan);
  const searchLimit = z.number().int().min(1).max(1_000_000).parse(context.searchLimit);
  const authorization = z.strictObject({ workspaceId: IdSchema, actorId: IdSchema, authzVersion: z.number().int().positive() }).parse(context.authorization);
  const loaded = await context.readResources(input.resourceRefs, authorization);
  const snapshots = normalizeResourceSnapshots(input, loaded.resources, authorization.workspaceId);
  let searchVisitedNodes = 0;
  const inputRevisionVector = RevisionVectorSchema.parse({
    ...loaded.inputRevisionVector,
    ...Object.fromEntries(input.resourceRefs.map((ref) => [ref.id, ref.revision])),
    ...Object.fromEntries(snapshots.flatMap((item) => item.availabilityVersion ? [[item.availabilityVersion.id, item.availabilityVersion.revision] as const] : [])),
    ...Object.fromEntries(input.materialConstraints.map((item) => [item.sourceRef.sourceId, item.sourceRef.revision])),
    ...Object.fromEntries(plan.entries.flatMap((entry) => (entry.sourceRefs ?? []).map((ref) => [ref.sourceId, ref.revision] as const))),
  });
  const start = Date.parse(input.window.start), end = Date.parse(input.window.end);
  const locked = new Set(input.lockedEntryIds);
  const unresolved: ProposeWorkPlanResult['unresolved'] = [];
  const conflicts: ProposeWorkPlanResult['conflicts'] = [];
  const unresolvedIds = new Set<string>();
  const byId = new Map(plan.entries.map((entry) => [entry.id, entry]));
  const materials = new Map<string, z.infer<typeof PlanMaterialConstraintSchema>[]>();
  for (const item of input.materialConstraints) materials.set(item.entryId, [...(materials.get(item.entryId) ?? []), item]);
  const initial: SearchState = { placements: new Map(), occupied: new Map(), finishByEntry: new Map() };

  for (const entry of plan.entries) {
    if (!active(entry) || !locked.has(entry.id)) continue;
    const interval = entryWindow(entry, plan.timezone);
    const assignments = canonicalAssignments(entry);
    const validAssignments = assignments.length > 0 && assignments.every((assignment) => snapshots.some((snapshot) =>
      snapshot.resource.id === assignment.resourceId
      && (assignment.resourceRevision === undefined || snapshot.resource.revision === assignment.resourceRevision)
      && snapshot.availabilityVersion?.id === assignment.availabilityVersionId
      && eligible(snapshot, entry),
    ));
    if (!interval || !validAssignments) {
      addUnresolved(unresolved, unresolvedIds, entry, 'locked-assignment-invalid');
      continue;
    }
    initial.finishByEntry.set(entry.id, interval.end);
    for (const assignment of assignments) addOccupied(initial.occupied, assignment.resourceId, interval);
  }

  for (const entry of plan.entries) {
    if (!active(entry) || locked.has(entry.id)) continue;
    const material = materials.get(entry.id) ?? [];
    if (material.some((item) => item.availableAt === null)) addUnresolved(unresolved, unresolvedIds, entry, 'material-date-unknown', material.map((item) => item.sourceRef));
    if (!entry.durationMinutes || entry.durationMinutes <= 0) addUnresolved(unresolved, unresolvedIds, entry, 'duration-missing');
    const effort = effortForEntry(entry);
    if (!effort) addUnresolved(unresolved, unresolvedIds, entry, entry.effort ? 'effort-unit-unknown' : 'effort-missing');
    if (!snapshots.some((snapshot) => eligible(snapshot, entry))) {
      const hasStale = loaded.resources.some((snapshot) => snapshot.resource.id === input.resourceRefs.find((ref) => ref.id === snapshot.resource.id)?.id);
      addUnresolved(unresolved, unresolvedIds, entry, hasStale ? 'resource-revision-changed' : 'resource-capability-missing');
    }
  }

  // A task cannot be planned while an active prerequisite remains unresolved.
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of plan.entries) if (active(entry) && !unresolvedIds.has(entry.id) && entry.dependencies.some((id) => active(byId.get(id)!) && unresolvedIds.has(id))) {
      addUnresolved(unresolved, unresolvedIds, entry, 'dependency-unresolved');
      changed = true;
    }
  }

  const ordered = topologicalActive(plan.entries).filter((entry) => !locked.has(entry.id) && !unresolvedIds.has(entry.id));
  const search = runSearch(
    { input, plan, snapshots, ordered, materials, initial, start, end, searchLimit },
    () => searchVisitedNodes,
    () => { searchVisitedNodes += 1; },
  );
  let candidate = applyPlacements(plan, search.best.placements);
  const capacityAssessments = assessPlanCapacity({
    plan: candidate,
    resources: snapshots.map((item) => item.resource),
    availabilityVersions: snapshots.flatMap((item) => item.availabilityVersion ? [item.availabilityVersion] : []),
  });
  for (const assessment of capacityAssessments.filter((item) => item.status === 'conflict')) {
    conflicts.push({
      entryIds: [...assessment.affectedEntryIds],
      resourceId: assessment.resourceId,
      code: 'capacity-conflict',
      sourceRefs: uniqueRefs(assessment.affectedEntryIds.flatMap((id) => entryRefs(byId.get(id)!))),
    });
  }
  appendConstraintConflicts(candidate, materials, locked, conflicts, plan.timezone);

  if (!search.complete && search.failedEntryId && !unresolvedIds.has(search.failedEntryId)) {
    const entry = byId.get(search.failedEntryId)!;
    if (search.exhausted) addUnresolved(unresolved, unresolvedIds, entry, 'search-exhausted');
    else conflicts.push({ entryIds: [entry.id], code: 'window-unavailable', sourceRefs: entryRefs(entry) });
  }
  for (const entry of plan.entries) if (active(entry) && !locked.has(entry.id) && !search.best.placements.has(entry.id) && !unresolvedIds.has(entry.id) && entry.id !== search.failedEntryId) {
    addUnresolved(unresolved, unresolvedIds, entry, search.exhausted ? 'search-exhausted' : 'dependency-unresolved');
  }

  if (input.objective === 'lowest-known-cost') {
    const currencies = new Set(snapshots.flatMap((item) => item.costCurrency ? [item.costCurrency] : []));
    const comparable = snapshots.length > 0 && currencies.size === 1 && snapshots.every((item) => item.knownCostPerHourMinorUnits !== undefined);
    if (!comparable) for (const entry of plan.entries) if (active(entry) && !unresolvedIds.has(entry.id)) addUnresolved(unresolved, unresolvedIds, entry, 'cost-unknown');
  }

  candidate = validateOperationalPlan(candidate);
  const changedEntryIds = candidate.entries.filter((entry) => {
    const before = byId.get(entry.id)!;
    return hashJson(before as unknown as JsonValue) !== hashJson(entry as unknown as JsonValue);
  }).map((entry) => entry.id);
  const activeEntries = plan.entries.filter(active);
  const useful = changedEntryIds.length > 0 || activeEntries.some((entry) => locked.has(entry.id) && !unresolvedIds.has(entry.id));
  const hasUnknown = unresolved.length > 0 || search.exhausted;
  const hasConflict = conflicts.length > 0;
  let status: ProposeWorkPlanResult['status'];
  if (!activeEntries.length || search.exhausted) status = 'unknown';
  else if (!hasUnknown && !hasConflict && activeEntries.every((entry) => locked.has(entry.id) || search.best.placements.has(entry.id))) status = 'feasible';
  else if (useful && (hasUnknown || hasConflict)) status = 'partial';
  else if (hasConflict && !hasUnknown && !search.exhausted) status = 'infeasible';
  else status = 'unknown';

  return ProposeWorkPlanResultSchema.parse({
    status,
    candidate,
    changedEntryIds,
    unresolved: dedupeIssues(unresolved),
    conflicts: dedupeConflicts(conflicts),
    checkReceipt: {
      algorithmVersion: 'k2-interval-search-v1',
      visitedNodes: searchVisitedNodes,
      searchLimit,
      capacityAssessments,
      inputRevisionVector,
    },
  });

}

function normalizeResourceSnapshots(input: ProposeWorkPlanInput, raw: readonly PlanResourceSnapshot[], workspaceId: string): PlanResourceSnapshot[] {
  const refs = new Map(input.resourceRefs.map((ref) => [ref.id, ref]));
  const result: PlanResourceSnapshot[] = [];
  for (const item of raw) {
    const parsed: PlanResourceSnapshot = {
      resource: WorkResourceSchema.parse(item.resource),
      availabilityVersion: item.availabilityVersion === null ? null : AvailabilityVersionSchema.parse(item.availabilityVersion),
      ...(item.eligibleEntryIds ? { eligibleEntryIds: [...new Set(item.eligibleEntryIds)] } : {}),
      ...(item.knownCostPerHourMinorUnits === undefined ? {} : { knownCostPerHourMinorUnits: z.number().finite().nonnegative().parse(item.knownCostPerHourMinorUnits) }),
      ...(item.costCurrency ? { costCurrency: z.string().regex(/^[A-Z]{3}$/).parse(item.costCurrency) } : {}),
    };
    const ref = refs.get(parsed.resource.id);
    if (!ref || parsed.resource.workspaceId !== workspaceId || parsed.resource.revision !== ref.revision) continue;
    if (!parsed.availabilityVersion || parsed.availabilityVersion.id !== ref.availabilityVersionId || parsed.availabilityVersion.resourceId !== parsed.resource.id || parsed.availabilityVersion.workspaceId !== workspaceId) continue;
    result.push(parsed);
  }
  return result;
}

function eligible(snapshot: PlanResourceSnapshot, entry: OperationalPlanEntry) {
  return snapshot.resource.status === 'active' && snapshot.availabilityVersion !== null && (!snapshot.eligibleEntryIds || snapshot.eligibleEntryIds.includes(entry.id));
}

function effortForEntry(entry: OperationalPlanEntry): { decimal: string; unit: string; minutes: number } | null {
  const effort = entry.effort ?? canonicalAssignments(entry).find((item) => item.effort)?.effort;
  if (!effort) return null;
  const unit = effort.unit.trim().toLocaleLowerCase('en-US').replaceAll('_', '-');
  const factor = ['minute', 'minutes', 'min', 'm', 'person-minute', 'person-minutes'].includes(unit) ? 1
    : ['hour', 'hours', 'h', 'hr', 'person-hour', 'person-hours'].includes(unit) ? 60 : null;
  if (factor === null) return null;
  try {
    const minutes = new Decimal(effort.decimal).mul(factor);
    if (!minutes.isFinite() || !minutes.isPositive() || minutes.greaterThan(1e9)) return null;
    return { decimal: effort.decimal, unit: effort.unit, minutes: minutes.toNumber() };
  } catch {
    return null;
  }
}

function entryWindow(entry: OperationalPlanEntry, timezone: string): InstantWindow | null {
  if (entry.startAt && entry.endAt) {
    const start = Date.parse(entry.startAt), end = Date.parse(entry.endAt);
    return end > start ? { start, end } : null;
  }
  if (entry.startDate && entry.endDate) {
    try {
      return {
        start: localDateMinuteToInstant(entry.startDate, 0, timezone, 'start'),
        end: localDateMinuteToInstant(entry.endDate, 1440, timezone, 'end'),
      };
    } catch {
      return null;
    }
  }
  return null;
}

function topologicalActive(entries: readonly OperationalPlanEntry[]) {
  const activeEntries = entries.filter(active);
  const activeIds = new Set(activeEntries.map((entry) => entry.id));
  const degree = new Map(activeEntries.map((entry) => [entry.id, entry.dependencies.filter((id) => activeIds.has(id)).length]));
  const dependents = new Map<string, string[]>();
  for (const entry of activeEntries) for (const dependency of entry.dependencies.filter((id) => activeIds.has(id))) dependents.set(dependency, [...(dependents.get(dependency) ?? []), entry.id]);
  const queue = activeEntries.filter((entry) => degree.get(entry.id) === 0);
  const result: OperationalPlanEntry[] = [];
  while (queue.length) {
    const entry = queue.shift()!;
    result.push(entry);
    for (const dependent of dependents.get(entry.id) ?? []) {
      const next = degree.get(dependent)! - 1;
      degree.set(dependent, next);
      if (next === 0) queue.push(activeEntries.find((candidate) => candidate.id === dependent)!);
    }
  }
  return result;
}

function runSearch(
  args: {
    input: ProposeWorkPlanInput;
    plan: OperationalPlanContent;
    snapshots: readonly PlanResourceSnapshot[];
    ordered: readonly OperationalPlanEntry[];
    materials: ReadonlyMap<string, readonly z.infer<typeof PlanMaterialConstraintSchema>[]>;
    initial: SearchState;
    start: number;
    end: number;
    searchLimit: number;
  },
  visited: () => number,
  visit: () => void,
): SearchResult {
  let best = cloneState(args.initial), failedEntryId: string | undefined, exhausted = false;
  const recurse = (index: number, state: SearchState): SearchState | null => {
    if (state.placements.size > best.placements.size) best = cloneState(state);
    if (index >= args.ordered.length) return state;
    if (visited() >= args.searchLimit) { exhausted = true; return null; }
    const entry = args.ordered[index]!;
    const dependencyFinish = entry.dependencies.reduce((latest, id) => Math.max(latest, state.finishByEntry.get(id) ?? args.start), args.start);
    const materialReady = (args.materials.get(entry.id) ?? []).reduce((latest, item) => Math.max(latest, item.availableAt ? Date.parse(item.availableAt) : args.start), args.start);
    const earliest = Math.max(args.start, dependencyFinish, materialReady);
    const effort = effortForEntry(entry)!;
    const options = placementOptions(entry, args.snapshots, state.occupied, earliest, args.end, args.input.objective, effort, args.plan.timezone);
    if (!options.length) { failedEntryId ??= entry.id; return null; }
    for (const placement of options) {
      if (visited() >= args.searchLimit) { exhausted = true; return null; }
      visit();
      const next = cloneState(state);
      next.placements.set(entry.id, placement);
      next.finishByEntry.set(entry.id, placement.end);
      addOccupied(next.occupied, placement.resourceId, { start: placement.start, end: placement.end });
      const result = recurse(index + 1, next);
      if (result) return result;
    }
    return null;
  };
  const complete = recurse(0, cloneState(args.initial));
  return { complete: Boolean(complete), exhausted, best: complete ?? best, ...(failedEntryId ? { failedEntryId } : {}) };
}

function placementOptions(
  entry: OperationalPlanEntry,
  snapshots: readonly PlanResourceSnapshot[],
  occupied: ReadonlyMap<string, readonly InstantWindow[]>,
  earliest: number,
  end: number,
  objective: z.infer<typeof PlanObjectiveSchema>,
  effort: { decimal: string; unit: string; minutes: number },
  timezone: string,
): Placement[] {
  const duration = entry.durationMinutes!;
  if (effort.minutes > duration + 1e-9) return [];
  const preferredAssignments = canonicalAssignments(entry);
  const preferredResource = preferredAssignments[0]?.resourceId;
  const preferredWindow = entryWindow(entry, timezone);
  const eligibleSnapshots = snapshots.filter((snapshot) => eligible(snapshot, entry));
  eligibleSnapshots.sort((a, b) => {
    if (objective === 'least-change') {
      const preferred = Number(b.resource.id === preferredResource) - Number(a.resource.id === preferredResource);
      if (preferred) return preferred;
    }
    if (objective === 'lowest-known-cost') {
      const cost = (a.knownCostPerHourMinorUnits ?? Number.POSITIVE_INFINITY) - (b.knownCostPerHourMinorUnits ?? Number.POSITIVE_INFINITY);
      if (cost) return cost;
    }
    return a.resource.id.localeCompare(b.resource.id);
  });
  const options: Placement[] = [];
  for (const snapshot of eligibleSnapshots) {
    const windows = availabilityWindows(snapshot.availabilityVersion!, earliest, end);
    const blockers = [...(occupied.get(snapshot.resource.id) ?? [])].sort((a, b) => a.start - b.start || a.end - b.end);
    for (const window of windows) {
      const starts = new Set<number>([window.start, earliest, ...blockers.filter((item) => item.end > window.start && item.end < window.end).map((item) => item.end)]);
      if (objective === 'least-change' && preferredWindow) starts.add(preferredWindow.start);
      for (const start of [...starts].sort((a, b) => objective === 'least-change' && preferredWindow ? Math.abs(a - preferredWindow.start) - Math.abs(b - preferredWindow.start) || a - b : a - b)) {
        const finish = start + duration * 60_000;
        if (start < window.start || finish > window.end || start < earliest || finish > end) continue;
        if (blockers.some((item) => item.start < finish && item.end > start)) continue;
        options.push({ entryId: entry.id, resourceId: snapshot.resource.id, resourceRevision: snapshot.resource.revision, availabilityVersionId: snapshot.availabilityVersion!.id, start, end: finish, effort: { decimal: effort.decimal, unit: effort.unit } });
      }
    }
  }
  return options.sort((a, b) => {
    if (objective === 'earliest-finish') return a.end - b.end || a.start - b.start || a.resourceId.localeCompare(b.resourceId);
    if (objective === 'least-change' && preferredWindow) return Math.abs(a.start - preferredWindow.start) - Math.abs(b.start - preferredWindow.start) || a.end - b.end;
    return a.end - b.end || a.resourceId.localeCompare(b.resourceId);
  });
}

function applyPlacements(plan: OperationalPlanContent, placements: ReadonlyMap<string, Placement>): OperationalPlanContent {
  return validateOperationalPlan({
    ...structuredClone(plan),
    entries: plan.entries.map((entry) => {
      const placement = placements.get(entry.id);
      if (!placement) return structuredClone(entry);
      const assignment = {
        resourceId: placement.resourceId,
        resourceRevision: placement.resourceRevision,
        availabilityVersionId: placement.availabilityVersionId,
        effort: placement.effort,
      };
      return {
        ...structuredClone(entry),
        startDate: undefined,
        endDate: undefined,
        startAt: new Date(placement.start).toISOString(),
        endAt: new Date(placement.end).toISOString(),
        assignments: [assignment],
        resourceIds: [assignment.resourceId],
        availabilityVersionIds: [assignment.availabilityVersionId],
        capacityOverride: undefined,
      };
    }),
  });
}

function appendConstraintConflicts(
  plan: OperationalPlanContent,
  materials: ReadonlyMap<string, readonly z.infer<typeof PlanMaterialConstraintSchema>[]>,
  locked: ReadonlySet<string>,
  conflicts: ProposeWorkPlanResult['conflicts'],
  timezone: string,
) {
  const byId = new Map(plan.entries.map((entry) => [entry.id, entry]));
  for (const entry of plan.entries.filter(active)) {
    const interval = entryWindow(entry, timezone);
    if (!interval) continue;
    for (const dependencyId of entry.dependencies) {
      const dependency = byId.get(dependencyId);
      const dependencyInterval = dependency && entryWindow(dependency, timezone);
      if (dependencyInterval && dependencyInterval.end > interval.start) conflicts.push({ entryIds: [dependencyId, entry.id], code: 'dependency-order', sourceRefs: uniqueRefs([...entryRefs(dependency!), ...entryRefs(entry)]) });
    }
    for (const material of materials.get(entry.id) ?? []) if (material.availableAt && Date.parse(material.availableAt) > interval.start) conflicts.push({ entryIds: [entry.id], code: 'material-after-window', sourceRefs: [material.sourceRef] });
    if (locked.has(entry.id) && !canonicalAssignments(entry).length) conflicts.push({ entryIds: [entry.id], code: 'locked-assignment-invalid', sourceRefs: entryRefs(entry) });
  }
}

function addUnresolved(
  unresolved: ProposeWorkPlanResult['unresolved'],
  ids: Set<string>,
  entry: OperationalPlanEntry,
  code: PlanConstraintCode,
  refs: readonly SourceRef[] = entryRefs(entry),
) {
  unresolved.push({ entryId: entry.id, code, sourceRefs: uniqueRefs(refs) });
  ids.add(entry.id);
}

function addOccupied(map: Map<string, InstantWindow[]>, resourceId: string, window: InstantWindow) {
  map.set(resourceId, [...(map.get(resourceId) ?? []), { ...window }]);
}

function cloneState(state: SearchState): SearchState {
  return {
    placements: new Map([...state.placements].map(([id, placement]) => [id, { ...placement, effort: { ...placement.effort } }])),
    occupied: new Map([...state.occupied].map(([id, windows]) => [id, windows.map((window) => ({ ...window }))])),
    finishByEntry: new Map(state.finishByEntry),
  };
}

function dedupeIssues(items: ProposeWorkPlanResult['unresolved']) {
  return [...new Map(items.map((item) => [`${item.entryId}:${item.code}`, item])).values()];
}

function dedupeConflicts(items: ProposeWorkPlanResult['conflicts']) {
  return [...new Map(items.map((item) => [`${[...item.entryIds].sort().join(',')}:${item.resourceId ?? ''}:${item.code}`, item])).values()];
}
