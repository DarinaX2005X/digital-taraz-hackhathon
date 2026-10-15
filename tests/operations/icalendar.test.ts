import { describe, expect, it } from 'vitest';

import { exportPlanCalendar, importPlanCalendar } from '@/features/operations/icalendar';
import { updateEntry, type OperationalPlanContent } from '@/features/operations/domain/model';

const empty = (): OperationalPlanContent => ({ kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [] });

describe('iCalendar plan interchange', () => {
  it('exports inclusive local dates with an exclusive DTEND and stable dependency UIDs', () => {
    const bytes = exportPlanCalendar({ ...empty(), entries: [
      { id: 'task_a', title: 'Prepare', status: 'todo', startDate: '2026-02-02', endDate: '2026-02-03', resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: [], checklist: [] },
      { id: 'task_b', title: 'Review', status: 'todo', startDate: '2026-02-04', endDate: '2026-02-04', resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: ['task_a'], checklist: [] },
    ] }, { artifactId: 'artifact-1', title: 'Launch', revision: 3, createdAt: '2026-01-01T00:00:00.000Z', locale: 'en' });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('DTEND;VALUE=DATE:20260204');
    expect(text).toContain('RELATED-TO;RELTYPE=DEPENDS-ON:artifact-1.task_a@calendar.tirlik.local');
  });

  it('resolves forward RELATED-TO references and treats exact reimport as unchanged', () => {
    const raw = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:a@example', 'SEQUENCE:1', 'SUMMARY:Prepare', 'DTSTART;VALUE=DATE:20260202', 'DTEND;VALUE=DATE:20260203', 'RELATED-TO;RELTYPE=DEPENDS-ON:b@example', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b@example', 'SEQUENCE:1', 'SUMMARY:Approve', 'DTSTART:20260202T040000Z', 'DTEND:20260202T050000Z', 'END:VEVENT',
      'END:VCALENDAR', '',
    ].join('\r\n');
    const first = importPlanCalendar(raw, empty(), (uid) => uid.startsWith('a') ? 'task_a' : 'task_b');
    expect(first.inserted).toEqual(['task_a', 'task_b']);
    expect(first.content.entries.find((entry) => entry.id === 'task_a')?.dependencies).toEqual(['task_b']);
    const second = importPlanCalendar(raw, first.content, (uid) => uid.startsWith('a') ? 'task_a' : 'task_b');
    expect(second.unchanged).toEqual(['task_a', 'task_b']);
    expect(second.conflicts).toEqual([]);
  });

  it('reports same-sequence drift instead of silently overwriting', () => {
    const base = importPlanCalendar('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a@example\r\nSEQUENCE:2\r\nSUMMARY:Original\r\nDTSTART;VALUE=DATE:20260202\r\nDTEND;VALUE=DATE:20260203\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', empty(), () => 'task_a').content;
    const changed = importPlanCalendar('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a@example\r\nSEQUENCE:2\r\nSUMMARY:Changed\r\nDTSTART;VALUE=DATE:20260202\r\nDTEND;VALUE=DATE:20260203\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', base, () => 'task_a');
    expect(changed.conflicts).toEqual([{ uid: 'a@example', reason: 'same-sequence-different-content' }]);
    expect(changed.content.entries[0]?.title).toBe('Original');
  });

  it('parses TZID instants and increments sequence after a direct edit', () => {
    const raw = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:time@example\r\nSEQUENCE:6\r\nSUMMARY:Timed\r\nDTSTART;TZID=America/New_York:20260308T013000\r\nDTEND;TZID=America/New_York:20260308T033000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const imported = importPlanCalendar(raw, empty(), () => 'task_time').content;
    expect(imported.entries[0]).toMatchObject({ startAt: '2026-03-08T06:30:00.000Z', endAt: '2026-03-08T07:30:00.000Z', calendar: { uid: 'time@example', sequence: 6 } });
    const edited = updateEntry(imported, 'task_time', { title: 'Timed delivery' });
    expect(edited.entries[0]?.calendar?.sequence).toBe(7);
  });

  it('derives an increasing export sequence for ordinary entries without imported calendar metadata', () => {
    const content = { ...empty(), entries: [{ id: 'manual', title: 'Manual task', status: 'todo' as const, startDate: '2026-02-02', endDate: '2026-02-02', resourceIds: [], dependencies: [], checklist: [], availabilityVersionIds: [] }] };
    const first = new TextDecoder().decode(exportPlanCalendar(content, { artifactId: 'artifact-stable', title: 'Plan', revision: 1, createdAt: '2026-01-01T00:00:00.000Z', locale: 'en' }));
    const second = new TextDecoder().decode(exportPlanCalendar({ ...content, entries: [{ ...content.entries[0]!, title: 'Updated manual task' }] }, { artifactId: 'artifact-stable', title: 'Plan', revision: 2, createdAt: '2026-01-02T00:00:00.000Z', locale: 'en' }));
    expect(first).toContain('UID:artifact-stable.manual@calendar.tirlik.local'); expect(first).toContain('SEQUENCE:1');
    expect(second).toContain('UID:artifact-stable.manual@calendar.tirlik.local'); expect(second).toContain('SEQUENCE:2');
    const imported = importPlanCalendar(first, empty()), updated = importPlanCalendar(second, imported.content);
    expect(updated.updated).toHaveLength(1);
    expect(updated.conflicts).toEqual([]);
    expect(updated.content.entries[0]?.title).toBe('Updated manual task');
  });
});
