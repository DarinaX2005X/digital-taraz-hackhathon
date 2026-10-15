import Decimal from 'decimal.js';

import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import type { OperationalPlanContent, OperationalPlanEntry } from './model';
import { canonicalAssignments } from './model';
import type { AvailabilityVersion, CapacityAssessment, ResourceAssignment, WorkResource } from '../contracts';
import {
  availabilityWindows,
  availabilityWindowsForDates,
  localDateMinuteToInstant,
  minutesCovered,
  minutesInWindows,
  zonedParts,
  type InstantWindow,
} from './time';

const MAX_SCOPE_DAYS = 732;
const MAX_ASSIGNMENTS = 20_000;

export function capacityAssessmentKey(assessment: CapacityAssessment) {
  return hashJson({
    resourceId: assessment.resourceId,
    availabilityVersionId: assessment.availabilityVersionId ?? null,
    status: assessment.status,
    scope: assessment.scope,
    timezone: assessment.timezone ?? null,
    start: assessment.start ?? null,
    end: assessment.end ?? null,
    demandedMinutes: assessment.demandedMinutes ?? null,
    availableMinutes: assessment.availableMinutes ?? null,
    affectedEntryIds: [...assessment.affectedEntryIds].sort(),
    reasons: [...assessment.reasons].sort(),
  } as JsonValue);
}

interface Demand {
  resourceId: string;
  version?: AvailabilityVersion;
  entry: OperationalPlanEntry;
  assignment: ResourceAssignment;
  window?: InstantWindow;
  scope: CapacityAssessment['scope'];
  demandedMinutes?: number;
  reasons: CapacityAssessment['reasons'];
}

export function assessPlanCapacity(input: {
  plan: OperationalPlanContent;
  resources: readonly WorkResource[];
  availabilityVersions: readonly AvailabilityVersion[];
}): CapacityAssessment[] {
  const resources = new Map(input.resources.map((resource) => [resource.id, resource]));
  const versions = new Map(input.availabilityVersions.map((version) => [version.id, version]));
  const demands: Demand[] = [];
  for (const entry of input.plan.entries) {
    const assignments = canonicalAssignments(entry);
    if (!assignments.length) continue;
    for (const assignment of assignments) {
      if (demands.length >= MAX_ASSIGNMENTS) {
        return [{ resourceId: assignment.resourceId, status: 'availability-unknown', scope: 'unresolved', affectedEntryIds: [entry.id], reasons: ['scope-too-large'] }];
      }
      const resource = resources.get(assignment.resourceId), version = assignment.availabilityVersionId ? versions.get(assignment.availabilityVersionId) : undefined;
      const reasons: Demand['reasons'] = [];
      if (!resource) reasons.push('resource-unassigned');
      else if (resource.status === 'archived') reasons.push('resource-archived');
      if (!assignment.availabilityVersionId || !version) reasons.push('availability-version-missing');
      else if (version.resourceId !== assignment.resourceId || version.workspaceId !== resource?.workspaceId) reasons.push('availability-version-mismatch');
      const effort = assignmentEffortMinutes(entry, assignment, assignments.length);
      if (effort.reason) reasons.push(effort.reason);
      const schedule = scheduleWindow(entry, version?.timezone ?? resource?.timezone ?? input.plan.timezone);
      if (schedule.reason) reasons.push(schedule.reason);
      if (version && schedule.localStart && (schedule.localStart < version.effectiveFrom || version.effectiveTo !== null && schedule.localEnd! > version.effectiveTo)) reasons.push('availability-not-effective');
      demands.push({ resourceId: assignment.resourceId, version, entry, assignment, window: schedule.window, scope: schedule.scope, demandedMinutes: effort.minutes, reasons });
    }
  }
  const result: CapacityAssessment[] = [];
  for (const demand of demands) {
    if (demand.reasons.includes('resource-archived')) {
      result.push({
        resourceId: demand.resourceId,
        ...(demand.assignment.availabilityVersionId ? { availabilityVersionId: demand.assignment.availabilityVersionId } : {}),
        status: 'conflict', scope: demand.scope,
        ...(demand.version ? { timezone: demand.version.timezone } : {}),
        ...(demand.window ? { start: new Date(demand.window.start).toISOString(), end: new Date(demand.window.end).toISOString() } : {}),
        ...(demand.demandedMinutes === undefined ? {} : { demandedMinutes: demand.demandedMinutes }),
        affectedEntryIds: [demand.entry.id], reasons: [...new Set(demand.reasons)],
      });
      continue;
    }
    if (demand.reasons.length || !demand.version || !demand.window || demand.demandedMinutes === undefined) {
      result.push(unknown(demand));
      continue;
    }
    let available: InstantWindow[];
    try {
      available = demand.scope === 'local-date-range' && demand.entry.startDate && demand.entry.endDate
        ? availabilityWindowsForDates(demand.version, demand.entry.startDate, demand.entry.endDate, MAX_SCOPE_DAYS)
        : availabilityWindows(demand.version, demand.window.start, demand.window.end, MAX_SCOPE_DAYS);
    } catch {
      result.push(unknown({ ...demand, reasons: ['scope-too-large'] })); continue;
    }
    const availableMinutes = minutesCovered(demand.window, available);
    const reasons: CapacityAssessment['reasons'] = [];
    if (demand.scope === 'instant-window' && availableMinutes + 1e-9 < (demand.window.end - demand.window.start) / 60_000) reasons.push('scheduled-outside-availability');
    if (demand.demandedMinutes > availableMinutes + 1e-9) reasons.push('effort-exceeds-window');
    result.push({
      resourceId: demand.resourceId,
      ...(demand.assignment.availabilityVersionId ? { availabilityVersionId: demand.assignment.availabilityVersionId } : {}),
      status: reasons.length ? 'conflict' : 'within-known-capacity',
      scope: demand.scope,
      timezone: demand.version.timezone,
      start: new Date(demand.window.start).toISOString(), end: new Date(demand.window.end).toISOString(),
      demandedMinutes: demand.demandedMinutes, availableMinutes,
      affectedEntryIds: [demand.entry.id], reasons,
    });
  }
  appendOverlapConflicts(result, demands);
  return coalesce(result);
}

