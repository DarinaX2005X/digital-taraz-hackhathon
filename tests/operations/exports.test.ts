import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { operationsExportAdapter } from '@/features/operations/server/exports';
import { parsePlanCalendar } from '@/features/operations/icalendar';
import { buildAiPlan } from '@/features/operations/ai-plan';
import type { OperationalPlanContent } from '@/features/operations/domain/model';

const resourceId = '00000000-0000-4000-8000-000000000201';
const availabilityId = '00000000-0000-4000-8000-000000000202';
const artifactId = '00000000-0000-4000-8000-000000000203';
const content: OperationalPlanContent = { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{
  id: 'task_a', title: 'Prepare', description: 'Public working instruction', notes: 'INTERNAL-COST-NOTE', status: 'in-progress', startDate: '2026-02-02', endDate: '2026-02-03', durationMinutes: 120,
  resourceIds: [resourceId], availabilityVersionIds: [availabilityId], assignments: [{ resourceId, resourceRevision: 2, availabilityVersionId: availabilityId, effort: { decimal: '2', unit: 'person-hours' } }], dependencies: [], checklist: [{ id: 'check_a', text: 'Confirm', done: true }], calendar: { uid: 'stable@example.test', sequence: 4 },
}] };
const base = { content, artifactId, title: 'Launch', locale: 'en' as const, options: { layout: { pageSize: 'A4' as const, orientation: 'portrait' as const, marginMm: 20, pageNumbers: true }, scale: 1, transparent: false, replaceUnsupportedFonts: false, fontAssets: {} }, privateFieldsPolicy: 'exclude-internal' as const, historicalDraft: false, revision: 7, createdAt: '2026-01-01T00:00:00.000Z', assets: { image: async () => { throw new Error('NO_IMAGE'); } }, planResources: { resources: [{ resourceId, resourceRevision: 2, displayName: 'Aruzhan', kind: 'person', timezone: 'Asia/Qyzylorda', availability: { id: availabilityId, revision: 1, timezone: 'Asia/Qyzylorda', effectiveFrom: '2026-01-01', effectiveTo: null, verifiedAt: '2026-01-01T00:00:00.000Z' } }], warnings: [] } };

