import type { SourceRef } from '@/contracts/artifacts';

import type { ArtifactContent, PlanEntry } from '@/features/artifacts/domain/content-models';
import { ContentValidationError, hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import {
  OperationalPlanEntrySchema,
  type OperationalEntryFields,
  type ResourceAssignment,
} from '../contracts';
import { addCalendarDays, localDateMinuteToInstant, zonedParts } from './time';

export type PlanContent = Extract<ArtifactContent, { kind: 'plan' }>;
export type OperationalPlanEntry = PlanEntry & OperationalEntryFields;
export type OperationalPlanContent = Omit<PlanContent, 'entries'> & { entries: OperationalPlanEntry[] };

export function requirePlan(content: ArtifactContent): OperationalPlanContent {
  if (content.kind !== 'plan') throw new ContentValidationError('operations.errors.planRequired');
  for (const entry of content.entries) OperationalPlanEntrySchema.parse(entry);
  return content as OperationalPlanContent;
}

export function canonicalAssignments(entry: OperationalPlanEntry): ResourceAssignment[] {
  const explicit = entry.assignments ?? [];
  const seen = new Set<string>();
  const normalized: ResourceAssignment[] = [];
  for (const assignment of explicit) {
    if (seen.has(assignment.resourceId)) throw new ContentValidationError('operations.errors.duplicateResource');
    seen.add(assignment.resourceId); normalized.push(structuredClone(assignment));
  }
  for (let index = 0; index < entry.resourceIds.length; index += 1) {
    const resourceId = entry.resourceIds[index]!;
    if (seen.has(resourceId)) continue;
    seen.add(resourceId);
    normalized.push({ resourceId, ...(entry.availabilityVersionIds[index] ? { availabilityVersionId: entry.availabilityVersionIds[index] } : {}) });
  }
  return normalized;
}

export function normalizeEntry(entry: OperationalPlanEntry): OperationalPlanEntry {
  const candidate = OperationalPlanEntrySchema.parse(entry) as OperationalPlanEntry;
  const assignments = canonicalAssignments(candidate);
  const linkedArtifactIds = [...new Set(candidate.linkedArtifactIds ?? [])];
  const sourceRefs = uniqueSourceRefs(candidate.sourceRefs ?? []);
  return {
    ...structuredClone(candidate),
    resourceIds: assignments.map((item) => item.resourceId),
    availabilityVersionIds: assignments.flatMap((item) => item.availabilityVersionId ? [item.availabilityVersionId] : []),
    ...(assignments.length ? { assignments } : { assignments: [] }),
    ...(linkedArtifactIds.length ? { linkedArtifactIds } : {}),
    ...(sourceRefs.length ? { sourceRefs } : {}),
  };
}

export function validateOperationalPlan(content: OperationalPlanContent): OperationalPlanContent {
  assertTimeZone(content.timezone);
  const entries = content.entries.map((entry) => normalizeEntry(entry));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new ContentValidationError('duplicate-element-id');
    ids.add(entry.id);
    validateSchedule(entry);
    if (new Set(entry.dependencies).size !== entry.dependencies.length || entry.dependencies.includes(entry.id)) throw new ContentValidationError('operations.errors.invalidDependency');
    if (new Set(entry.checklist.map((item) => item.id)).size !== entry.checklist.length) throw new ContentValidationError('operations.errors.duplicateChecklistItem');
  }
  for (const entry of entries) if (entry.dependencies.some((id) => !ids.has(id))) throw new ContentValidationError('missing-plan-dependency');
  assertAcyclic(entries);
  return { ...structuredClone(content), entries };
}

export function validateSchedule(entry: OperationalPlanEntry) {
  const local = Boolean(entry.startDate || entry.endDate), instant = Boolean(entry.startAt || entry.endAt);
  if (local && instant || Boolean(entry.startDate) !== Boolean(entry.endDate) || Boolean(entry.startAt) !== Boolean(entry.endAt)) throw new ContentValidationError('mixed-plan-time');
  if (entry.startDate && entry.endDate && entry.startDate > entry.endDate) throw new ContentValidationError('reversed-plan-time');
  if (entry.startAt && entry.endAt && Date.parse(entry.startAt) > Date.parse(entry.endAt)) throw new ContentValidationError('reversed-plan-time');
}

export function assertAcyclic(entries: readonly Pick<OperationalPlanEntry, 'id' | 'dependencies'>[]) {
  const degree = new Map(entries.map((entry) => [entry.id, entry.dependencies.length]));
  const dependents = new Map<string, string[]>();
  for (const entry of entries) for (const dependency of entry.dependencies) dependents.set(dependency, [...(dependents.get(dependency) ?? []), entry.id]);
  const queue = [...degree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    visited += 1;
    for (const id of dependents.get(queue[index]!) ?? []) {
      const next = degree.get(id)! - 1; degree.set(id, next); if (next === 0) queue.push(id);
    }
  }
  if (visited !== entries.length) throw new ContentValidationError('cyclic-plan-dependency');
}

export function updateEntry(content: OperationalPlanContent, id: string, patch: Partial<OperationalPlanEntry>): OperationalPlanContent {
  if (patch.id !== undefined && patch.id !== id) throw new ContentValidationError('cannot-change-stable-id');
  const index = content.entries.findIndex((entry) => entry.id === id);
  if (index < 0) throw new ContentValidationError('missing-target');
  const entries = content.entries.map((entry, position) => position === index
    ? incrementCalendarSequence(entry, normalizeEntry({ ...entry, ...structuredClone(patch), id }))
    : structuredClone(entry));
  return validateOperationalPlan({ ...content, entries });
}

