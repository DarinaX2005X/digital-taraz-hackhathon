import { createHash } from 'node:crypto';

import type { OperationalPlanContent, OperationalPlanEntry } from './domain/model';
import { addCalendarDays, localDateMinuteToInstant } from './domain/time';
import { insertEntry, validateOperationalPlan } from './domain/model';

export interface CalendarExportMetadata {
  artifactId: string;
  title: string;
  revision: number;
  createdAt: string;
  locale: 'ru' | 'kk' | 'en';
  includeInternalNotes?: boolean;
}

export interface ParsedCalendarEvent {
  uid: string;
  sequence: number;
  title: string;
  description?: string;
  status?: 'todo' | 'in-progress' | 'done' | 'cancelled';
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  relatedUids: string[];
}

export interface CalendarImportResult {
  content: OperationalPlanContent;
  inserted: string[];
  updated: string[];
  unchanged: string[];
  ignoredOlder: string[];
  conflicts: { uid: string; reason: 'same-sequence-different-content' }[];
}

const CRLF = '\r\n';

export function exportPlanCalendar(content: OperationalPlanContent, metadata: CalendarExportMetadata): Uint8Array {
  const timestamp = icsInstant(metadata.createdAt);
  const byId = new Map(content.entries.map((entry) => [entry.id, entry]));
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Tirlik//Work plan//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(metadata.title)}`,
    `X-WR-TIMEZONE:${escapeText(content.timezone)}`,
    `X-TIRLIK-ARTIFACT-ID:${metadata.artifactId}`,
    `X-TIRLIK-REVISION:${metadata.revision}`,
  ];
  for (const entry of content.entries) {
    if (!(entry.startDate && entry.endDate) && !(entry.startAt && entry.endAt)) continue;
    const uid = entry.calendar?.uid ?? stableCalendarUid(metadata.artifactId, entry.id);
    const sequence = entry.calendar?.sequence ?? Math.min(metadata.revision, 2147483647);
    lines.push('BEGIN:VEVENT', `UID:${escapeText(uid)}`, `SEQUENCE:${sequence}`, `DTSTAMP:${timestamp}`, `LAST-MODIFIED:${timestamp}`, `SUMMARY:${escapeText(entry.title)}`);
    if (entry.startDate && entry.endDate) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(entry.startDate)}`, `DTEND;VALUE=DATE:${icsDate(addCalendarDays(entry.endDate, 1))}`);
    } else lines.push(`DTSTART:${icsInstant(entry.startAt!)}`, `DTEND:${icsInstant(entry.endAt!)}`);
    // Internal notes are deliberately excluded: the shared export contract has
    // no explicit opt-in for private plan notes yet.
    const description = [entry.description, ...(metadata.includeInternalNotes ? [entry.notes] : []), ...entry.checklist.map((item) => `${item.done ? '☑' : '☐'} ${item.text}`)].filter(Boolean).join('\n');
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (entry.status === 'cancelled') lines.push('STATUS:CANCELLED');
    else if (entry.status === 'done') lines.push('STATUS:CONFIRMED', 'X-TIRLIK-STATUS:DONE');
    else if (entry.status === 'in-progress') lines.push('STATUS:CONFIRMED', 'X-TIRLIK-STATUS:IN-PROGRESS');
    else lines.push('STATUS:TENTATIVE', 'X-TIRLIK-STATUS:TODO');
    lines.push(`X-TIRLIK-ENTRY-ID:${entry.id}`, `X-TIRLIK-TIMEZONE:${escapeText(content.timezone)}`);
    for (const dependencyId of entry.dependencies) {
      const dependency = byId.get(dependencyId);
      if (dependency) lines.push(`RELATED-TO;RELTYPE=DEPENDS-ON:${escapeText(dependency.calendar?.uid ?? stableCalendarUid(metadata.artifactId, dependency.id))}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new TextEncoder().encode(lines.map(foldLine).join(CRLF) + CRLF);
}

