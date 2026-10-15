import type { AvailabilityInterval, AvailabilityVersion } from '../contracts';


const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export interface ZonedParts { date: string; year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

function parseDate(date: string) {
  const match = datePattern.exec(date);
  if (!match) throw new Error('INVALID_CALENDAR_DATE');
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function addCalendarDays(date: string, days: number): string {
  const parts = parseDate(date), value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function calendarDays(start: string, end: string, limit = 732): string[] {
  if (start > end) throw new Error('REVERSED_CALENDAR_RANGE');
  const result: string[] = [];
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) {
    if (result.length >= limit) throw new Error('CALENDAR_RANGE_TOO_LARGE');
    result.push(date);
  }
  return result;
}

export function weekday(date: string): number {
  const parts = parseDate(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() || 7;
}

function formatter(timezone: string) {
  let value = formatterCache.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', weekday: 'short',
    });
    formatterCache.set(timezone, value);
  }
  return value;
}

export function zonedParts(instant: string | number | Date, timezone: string): ZonedParts {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), weekday: weekdayMap[parts.weekday!]! };
}

export function localDateMinuteToInstant(date: string, minute: number, timezone: string, edge: 'start' | 'end'): number {
  const parts = parseDate(date), dayOffset = Math.floor(minute / 1440), minuteOfDay = ((minute % 1440) + 1440) % 1440;
  const normalizedDate = addCalendarDays(date, dayOffset);
  const normalized = parseDate(normalizedDate);
  const targetHour = Math.floor(minuteOfDay / 60), targetMinute = minuteOfDay % 60;
  const wall = Date.UTC(normalized.year, normalized.month - 1, normalized.day, targetHour, targetMinute, 0);
  const offsets = new Set<number>();
  for (const probe of [wall - 86_400_000, wall - 21_600_000, wall, wall + 21_600_000, wall + 86_400_000]) {
    const local = zonedParts(probe, timezone);
    offsets.add(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - probe);
  }
  const exact = [...offsets].map((offset) => wall - offset).filter((candidate) => {
    const local = zonedParts(candidate, timezone);
    return local.date === normalizedDate && local.hour === targetHour && local.minute === targetMinute;
  }).sort((a, b) => a - b);
  if (exact.length) return edge === 'start' ? exact[0]! : exact.at(-1)!;
  // A daylight-saving gap has no exact instant. Compatible behavior moves the
  // start forward and the end backward so unavailable wall time adds no capacity.
  const direction = edge === 'start' ? 1 : -1;
  for (let delta = 1; delta <= 180; delta += 1) {
    const shifted = wall + direction * delta * 60_000;
    for (const offset of offsets) {
      const candidate = shifted - offset, local = zonedParts(candidate, timezone);
      const expected = new Date(shifted);
      const expectedDate = `${String(expected.getUTCFullYear()).padStart(4, '0')}-${String(expected.getUTCMonth() + 1).padStart(2, '0')}-${String(expected.getUTCDate()).padStart(2, '0')}`;
      if (local.date === expectedDate && local.hour === expected.getUTCHours() && local.minute === expected.getUTCMinutes()) return candidate;
    }
  }
  // This is reachable only for a timezone implementation failure, not a normal gap.
  throw new Error(`UNRESOLVABLE_LOCAL_TIME:${parts.year}-${parts.month}-${parts.day}`);
}

export function intervalsForDate(version: AvailabilityVersion, date: string): AvailabilityInterval[] | null {
  if (date < version.effectiveFrom || version.effectiveTo !== null && date > version.effectiveTo) return null;
  const exception = version.exceptions.find((item) => item.date === date);
  if (exception) return exception.intervals;
  return version.weekdays.find((item) => item.weekday === weekday(date))?.intervals ?? [];
}

export interface InstantWindow { start: number; end: number }

export function availabilityWindows(version: AvailabilityVersion, startMs: number, endMs: number, maxDays = 732): InstantWindow[] {
  if (endMs <= startMs) return [];
  const first = zonedParts(startMs, version.timezone).date, last = zonedParts(endMs - 1, version.timezone).date;
  const result: InstantWindow[] = [];
  for (const date of calendarDays(first, last, maxDays)) {
    const intervals = intervalsForDate(version, date);
    if (intervals === null) continue;
    for (const interval of intervals) {
      const start = Math.max(startMs, localDateMinuteToInstant(date, interval.startMinute, version.timezone, 'start'));
      const end = Math.min(endMs, localDateMinuteToInstant(date, interval.endMinute, version.timezone, 'end'));
      if (end > start) result.push({ start, end });
    }
  }
  return mergeWindows(result);
}

export function availabilityWindowsForDates(version: AvailabilityVersion, startDate: string, endDate: string, maxDays = 732): InstantWindow[] {
  const start = localDateMinuteToInstant(startDate, 0, version.timezone, 'start');
  const end = localDateMinuteToInstant(addCalendarDays(endDate, 1), 0, version.timezone, 'start');
  return availabilityWindows(version, start, end, maxDays);
}

export function mergeWindows(windows: readonly InstantWindow[]): InstantWindow[] {
  const sorted = [...windows].filter((item) => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const result: InstantWindow[] = [];
  for (const window of sorted) {
    const previous = result.at(-1);
    if (!previous || window.start > previous.end) result.push({ ...window });
    else previous.end = Math.max(previous.end, window.end);
  }
  return result;
}

export function minutesInWindows(windows: readonly InstantWindow[]) {
  return mergeWindows(windows).reduce((sum, item) => sum + (item.end - item.start) / 60_000, 0);
}

export function minutesCovered(window: InstantWindow, availability: readonly InstantWindow[]) {
  let milliseconds = 0;
  for (const available of availability) milliseconds += Math.max(0, Math.min(window.end, available.end) - Math.max(window.start, available.start));
  return milliseconds / 60_000;
}

export function isInstantWithinAvailability(instant: number, availability: readonly InstantWindow[]) {
  return availability.some((window) => instant >= window.start && instant < window.end);
}

