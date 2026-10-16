import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportMappingSchema, type ImportMapping, type MaterialField } from '../../src/contracts/materials';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { requireTable } from '../../src/features/sheets/domain/model';
import { sheetCommand } from '../../src/features/sheets/domain/commands';
import { createArtifactService } from '../../src/features/artifacts/server/service';
import { createCollectionService } from '../../src/features/materials/server/collections';
import { createCorrectionService } from '../../src/features/materials/server/corrections';
import { createDatasetService } from '../../src/features/materials/server/datasets';
import { createImportService } from '../../src/features/materials/server/imports';
import { createSourceService } from '../../src/features/sources/server/service';
import { LocalSourceStorage } from '../../src/features/sources/server/storage';
import { createFinanceWorkBuilder } from '../../src/features/finance/server/work-builder';
import { createFinanceRecalculationService } from '../../src/features/finance/server/recalculation';
import { CreateExportSchema } from '../../src/features/exports/contracts';
import { documentExportAdapter } from '../../src/features/exports/server/documents';
import { ExportRegistry } from '../../src/features/exports/server/registry';
import { createExportService } from '../../src/features/exports/server/service';
import { sheetExportAdapter } from '../../src/features/exports/server/sheets';
import { LocalExportStorage } from '../../src/features/exports/server/storage';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
const exportDirectories: string[] = [];
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => {
  await pool?.end();
  for (const directory of exportDirectories) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('tirlik-business-work-')) throw new Error('INVALID_TEST_CLEANUP_PATH');
    await rm(directory, { recursive: true, force: true });
  }
});

type Fixture = Awaited<ReturnType<typeof artifactFixture>>;
type Field = Omit<MaterialField, 'decimalSeparator' | 'groupSeparator' | 'currency' | 'unit' | 'sourceUnit' | 'dateFormat' | 'emptyValues'> & Partial<MaterialField>;

function mapping(fields: Field[], keyId: string): ImportMapping {
  const headers = fields.map((field) => field.header ?? field.id);
  return ImportMappingSchema.parse({
    fields: fields.map((field, column) => ({ ...field, column, header: headers[column] })),
    headers, headerRow: 1, importMode: 'upsert',
    recordKeySpec: { kind: 'fields', fieldIds: [keyId], trim: true, caseSensitive: true, confirmed: true },
  });
}

async function importCsv(f: Fixture, title: string, kind: 'prices' | 'history' | 'general', csv: string, importMapping: ImportMapping) {
  const storage = new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'business-work-tests', randomUUID()));
  const sources = createSourceService(pool, storage), collections = createCollectionService(pool), imports = createImportService(pool), datasets = createDatasetService(pool);
  const collection = (await collections.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, title, kind, expectedAuthzVersion: 1 })).collection;
  const bytes = new TextEncoder().encode(csv);
  const initialized = await sources.init(f.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: f.workspaceId, projectId: f.projectId, title, fileName: `${title}.csv`, format: 'csv', size: bytes.length }));
  await sources.put(f.owner, f.workspaceId, initialized.upload.id, initialized.token!, new Blob([bytes]).stream());
  const ready = await sources.finalize(f.owner, f.workspaceId, initialized.upload.id);
  let imported = (await imports.begin(f.owner, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: 1, expectedRevision: 0, collectionId: collection.id, sourceId: initialized.upload.sourceId, sourceVersionId: ready.upload.versionId!, mapping: importMapping })).import;
  while (imported.status === 'preparing') imported = (await imports.advance(f.owner, imported.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, expectedRevision: 0 })).import;
  expect(imported.status).toBe('preview');
  await imports.apply(f.owner, randomUUID(), imported.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, expectedRevision: 0, expectedReviewRevision: imported.reviewRevision, allowPartial: true });
  const page = await datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: collection.id, revision: 1, limit: 50 });
  return { collectionId: collection.id, sourceId: initialized.upload.sourceId, sourceVersionId: ready.upload.versionId!, records: page.records, datasets };
}

function allRefs(records: Awaited<ReturnType<typeof importCsv>>['records']) {
  return [...new Map(records.flatMap((record) => Object.values(record.cells)).map((cell) => {
    const ref = cell.sourceRef;
    return [`${ref.sourceId}|${ref.sourceVersionId}|${ref.revision}|${ref.collectionId}|${ref.recordId}|${ref.fieldId}|${ref.factRevision}`, ref] as const;
  })).values()];
}