export function parsePlanCalendar(bytes: Uint8Array | string, fallbackTimezone: string): ParsedCalendarEvent[] {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024) throw new Error('ICS_TOO_LARGE');
  const lines = unfoldLines(text);
  if (!lines.includes('BEGIN:VCALENDAR') || !lines.includes('END:VCALENDAR')) throw new Error('INVALID_ICS');
  const result: ParsedCalendarEvent[] = [], seen = new Set<string>();
  let eventLines: string[] | undefined;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { if (eventLines) throw new Error('NESTED_VEVENT'); eventLines = []; continue; }
    if (line === 'END:VEVENT') {
      if (!eventLines) throw new Error('UNBALANCED_VEVENT');
      const event = parseEvent(eventLines, fallbackTimezone);
      if (seen.has(event.uid)) throw new Error('DUPLICATE_ICS_UID');
      seen.add(event.uid); result.push(event); eventLines = undefined; continue;
    }
    if (eventLines) eventLines.push(line);
  }
  if (eventLines) throw new Error('UNBALANCED_VEVENT');
  if (result.length > 20_000) throw new Error('ICS_TOO_MANY_EVENTS');
  return result;
}

export function importPlanCalendar(
  raw: Uint8Array | string,
  current: OperationalPlanContent,
  makeId: (uid: string) => string = deterministicEntryId,
): CalendarImportResult {
  const events = parsePlanCalendar(raw, current.timezone);
  let content = validateOperationalPlan(current);
  const inserted: string[] = [], updated: string[] = [], unchanged: string[] = [], ignoredOlder: string[] = [];
  const conflicts: CalendarImportResult['conflicts'] = [];
  const originalByUid = new Map(content.entries.flatMap((entry) => entry.calendar ? [[entry.calendar.uid, entry] as const] : []));
  const idByUid = new Map([...originalByUid].map(([uid, entry]) => [uid, entry.id]));
  const reservedIds = new Set(content.entries.map((entry) => entry.id));
  for (const event of events) {
    if (idByUid.has(event.uid)) continue;
    const base = makeId(event.uid);
    let id = base, suffix = 0;
    while (reservedIds.has(id)) id = `${base.slice(0, 116)}_${++suffix}`;
    reservedIds.add(id); idByUid.set(event.uid, id);
  }
  // Insert every new UID before resolving RELATED-TO so forward references are
  // valid regardless of event order in the file.
  for (const event of events) {
    if (originalByUid.has(event.uid)) continue;
    const id = idByUid.get(event.uid)!;
    content = insertEntry(content, eventToEntry(event, id));
    inserted.push(id);
  }
  for (const event of events) {
    const id = idByUid.get(event.uid)!;
    const existing = content.entries.find((entry) => entry.id === id)!;
    const original = originalByUid.get(event.uid);
    const dependencies = [...new Set(event.relatedUids.flatMap((uid) => {
      const relatedId = idByUid.get(uid);
      return relatedId && relatedId !== id ? [relatedId] : [];
    }))];
    const next = { ...eventToPatch(event, existing), dependencies };
    if (!original) {
      if (dependencies.length) content = applyImportedPatch(content, id, next);
      continue;
    }
    const currentSequence = existing.calendar?.sequence ?? 0;
    if (event.sequence < currentSequence) { ignoredOlder.push(existing.id); continue; }
    if (event.sequence === currentSequence) {
      if (sameImportedFields(existing, next)) unchanged.push(existing.id);
      else conflicts.push({ uid: event.uid, reason: 'same-sequence-different-content' });
      continue;
    }
    content = applyImportedPatch(content, existing.id, next); updated.push(existing.id);
  }
  return { content, inserted, updated, unchanged, ignoredOlder, conflicts };
}

export function stableCalendarUid(artifactId: string, entryId: string) {
  return `${artifactId}.${entryId}@calendar.tirlik.local`;
}