function assignmentEffortMinutes(entry: OperationalPlanEntry, assignment: ResourceAssignment, count: number): { minutes?: number; reason?: 'effort-missing' | 'effort-unit-unknown' } {
  const effort = assignment.effort ?? (count === 1 ? entry.effort : undefined);
  if (!effort) return { reason: 'effort-missing' };
  const unit = effort.unit.trim().toLocaleLowerCase('en-US').replaceAll('_', '-');
  let multiplier: Decimal;
  if (['minute', 'minutes', 'min', 'm', 'person-minute', 'person-minutes'].includes(unit)) multiplier = new Decimal(1);
  else if (['hour', 'hours', 'h', 'hr', 'person-hour', 'person-hours'].includes(unit)) multiplier = new Decimal(60);
  else return { reason: 'effort-unit-unknown' };
  const value = new Decimal(effort.decimal).mul(multiplier);
  return value.isFinite() && value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(1e9) ? { minutes: value.toNumber() } : { reason: 'effort-unit-unknown' };
}

function scheduleWindow(entry: OperationalPlanEntry, timezone: string): { window?: InstantWindow; scope: CapacityAssessment['scope']; localStart?: string; localEnd?: string; reason?: 'schedule-missing' | 'duration-missing' } {
  if (entry.startAt && entry.endAt) {
    const start = Date.parse(entry.startAt), end = Date.parse(entry.endAt);
    if (!(end > start)) return { scope: 'unresolved', reason: 'schedule-missing' };
    return { scope: 'instant-window', window: { start, end }, localStart: zonedParts(start, timezone).date, localEnd: zonedParts(end - 1, timezone).date };
  }
  if (entry.startDate && entry.endDate) {
    if (entry.durationMinutes === undefined) return { scope: 'unresolved', localStart: entry.startDate, localEnd: entry.endDate, reason: 'duration-missing' };
    try {
      const start = localDateMinuteToInstant(entry.startDate, 0, timezone, 'start');
      const end = localDateMinuteToInstant(entry.endDate, 1440, timezone, 'end');
      return { scope: 'local-date-range', window: { start, end }, localStart: entry.startDate, localEnd: entry.endDate };
    } catch { return { scope: 'unresolved', reason: 'schedule-missing' }; }
  }
  return { scope: 'unresolved', reason: 'schedule-missing' };
}

function unknown(demand: Demand): CapacityAssessment {
  const reasons: CapacityAssessment['reasons'] = demand.reasons.length ? [...demand.reasons] : ['availability-version-missing'];
  return {
    resourceId: demand.resourceId,
    ...(demand.assignment.availabilityVersionId ? { availabilityVersionId: demand.assignment.availabilityVersionId } : {}),
    status: 'availability-unknown', scope: demand.scope,
    ...(demand.version ? { timezone: demand.version.timezone } : {}),
    ...(demand.window ? { start: new Date(demand.window.start).toISOString(), end: new Date(demand.window.end).toISOString() } : {}),
    ...(demand.demandedMinutes === undefined ? {} : { demandedMinutes: demand.demandedMinutes }),
    affectedEntryIds: [demand.entry.id], reasons: [...new Set(reasons)],
  };
}