function context(f: Fixture, operationId: string, sources: { sourceId: string; revision?: number }[]) {
  return {
    authority: { kind: 'user' as const, userId: f.owner.userId }, operationId,
    workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1,
    allowedInputRefs: sources.map((source) => ({ kind: 'source' as const, id: source.sourceId, revision: source.revision ?? 1 })),
    inputRevisionVector: Object.fromEntries(sources.map((source) => [source.sourceId, source.revision ?? 1])), cancelEpoch: 0, locale: 'en' as const,
  };
}

const financeMapping = mapping([
  { id: 'transaction_id', label: 'Transaction', kind: 'text', column: 0, header: 'transaction_id' },
  { id: 'kind', label: 'Kind', kind: 'text', column: 1, header: 'kind' },
  { id: 'occurred_on', label: 'Occurred', kind: 'date', column: 2, header: 'occurred_on' },
  { id: 'cash_date', label: 'Cash date', kind: 'date', column: 3, header: 'cash_date' },
  { id: 'amount', label: 'Amount', kind: 'money', currency: 'KZT', column: 4, header: 'amount' },
  { id: 'note', label: 'Note', kind: 'text', column: 5, header: 'note' },
], 'transaction_id');

const forecastMapping = mapping([
  { id: 'observation_id', label: 'Observation', kind: 'text', column: 0, header: 'observation_id' },
  { id: 'date', label: 'Date', kind: 'date', column: 1, header: 'date' },
  { id: 'value', label: 'Value', kind: 'decimal', column: 2, header: 'value' },
], 'observation_id');

const offerMapping = mapping([
  { id: 'offer_id', label: 'Offer', kind: 'text', column: 0, header: 'offer_id' },
  { id: 'supplier_id', label: 'Supplier ID', kind: 'text', column: 1, header: 'supplier_id' },
  { id: 'supplier_name', label: 'Supplier', kind: 'text', column: 2, header: 'supplier_name' },
  { id: 'item_key', label: 'Item', kind: 'text', column: 3, header: 'item_key' },
  { id: 'pack_quantity', label: 'Pack', kind: 'quantity', unit: 'pcs', column: 4, header: 'pack_quantity' },
  { id: 'pack_price', label: 'Pack price', kind: 'money', currency: 'KZT', column: 5, header: 'pack_price' },
  { id: 'minimum_packs', label: 'MOQ', kind: 'decimal', column: 6, header: 'minimum_packs' },
  { id: 'delivery', label: 'Delivery', kind: 'money', currency: 'KZT', column: 7, header: 'delivery' },
  { id: 'lead_days', label: 'Lead days', kind: 'decimal', column: 8, header: 'lead_days' },
  { id: 'payment_terms', label: 'Payment terms', kind: 'text', column: 9, header: 'payment_terms' },
  { id: 'discount_rate', label: 'Discount', kind: 'decimal', column: 10, header: 'discount_rate' },
  { id: 'tax_rate', label: 'Tax', kind: 'decimal', column: 11, header: 'tax_rate' },
  { id: 'valid_through', label: 'Valid through', kind: 'date', column: 12, header: 'valid_through' },
], 'offer_id');

const stockMapping = mapping([
  { id: 'stock_id', label: 'Stock row', kind: 'text', column: 0, header: 'stock_id' },
  { id: 'item_key', label: 'Item', kind: 'text', column: 1, header: 'item_key' },
  { id: 'stock_quantity', label: 'Stock', kind: 'quantity', unit: 'pcs', column: 2, header: 'stock_quantity' },
  { id: 'as_of', label: 'As of', kind: 'date', column: 3, header: 'as_of' },
], 'stock_id');