function parseEvent(lines: readonly string[], fallbackTimezone: string): ParsedCalendarEvent {
  const properties = lines.map(parseProperty);
  if (properties.some((property) => property.name === 'RRULE' || property.name === 'RDATE' || property.name === 'EXDATE')) throw new Error('ICS_RECURRENCE_UNSUPPORTED');
  const uid = required(properties, 'UID').value.trim();
  if (!uid || uid.length > 512) throw new Error('ICS_UID_REQUIRED');
  const summary = required(properties, 'SUMMARY').value;
  const start = required(properties, 'DTSTART'), end = properties.find((property) => property.name === 'DTEND'), duration = properties.find((property) => property.name === 'DURATION');
  if (!end && !duration) throw new Error('ICS_END_REQUIRED');
  const sequenceRaw = properties.find((property) => property.name === 'SEQUENCE')?.value ?? '0';
  if (!/^\d{1,10}$/.test(sequenceRaw) || Number(sequenceRaw) > 2147483647) throw new Error('ICS_SEQUENCE_INVALID');
  const timezone = start.params.TZID ?? fallbackTimezone;
  const parsedStart = parseDateTime(start, fallbackTimezone, 'start');
  let parsedEnd: ReturnType<typeof parseDateTime>;
  if (end) parsedEnd = parseDateTime(end, fallbackTimezone, 'end');
  else parsedEnd = addDuration(parsedStart, duration!.value);
  if (parsedStart.kind !== parsedEnd.kind || parsedStart.value >= parsedEnd.value) throw new Error('ICS_RANGE_INVALID');
  const status = parseStatus(properties);
  return {
    uid: unescapeText(uid), sequence: Number(sequenceRaw), title: unescapeText(summary).slice(0, 1000) || 'Untitled',
    ...(properties.find((property) => property.name === 'DESCRIPTION') ? { description: unescapeText(properties.find((property) => property.name === 'DESCRIPTION')!.value).slice(0, 12000) } : {}),
    ...(status ? { status } : {}),
    ...(parsedStart.kind === 'date' ? { startDate: parsedStart.value, endDate: addCalendarDays(parsedEnd.value, -1) } : { startAt: parsedStart.value, endAt: parsedEnd.value }),
    timezone,
    relatedUids: properties.filter((property) => property.name === 'RELATED-TO' && property.params.RELTYPE === 'DEPENDS-ON').map((property) => unescapeText(property.value)),
  };
}

interface Property { name: string; params: Record<string, string>; value: string }
function parseProperty(line: string): Property {
  const separator = line.indexOf(':');
  if (separator < 1) throw new Error('ICS_PROPERTY_INVALID');
  const [rawName, ...rawParams] = line.slice(0, separator).split(';'), params: Record<string, string> = {};
  for (const raw of rawParams) {
    const equals = raw.indexOf('='); if (equals < 1) throw new Error('ICS_PARAMETER_INVALID');
    const key = raw.slice(0, equals).toUpperCase(), value = raw.slice(equals + 1).replace(/^"|"$/g, '');
    if (Object.hasOwn(params, key)) throw new Error('ICS_PARAMETER_DUPLICATE'); params[key] = value;
  }
  return { name: rawName!.toUpperCase(), params, value: line.slice(separator + 1) };
}
function required(properties: readonly Property[], name: string) {
  const matches = properties.filter((property) => property.name === name);
  if (matches.length !== 1) throw new Error(`ICS_${name}_REQUIRED`);
  return matches[0]!;
}

function parseDateTime(property: Property, fallbackTimezone: string, edge: 'start' | 'end'): { kind: 'date' | 'instant'; value: string } {
  const dateOnly = property.params.VALUE === 'DATE' || /^\d{8}$/.test(property.value);
  if (dateOnly) {
    if (!/^\d{8}$/.test(property.value)) throw new Error('ICS_DATE_INVALID');
    return { kind: 'date', value: `${property.value.slice(0, 4)}-${property.value.slice(4, 6)}-${property.value.slice(6, 8)}` };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(property.value);
  if (!match) throw new Error('ICS_DATETIME_INVALID');
  const [, year, month, day, hour, minute, second = '00', utc] = match;
  if (utc) return { kind: 'instant', value: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString() };
  const timezone = property.params.TZID ?? fallbackTimezone;
  const date = `${year}-${month}-${day}`, minuteOfDay = Number(hour) * 60 + Number(minute);
  const instant = localDateMinuteToInstant(date, minuteOfDay, timezone, edge) + Number(second) * 1000;
  return { kind: 'instant', value: new Date(instant).toISOString() };
}

function addDuration(start: { kind: 'date' | 'instant'; value: string }, duration: string): { kind: 'date' | 'instant'; value: string } {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!match) throw new Error('ICS_DURATION_INVALID');
  const days = Number(match[1] ?? 0), seconds = days * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
  if (seconds <= 0) throw new Error('ICS_DURATION_INVALID');
  return start.kind === 'date' ? { kind: 'date', value: addCalendarDays(start.value, Math.ceil(seconds / 86400)) } : { kind: 'instant', value: new Date(Date.parse(start.value) + seconds * 1000).toISOString() };
}