export function insertEntry(content: OperationalPlanContent, entry: OperationalPlanEntry, beforeId: string | null = null): OperationalPlanContent {
  if (content.entries.some((item) => item.id === entry.id)) throw new ContentValidationError('duplicate-element-id');
  const position = beforeId === null ? content.entries.length : content.entries.findIndex((item) => item.id === beforeId);
  if (position < 0) throw new ContentValidationError('invalid-insert-position');
  const entries = content.entries.map((item) => structuredClone(item));
  entries.splice(position, 0, normalizeEntry(entry));
  return validateOperationalPlan({ ...content, entries });
}

export function removeEntries(content: OperationalPlanContent, ids: readonly string[]): OperationalPlanContent {
  const removed = new Set(ids);
  if (removed.size !== ids.length || ids.some((id) => !content.entries.some((entry) => entry.id === id))) throw new ContentValidationError('missing-target');
  const entries = content.entries.filter((entry) => !removed.has(entry.id)).map((entry) => ({ ...structuredClone(entry), dependencies: entry.dependencies.filter((id) => !removed.has(id)) }));
  return validateOperationalPlan({ ...content, entries });
}

export function reorderEntry(content: OperationalPlanContent, id: string, beforeId: string | null): OperationalPlanContent {
  if (id === beforeId) return content;
  const entries = content.entries.map((item) => structuredClone(item));
  const from = entries.findIndex((entry) => entry.id === id);
  if (from < 0) throw new ContentValidationError('missing-target');
  const [entry] = entries.splice(from, 1);
  const to = beforeId === null ? entries.length : entries.findIndex((item) => item.id === beforeId);
  if (to < 0) throw new ContentValidationError('invalid-insert-position');
  entries.splice(to, 0, entry!);
  return validateOperationalPlan({ ...content, entries });
}

export function duplicateEntry(content: OperationalPlanContent, id: string, newId: string, checklistId: () => string, beforeId: string | null = null): OperationalPlanContent {
  const source = content.entries.find((entry) => entry.id === id);
  if (!source) throw new ContentValidationError('missing-target');
  const copy: OperationalPlanEntry = {
    ...structuredClone(source), id: newId,
    title: source.title, status: 'todo',
    dependencies: [...source.dependencies],
    checklist: source.checklist.map((item) => ({ ...item, id: checklistId(), done: false })),
    calendar: undefined,
    capacityOverride: undefined,
  };
  return insertEntry(content, copy, beforeId);
}

export function bulkUpdateEntries(content: OperationalPlanContent, ids: readonly string[], patch: Pick<Partial<OperationalPlanEntry>, 'status' | 'assignments'>): OperationalPlanContent {
  const selected = new Set(ids);
  if (selected.size !== ids.length || ids.some((id) => !content.entries.some((entry) => entry.id === id))) throw new ContentValidationError('missing-target');
  return validateOperationalPlan({ ...content, entries: content.entries.map((entry) => selected.has(entry.id)
    ? incrementCalendarSequence(entry, normalizeEntry({ ...structuredClone(entry), ...structuredClone(patch) }))
    : structuredClone(entry)) });
}

export function shiftEntry(content: OperationalPlanContent, id: string, days: number): OperationalPlanContent {
  const entry = content.entries.find((item) => item.id === id);
  if (!entry) throw new ContentValidationError('missing-target');
  if (!Number.isInteger(days) || Math.abs(days) > 3660) throw new ContentValidationError('operations.errors.invalidShift');
  if (entry.startDate && entry.endDate) return updateEntry(content, id, { startDate: addCalendarDays(entry.startDate, days), endDate: addCalendarDays(entry.endDate, days), capacityOverride: undefined });
  if (entry.startAt && entry.endAt) {
    const shift = (instant: string, edge: 'start' | 'end') => {
      const local = zonedParts(instant, content.timezone);
      return new Date(localDateMinuteToInstant(addCalendarDays(local.date, days), local.hour * 60 + local.minute, content.timezone, edge) + local.second * 1000).toISOString();
    };
    return updateEntry(content, id, { startAt: shift(entry.startAt, 'start'), endAt: shift(entry.endAt, 'end'), capacityOverride: undefined });
  }
  throw new ContentValidationError('operations.errors.scheduleRequired');
}

export function moveEntryToLocalDate(content: OperationalPlanContent, id: string, targetDate: string): OperationalPlanContent {
  const entry = content.entries.find((item) => item.id === id);
  if (!entry) throw new ContentValidationError('missing-target');
  const currentDate = entry.startDate ?? (entry.startAt ? zonedParts(entry.startAt, content.timezone).date : undefined);
  if (!currentDate) throw new ContentValidationError('operations.errors.scheduleRequired');
  const days = Math.round((Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${currentDate}T00:00:00Z`)) / 86_400_000);
  return shiftEntry(content, id, days);
}

export function entryFingerprint(entry: OperationalPlanEntry): string {
  const meaningful = structuredClone(entry);
  delete meaningful.calendar;
  return hashJson(meaningful as unknown as JsonValue);
}

export function incrementCalendarSequence(before: OperationalPlanEntry | undefined, after: OperationalPlanEntry): OperationalPlanEntry {
  if (!before?.calendar || !after.calendar || before.calendar.uid !== after.calendar.uid) return after;
  const changed = entryFingerprint(before) !== entryFingerprint(after);
  return changed ? { ...after, calendar: { ...after.calendar, sequence: Math.max(before.calendar.sequence + 1, after.calendar.sequence) } } : after;
}

function uniqueSourceRefs(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>(), result: SourceRef[] = [];
  for (const ref of refs) {
    const key = hashJson(ref as unknown as JsonValue);
    if (!seen.has(key)) { seen.add(key); result.push(structuredClone(ref)); }
  }
  return result;
}

function assertTimeZone(timezone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
  catch { throw new ContentValidationError('invalid-timezone'); }
}