function appendOverlapConflicts(results: CapacityAssessment[], demands: readonly Demand[]) {
  const byVersion = new Map<string, Demand[]>();
  for (const demand of demands) if (demand.version && demand.window && demand.demandedMinutes !== undefined && !demand.reasons.length) {
    const key = `${demand.resourceId}:${demand.version.id}`;
    byVersion.set(key, [...(byVersion.get(key) ?? []), demand]);
  }
  for (const group of byVersion.values()) {
    const timed = group.filter((item) => item.scope === 'instant-window');
    const boundaries = [...new Set(timed.flatMap((item) => [item.window!.start, item.window!.end]))].sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index]!, end = boundaries[index + 1]!;
      if (end <= start) continue;
      const active = timed.filter((item) => item.window!.start < end && item.window!.end > start);
      if (active.length < 2) continue;
      const available = availabilityWindows(active[0]!.version!, start, end, MAX_SCOPE_DAYS);
      const availableMinutes = minutesInWindows(available);
      const demandMinutes = active.reduce((sum, item) => sum + item.demandedMinutes! * (end - start) / (item.window!.end - item.window!.start), 0);
      if (demandMinutes <= availableMinutes + 1e-9) continue;
      results.push({ resourceId: active[0]!.resourceId, availabilityVersionId: active[0]!.version!.id, status: 'conflict', scope: 'instant-window', timezone: active[0]!.version!.timezone, start: new Date(start).toISOString(), end: new Date(end).toISOString(), demandedMinutes: demandMinutes, availableMinutes, affectedEntryIds: [...new Set(active.map((item) => item.entry.id))], reasons: ['overlapping-effort-exceeds-capacity'] });
    }
    const dated = group.filter((item) => item.scope === 'local-date-range').sort((a, b) => a.window!.start - b.window!.start);
    const components: Demand[][] = [];
    for (const item of dated) {
      const last = components.at(-1), maxEnd = last ? Math.max(...last.map((entry) => entry.window!.end)) : -Infinity;
      if (!last || item.window!.start >= maxEnd) components.push([item]); else last.push(item);
    }
    for (const component of components) {
      if (component.length < 2) continue;
      const start = Math.min(...component.map((item) => item.window!.start)), end = Math.max(...component.map((item) => item.window!.end));
      const available = minutesInWindows(availabilityWindows(component[0]!.version!, start, end, MAX_SCOPE_DAYS));
      const demanded = component.reduce((sum, item) => sum + item.demandedMinutes!, 0);
      if (demanded <= available + 1e-9) continue;
      results.push({ resourceId: component[0]!.resourceId, availabilityVersionId: component[0]!.version!.id, status: 'conflict', scope: 'local-date-range', timezone: component[0]!.version!.timezone, start: new Date(start).toISOString(), end: new Date(end).toISOString(), demandedMinutes: demanded, availableMinutes: available, affectedEntryIds: component.map((item) => item.entry.id), reasons: ['overlapping-effort-exceeds-capacity'] });
    }
  }
}

function coalesce(input: CapacityAssessment[]): CapacityAssessment[] {
  const byKey = new Map<string, CapacityAssessment>();
  for (const assessment of input) {
    const key = [assessment.resourceId, assessment.availabilityVersionId ?? '', assessment.scope, assessment.start ?? '', assessment.end ?? '', [...assessment.affectedEntryIds].sort().join(',')].join('|');
    const previous = byKey.get(key);
    if (!previous) { byKey.set(key, assessment); continue; }
    const rank = { 'within-known-capacity': 0, 'availability-unknown': 1, conflict: 2 } as const;
    const demandedMinutes = previous.demandedMinutes === undefined && assessment.demandedMinutes === undefined ? undefined : Math.max(previous.demandedMinutes ?? 0, assessment.demandedMinutes ?? 0);
    const knownAvailability = [previous.availableMinutes, assessment.availableMinutes].filter((value): value is number => value !== undefined);
    const availableMinutes = knownAvailability.length ? Math.min(...knownAvailability) : undefined;
    byKey.set(key, {
      ...previous,
      status: rank[assessment.status] > rank[previous.status] ? assessment.status : previous.status,
      ...(demandedMinutes === undefined ? {} : { demandedMinutes }),
      ...(availableMinutes === undefined ? {} : { availableMinutes }),
      reasons: [...new Set([...previous.reasons, ...assessment.reasons])],
    });
  }
  return [...byKey.values()];
}