describe('fixed plan export adapters', () => {
  it('exports stable UID/sequence and excludes internal notes without explicit choice', async () => {
    const first = await operationsExportAdapter.render({ ...base, format: 'ics' });
    const second = await operationsExportAdapter.render({ ...base, revision: 8, format: 'ics' });
    const one = new TextDecoder().decode(first.bytes), two = new TextDecoder().decode(second.bytes);
    expect(one).toContain('UID:stable@example.test'); expect(one).toContain('SEQUENCE:4');
    expect(two).toContain('UID:stable@example.test');
    expect(one).not.toContain('INTERNAL-COST-NOTE');
    expect(parsePlanCalendar(first.bytes, content.timezone)[0]).toMatchObject({ uid: 'stable@example.test', sequence: 4, timezone: 'Asia/Qyzylorda', startDate: '2026-02-02', endDate: '2026-02-03' });
    const privateFile = await operationsExportAdapter.render({ ...base, privateFieldsPolicy: 'include-authorized', format: 'ics' });
    expect(new TextDecoder().decode(privateFile.bytes)).toContain('INTERNAL-COST-NOTE');
  });

  it('writes a parseable workbook with the fixed resource label and metadata', async () => {
    const rendered = await operationsExportAdapter.render({ ...base, format: 'xlsx' });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(rendered.bytes) as never);
    expect(workbook.worksheets[0]?.getCell('A2').value).toBe('Prepare');
    expect(workbook.worksheets[0]?.getCell('I2').value).toBe('Aruzhan');
    expect(workbook.getWorksheet('_tirlik')?.getCell('B1').value).toBe(7);
  });

  it('keeps typed public responsibility and acceptance text in default XLSX and ICS while internal notes stay private', async () => {
    const built = buildAiPlan({ title: 'Demo launch', tasks: [{
      key: 'launch', title: 'Launch', description: 'Run the opening checklist.',
      responsibleLabel: { value: 'Demo lead', basis: { kind: 'assumption', note: 'INTERNAL-RESPONSIBILITY-CAVEAT' } },
      acceptanceCriteria: { value: 'Opening checklist signed', basis: { kind: 'assumption', note: 'INTERNAL-ACCEPTANCE-CAVEAT' } },
      notes: 'INTERNAL-TASK-NOTE',
      schedule: { kind: 'date', startDate: '2026-02-02', endDate: '2026-02-02', basis: { kind: 'assumption', note: 'INTERNAL-SCHEDULE-CAVEAT' } },
      dependencies: [], checklist: [], linkedArtifactIds: [], evidence: [],
    }] }, { goal: 'Prepare a demonstration launch plan.', defaultTimezone: 'Asia/Qyzylorda', locale: 'en', sources: [], linkedArtifactIds: [], makeId: () => 'public_task' });
    expect(built.content.entries[0]).toMatchObject({ assignments: [], resourceIds: [] });

    const renderInput = { ...base, content: built.content, planResources: { resources: [], warnings: [] } };
    const calendarFile = await operationsExportAdapter.render({ ...renderInput, format: 'ics' });
    const calendar = new TextDecoder().decode(calendarFile.bytes), calendarDescription = parsePlanCalendar(calendarFile.bytes, built.content.timezone)[0]?.description ?? '';
    expect(calendarDescription).toContain('Proposed responsible party (not an assignment): Demo lead');
    expect(calendarDescription).toContain('Proposed acceptance criterion: Opening checklist signed');
    for (const secret of ['INTERNAL-TASK-NOTE', 'INTERNAL-RESPONSIBILITY-CAVEAT', 'INTERNAL-ACCEPTANCE-CAVEAT', 'INTERNAL-SCHEDULE-CAVEAT']) expect(calendar).not.toContain(secret);

    const rendered = await operationsExportAdapter.render({ ...renderInput, format: 'xlsx' });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(rendered.bytes) as never);
    const sheet = workbook.worksheets[0]!, description = String(sheet.getCell('B2').value ?? '');
    expect(description).toContain('Proposed responsible party (not an assignment): Demo lead');
    expect(description).toContain('Proposed acceptance criterion: Opening checklist signed');
    expect(sheet.getCell('I2').value).toBe('');
    const workbookText = JSON.stringify(workbook.worksheets.map((item) => item.getSheetValues()));
    for (const secret of ['INTERNAL-TASK-NOTE', 'INTERNAL-RESPONSIBILITY-CAVEAT', 'INTERNAL-ACCEPTANCE-CAVEAT', 'INTERNAL-SCHEDULE-CAVEAT']) expect(workbookText).not.toContain(secret);
  });

  it('keeps distinct historical labels for two pinned revisions of one resource', async () => {
    const mixed: OperationalPlanContent = { ...content, entries: [
      { ...content.entries[0]!, id: 'old_task', title: 'Old assignment', assignments: [{ resourceId, resourceRevision: 1, availabilityVersionId: availabilityId, effort: { decimal: '1', unit: 'person-hours' } }] },
      { ...content.entries[0]!, id: 'new_task', title: 'New assignment', assignments: [{ resourceId, resourceRevision: 2, availabilityVersionId: availabilityId, effort: { decimal: '1', unit: 'person-hours' } }] },
    ] };
    const planResources = { resources: [
      { resourceId, resourceRevision: 1, displayName: 'Old label', kind: 'person', timezone: 'Asia/Qyzylorda' },
      { resourceId, resourceRevision: 2, displayName: 'New label', kind: 'person', timezone: 'Asia/Qyzylorda' },
    ], warnings: [] };
    const rendered = await operationsExportAdapter.render({ ...base, content: mixed, planResources, format: 'xlsx' });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(rendered.bytes) as never);
    expect(workbook.worksheets[0]?.getCell('I2').value).toBe('Old label');
    expect(workbook.worksheets[0]?.getCell('I3').value).toBe('New label');
  });

  it('writes a bounded PDF from the same revision', async () => {
    const rendered = await operationsExportAdapter.render({ ...base, format: 'pdf' });
    expect(Buffer.from(rendered.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    expect(rendered.bytes.byteLength).toBeGreaterThan(1000);
  });
});