describe('finance, forecast and procurement durable work journeys', () => {
  it('maps finance facts, saves idempotent editable artifacts, preserves a manual edit, exports, and reopens the saved revisions', async () => {
    const f = await artifactFixture(pool);
    const material = await importCsv(f, 'Finance facts', 'history', 'transaction_id,kind,occurred_on,cash_date,amount,note\ntx-1,sale,2026-10-01,2026-10-03,1250.50,Invoice paid\ntx-2,cost,2026-10-02,2026-10-04,400.25,Materials\ntx-3,receivable,2026-10-05,,300.00,Awaiting payment\n', financeMapping);
    const refs = allRefs(material.records), builder = createFinanceWorkBuilder(pool), operationId = randomUUID();
    const input = {
      sourceRefs: refs,
      query: { workspaceId: f.workspaceId, collectionId: material.collectionId, revision: 1, fieldIds: financeMapping.fields.map((field) => field.id), filters: [], query: '', limit: 50, includeMissing: false },
      currency: 'KZT' as const, accounting: 'cash' as const, openingBalance: { currency: 'KZT' as const, minorUnits: '100000' }, period: { start: '2026-10-01', end: '2026-10-31' },
      assumptionSets: [{
        id: 'expected_inflow', title: 'Expected inflow',
        variables: [{ id: 'quantity', value: { decimal: '2', unit: 'pcs' }, confirmed: true }, { id: 'price', value: { currency: 'KZT', minorUnits: '50000' }, confirmed: true }, { id: 'settlement_date', value: '2026-10-20', confirmed: true }],
        calculation: { schemaVersion: 1 as const, currency: 'KZT' as const, scale: 2, rounding: 'half-up' as const, lines: [{ id: 'assumption_line', quantityCellId: 'quantity', priceCellId: 'price', amountCellId: 'amount', expectedFormula: '=quantity*price' }], subtotalCellId: 'subtotal', subtotalFormula: '=amount', totalCellId: 'total', totalFormula: '=subtotal' },
      }],
    };
    const execution = context(f, operationId, [material]);
    const result = await builder.buildFinanceWork(input, execution);
    expect(result.artifacts).toHaveLength(2);
    expect(result.unresolved.map((issue) => issue.code)).toContain('finance.cash_date_unknown');
    expect((await builder.buildFinanceWork(input, execution)).artifacts.map((item) => item.artifact.id)).toEqual(result.artifacts.map((item) => item.artifact.id));
    await expect(builder.buildFinanceWork({ ...input, sourceRefs: [...refs, { ...refs[0]!, sourceId: randomUUID() }] }, execution)).rejects.toThrow('BUSINESS_WORK_INPUT_NOT_ALLOWED');

    const tableId = result.artifacts.find((item) => item.artifact.kind === 'table')!.artifact.id;
    const documentId = result.artifacts.find((item) => item.artifact.kind === 'document')!.artifact.id;
    const initial = await f.service.read(f.owner, { workspaceId: f.workspaceId, artifactId: tableId });
    const desired = structuredClone(requireTable(initial.content)), sheet = desired.workbook.sheets.assumptions!;
    sheet.cellData[1]![2] = { v: 'Reviewed expected inflow', t: 1 };
    const draft = (await sheetCommand(initial, desired, 'Clarify the scenario wording'))!, commandGroupId = randomUUID();
    await f.service.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, group: { ...draft, commandGroupId, commands: draft.commands.map((command) => ({ ...command, commandId: randomUUID() })) } });
    const reopenedService = createArtifactService(pool), reopened = await reopenedService.read(f.owner, { workspaceId: f.workspaceId, artifactId: tableId });
    expect(requireTable(reopened.content).workbook.sheets.assumptions!.cellData[1]![2]).toMatchObject({ v: 'Reviewed expected inflow' });
    expect(reopened.artifact.currentRevision).toBe(1);
    expect(reopened.sourceFreshness.every((source) => source.status === 'current' && source.sourceStatus === 'current' && source.factStatus === 'current')).toBe(true);
    expect(reopened.missingTargets).toEqual([]);
    const reopenedDocument = await reopenedService.read(f.owner, { workspaceId: f.workspaceId, artifactId: documentId });
    expect(reopenedDocument.sourceFreshness.every((source) => source.status === 'current' && source.sourceStatus === 'current' && source.factStatus === 'current')).toBe(true);
    expect(reopenedDocument.missingTargets).toEqual([]);

    const recalculation = createFinanceRecalculationService(pool), recalculateId = randomUUID();
    const revised = await recalculation.recalculate(f.owner, recalculateId, {
      workspaceId: f.workspaceId, projectId: f.projectId, base: { artifactId: tableId, revision: 1 }, branchTitle: 'Revised cash plan',
      scenarios: [{ scenarioId: 'expected_inflow', title: 'Upside plan', assumptions: [{ assumptionId: 'expected_inflow_total', amount: { currency: 'KZT', minorUnits: '200000' }, confirmed: true }] }],
    });
    expect(revised.comparison).toEqual({ base: { artifactId: tableId, revision: 1 }, branch: { artifactId: expect.any(String), revision: 0 } });
    expect(revised.work.workPreview).toMatchObject({ kind: 'finance', editable: revised.comparison.branch, scenarios: [{ id: 'expected_inflow', title: 'Upside plan' }] });
    const branch = await reopenedService.read(f.owner, { workspaceId: f.workspaceId, artifactId: revised.comparison.branch.artifactId });
    expect(branch.version.branchParent).toEqual(expect.objectContaining({ artifactId: tableId, revision: 1 }));
    expect(requireTable(branch.content).workbook.sheets.assumptions!.cellData[1]![2]).toMatchObject({ v: 'Reviewed expected inflow' });
    expect(requireTable(branch.content).workbook.sheets.finance_overview!.cellData[1]![0]).toMatchObject({ v: 'Upside plan' });
    expect((await recalculation.recalculate(f.owner, recalculateId, {
      workspaceId: f.workspaceId, projectId: f.projectId, base: { artifactId: tableId, revision: 1 }, branchTitle: 'Revised cash plan',
      scenarios: [{ scenarioId: 'expected_inflow', title: 'Upside plan', assumptions: [{ assumptionId: 'expected_inflow_total', amount: { currency: 'KZT', minorUnits: '200000' }, confirmed: true }] }],
    })).comparison.branch).toEqual(revised.comparison.branch);
    const retained = await reopenedService.read(f.owner, { workspaceId: f.workspaceId, artifactId: tableId });
    expect(retained.artifact.currentRevision).toBe(1);
    expect(requireTable(retained.content).workbook.sheets.assumptions!.cellData[1]![2]).toMatchObject({ v: 'Reviewed expected inflow' });

    const directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-business-work-')); exportDirectories.push(directory);
    const exports = createExportService({ pool, storage: new LocalExportStorage(directory), registry: new ExportRegistry([documentExportAdapter, sheetExportAdapter]), assets: () => ({ async image() { throw new Error('UNEXPECTED_IMAGE'); } }) });
    const exportItems = [{ artifactId: tableId, revision: 1, formats: ['xlsx'] as const }, { artifactId: documentId, revision: 0, formats: ['docx'] as const }];
    const job = await exports.create(f.owner, randomUUID(), CreateExportSchema.parse({ workspaceId: f.workspaceId, expectedAuthzVersion: 1, locale: 'en', items: exportItems }));
    const ready = await exports.render(f.owner, f.workspaceId, job.id, 1);
    expect(ready.status).toBe('ready');
    expect(ready.historicalDraft).toBe(false);
    expect(ready.files.every((file) => !file.fileName.includes('-draft'))).toBe(true);
    const xlsxFile = ready.files.find((file) => file.format === 'xlsx')!, docxFile = ready.files.find((file) => file.format === 'docx')!;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from((await exports.download(f.owner, f.workspaceId, job.id, xlsxFile.id)).bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet('Assumptions')!.getCell('C2').value).toBe('Reviewed expected inflow');
    const docx = await JSZip.loadAsync((await exports.download(f.owner, f.workspaceId, job.id, docxFile.id)).bytes);
    expect(await docx.file('word/document.xml')!.async('string')).toContain('Financial model report');
  }, 180_000);

  it('queries a reviewed daily series, proves forecast eligibility and reopens its persisted table and report', async () => {
    const f = await artifactFixture(pool), start = new Date('2026-07-01T00:00:00.000Z');
    const rows = Array.from({ length: 70 }, (_, index) => {
      const date = new Date(start); date.setUTCDate(date.getUTCDate() + index);
      return `obs-${index + 1},${date.toISOString().slice(0, 10)},${100 + index * 2 + index % 7}`;
    });
    const material = await importCsv(f, 'Daily demand', 'history', `observation_id,date,value\n${rows.join('\n')}\n`, forecastMapping);
    const seriesRef = material.records[0]!.cells.value!.sourceRef;
    const builder = createFinanceWorkBuilder(pool), result = await builder.buildForecastWork({
      seriesRef, target: 'daily_demand', dateColumn: 'date', valueColumn: 'value', aggregation: 'daily', horizon: 7,
      calendar: { timezone: 'Asia/Qyzylorda', frequency: 'daily' }, exclusions: [],
      coverage: { start: '2026-07-01', end: '2026-09-08', observations: 70, regular: true },
    }, context(f, randomUUID(), [material]));
    expect(result.forecast.eligibility.state).toBe('eligible');
    expect(result.forecast.backtest.folds.length).toBeGreaterThanOrEqual(2);
    expect(result.forecast.points).toHaveLength(7);
    expect(result.artifacts).toHaveLength(2);
    const service = createArtifactService(pool);
    for (const saved of result.artifacts) {
      const snapshot = await service.read(f.owner, { workspaceId: f.workspaceId, artifactId: saved.artifact.id });
      expect(snapshot.artifact.currentRevision).toBe(0);
      expect(snapshot.artifact.sourceRefs).toContainEqual(seriesRef);
    }
    const table = await service.read(f.owner, { workspaceId: f.workspaceId, artifactId: result.artifacts.find((item) => item.artifact.kind === 'table')!.artifact.id });
    expect(requireTable(table.content).workbook.sheets.forecast_points!.cellData[1]![1]!.v).toBeDefined();
  }, 180_000);

  it('binds exact offer and stock facts, keeps incomplete offers visible, and invalidates a corrected old price fact', async () => {
    const f = await artifactFixture(pool);
    const offers = await importCsv(f, 'Supplier offers', 'prices', 'offer_id,supplier_id,supplier_name,item_key,pack_quantity,pack_price,minimum_packs,delivery,lead_days,payment_terms,discount_rate,tax_rate,valid_through\noffer-a,supplier-a,Alpha Supply,widget,10,1200,1,500,3,50 percent advance,5,12,2026-12-31\noffer-b,supplier-b,Beta Supply,widget,8,900,1,300,5,,0,12,2026-12-31\n', offerMapping);
    const stock = await importCsv(f, 'Current stock', 'general', 'stock_id,item_key,stock_quantity,as_of\nstock-1,widget,4,2026-10-15\n', stockMapping);
    const offerRefs = allRefs(offers.records), stockRefs = allRefs(stock.records), builder = createFinanceWorkBuilder(pool, { now: () => new Date('2026-10-16T08:00:00.000Z') });
    const input = { needLines: [{ id: 'need_widget', itemKey: 'widget', quantity: { decimal: '24', unit: 'pcs' }, requiredBy: '2026-10-31', sourceRefs: [] }], offerSourceRefs: offerRefs, stockSourceRefs: stockRefs, currency: 'KZT' as const, deliveryDestination: 'Kyzylorda workshop' };
    const executionSources = [offers, stock];
    const result = await builder.buildProcurementWork(input, context(f, randomUUID(), executionSources));
    expect(result.artifacts).toHaveLength(2);
    expect(result.decision).toMatchObject({ requiresConsent: true, options: [{ id: 'offer_1' }] });
    expect(result.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'procurement.offer.incomplete' })]));
    const order = await createArtifactService(pool).read(f.owner, { workspaceId: f.workspaceId, artifactId: result.artifacts.find((item) => item.artifact.kind === 'document')!.artifact.id });
    expect(JSON.stringify(order.content)).toContain('Alpha Supply');
    expect(JSON.stringify(order.content)).toContain('does not send anything');

    const alpha = offers.records.find((record) => record.cells.offer_id?.rawValue === 'offer-a')!;
    const corrections = createCorrectionService(pool);
    const correction = { workspaceId: f.workspaceId, expectedAuthzVersion: 1, expectedRevision: 1, changes: [{ recordId: alpha.recordId, fieldId: 'pack_price', rawValue: '1400', reason: 'Supplier correction' }] };
    const preview = await corrections.preview(f.owner, offers.collectionId, correction);
    await corrections.apply(f.owner, randomUUID(), offers.collectionId, { ...correction, previewHash: preview.previewHash });
    const staleTableId = result.artifacts.find((item) => item.artifact.kind === 'table')!.artifact.id;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-business-work-')); exportDirectories.push(directory);
    const exports = createExportService({ pool, storage: new LocalExportStorage(directory), registry: new ExportRegistry([sheetExportAdapter]), assets: () => ({ async image() { throw new Error('UNEXPECTED_IMAGE'); } }) });
    await expect(exports.create(f.owner, randomUUID(), CreateExportSchema.parse({ workspaceId: f.workspaceId, expectedAuthzVersion: 1, locale: 'en', items: [{ artifactId: staleTableId, revision: 0, formats: ['xlsx'] }] }))).rejects.toMatchObject({ messageKey: 'exports.errors.historicalConsent' });
    const rebuilt = await builder.buildProcurementWork(input, context(f, randomUUID(), executionSources));
    expect(rebuilt.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'procurement.fact.stale' })]));
    expect(rebuilt.decision).toBeUndefined();
    expect(rebuilt.checks.find((check) => check.code === 'procurement.complete_cost.checked')?.status).toBe('unknown');
  }, 180_000);
});