function parseStatus(properties: readonly Property[]): ParsedCalendarEvent['status'] {
  const tirlik = properties.find((property) => property.name === 'X-TIRLIK-STATUS')?.value.toUpperCase();
  if (tirlik === 'DONE') return 'done'; if (tirlik === 'IN-PROGRESS') return 'in-progress'; if (tirlik === 'TODO') return 'todo';
  const status = properties.find((property) => property.name === 'STATUS')?.value.toUpperCase();
  if (status === 'CANCELLED') return 'cancelled'; if (status === 'CONFIRMED') return 'in-progress'; if (status === 'TENTATIVE') return 'todo';
  return undefined;
}

function eventToEntry(event: ParsedCalendarEvent, id: string): OperationalPlanEntry {
  return {
    id, title: event.title, status: event.status ?? 'todo',
    ...(event.description ? { description: event.description } : {}),
    ...(event.startDate ? { startDate: event.startDate, endDate: event.endDate! } : { startAt: event.startAt!, endAt: event.endAt! }),
    resourceIds: [], dependencies: [], checklist: [], availabilityVersionIds: [], assignments: [],
    calendar: { uid: event.uid, sequence: event.sequence },
  };
}

function eventToPatch(event: ParsedCalendarEvent, existing: OperationalPlanEntry): Partial<OperationalPlanEntry> {
  return {
    title: event.title, status: event.status ?? existing.status,
    description: event.description,
    startDate: event.startDate, endDate: event.endDate,
    startAt: event.startAt, endAt: event.endAt,
    calendar: { uid: event.uid, sequence: event.sequence }, capacityOverride: undefined,
  };
}

function sameImportedFields(existing: OperationalPlanEntry, patch: Partial<OperationalPlanEntry>) {
  return JSON.stringify({ title: existing.title, status: existing.status, description: existing.description, startDate: existing.startDate, endDate: existing.endDate, startAt: existing.startAt, endAt: existing.endAt, dependencies: existing.dependencies }) === JSON.stringify({ title: patch.title, status: patch.status, description: patch.description, startDate: patch.startDate, endDate: patch.endDate, startAt: patch.startAt, endAt: patch.endAt, dependencies: patch.dependencies });
}

function applyImportedPatch(content: OperationalPlanContent, id: string, patch: Partial<OperationalPlanEntry>) {
  return validateOperationalPlan({ ...content, entries: content.entries.map((entry) => entry.id === id ? { ...entry, ...patch, id } : entry) });
}

function deterministicEntryId(uid: string) { return `ics_${createHash('sha256').update(uid.normalize('NFC')).digest('hex').slice(0, 32)}`; }
function icsDate(date: string) { return date.replaceAll('-', ''); }
function icsInstant(instant: string) { return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function escapeText(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,'); }
function unescapeText(value: string) { return value.replace(/\\([nN,;\\])/g, (_match, escaped: string) => escaped.toLowerCase() === 'n' ? '\n' : escaped); }

function unfoldLines(text: string): string[] {
  const raw = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const result: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && result.length) result[result.length - 1] += line.slice(1);
    else if (line) result.push(line);
  }
  return result;
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).byteLength <= 75) return line;
  const chunks: string[] = []; let current = '', limit = 75;
  for (const character of line) {
    if (encoder.encode(current + character).byteLength > limit && current) { chunks.push(current); current = character; limit = 74; }
    else current += character;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => index ? ` ${chunk}` : chunk).join(CRLF);
}

