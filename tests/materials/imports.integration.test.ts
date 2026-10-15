import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportMappingSchema } from '../../src/contracts/materials';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { createCollectionService } from '../../src/features/materials/server/collections';
import { createDatasetService } from '../../src/features/materials/server/datasets';
import { createImportService } from '../../src/features/materials/server/imports';
import { createCorrectionService } from '../../src/features/materials/server/corrections';
import { createMaterialFactReader } from '../../src/features/materials/server/facts';
import { createSourceService } from '../../src/features/sources/server/service';
import { LocalSourceStorage } from '../../src/features/sources/server/storage';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

const mapping = ImportMappingSchema.parse({
  fields: [
    { id: 'sku', label: 'Артикул', column: 0, header: 'SKU', kind: 'text' },
    { id: 'price', label: 'Цена', column: 1, header: 'price', kind: 'money', currency: 'KZT' },
  ],
  headerRow: 1, headers: ['SKU', 'price'], importMode: 'upsert',
  recordKeySpec: { kind: 'fields', fieldIds: ['sku'], trim: true, caseSensitive: true, confirmed: true },
});

async function fixture() {
  const f = await artifactFixture(pool);
  const sources = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'materials-tests', randomUUID())));
  const collections = createCollectionService(pool), imports = createImportService(pool), datasets = createDatasetService(pool);
  const created = await collections.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, title: 'Прайс мастерской', kind: 'prices', expectedAuthzVersion: 1 });
  const base = (revision: number) => ({ workspaceId: f.workspaceId, expectedAuthzVersion: 1, expectedRevision: revision });
  async function start(text: string, revision: number, importMapping = mapping) {
    const bytes = new TextEncoder().encode(text);
    const initialized = await sources.init(f.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: f.workspaceId, projectId: f.projectId, title: 'Свой прайс', fileName: 'prices.csv', format: 'csv', size: bytes.length }));
    await sources.put(f.owner, f.workspaceId, initialized.upload.id, initialized.token!, new Blob([bytes]).stream());
    const ready = await sources.finalize(f.owner, f.workspaceId, initialized.upload.id);
    return (await imports.begin(f.owner, randomUUID(), { ...base(revision), collectionId: created.collection.id, sourceId: initialized.upload.sourceId, sourceVersionId: ready.upload.versionId, mapping: importMapping })).import;
  }
  async function prepare(text: string, revision: number, importMapping = mapping) {
    let item = await start(text, revision, importMapping);
    while (item.status === 'preparing') item = (await imports.advance(f.owner, item.id, base(revision))).import;
    expect(item.status).toBe('preview');
    return item;
  }
  return { ...f, collections, imports, datasets, collectionId: created.collection.id, base, start, prepare };
}

describe('material import identity and review persistence', () => {
  it('keeps an immutable pinned fact, previews a correction, rejects a changed preview and undoes the accepted decision', async () => {
    const f = await fixture(), corrections = createCorrectionService(pool), facts = createMaterialFactReader(pool);
    const imported = await f.prepare('SKU,price\n001,100\n', 0);
    await f.imports.apply(f.owner, randomUUID(), imported.id, { ...f.base(0), expectedReviewRevision: 0 });
    const before = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    const record = before.records[0]!, ref = record.cells.price!.sourceRef;
    expect((await facts.read(f.owner, { workspaceId: f.workspaceId, refs: [ref] })).facts[0]).toMatchObject({ state: 'current', canBind: true });
    const change = { ...f.base(1), changes: [{ recordId: record.recordId, fieldId: 'price', rawValue: '125.25', reason: 'Уточнение поставщика' }] };
    const preview = await corrections.preview(f.owner, f.collectionId, change);
    expect(preview.changes[0]!.after.value).toEqual({ kind: 'money', minorUnits: '12525', currency: 'KZT' });
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId })).records).toEqual(before.records);
    await expect(corrections.apply(f.owner, randomUUID(), f.collectionId, { ...change, previewHash: '0'.repeat(64) })).rejects.toMatchObject({ messageKey: 'materials.errors.revision' });
    const operationId = randomUUID(), apply = { ...change, previewHash: preview.previewHash };
    const saved = await corrections.apply(f.owner, operationId, f.collectionId, apply);
    expect(await corrections.apply(f.owner, operationId, f.collectionId, apply)).toEqual(saved);
    const stale = (await facts.read(f.owner, { workspaceId: f.workspaceId, refs: [ref] })).facts[0]!;
    expect(stale).toMatchObject({ state: 'stale', canBind: false, pinned: { value: { kind: 'money', minorUnits: '10000' } }, currentSourceRef: { recordId: record.recordId, factRevision: 2 } });
    expect((await facts.read(f.owner, { workspaceId: f.workspaceId, refs: [stale.currentSourceRef!] })).facts[0]).toMatchObject({ state: 'current', canBind: true, pinned: { value: { minorUnits: '12525' } } });
    expect((await facts.read(f.owner, { workspaceId: f.workspaceId, refs: [{ ...ref, sourceVersionId: randomUUID() }] })).facts[0]).toEqual({ requestedRef: { ...ref, sourceVersionId: expect.any(String) }, state: 'unknown', canBind: false, canCorrect: false });
    const undone = await corrections.undo(f.owner, randomUUID(), f.collectionId, { ...f.base(2), resolutionId: saved.resolutionId, reason: 'Отмена исправления' });
    const restored = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    expect(restored.records[0]).toMatchObject({ recordId: record.recordId, cells: { price: { value: { minorUnits: '10000' }, factRevision: 3 } } });
    expect(undone.collection.revision).toBe(3);
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, revision: 2 })).records[0]!.cells.price!.value).toMatchObject({ minorUnits: '12525' });
    await expect(corrections.undo(f.owner, randomUUID(), f.collectionId, { ...f.base(3), resolutionId: saved.resolutionId, reason: 'Повторная отмена' })).rejects.toMatchObject({ messageKey: 'materials.errors.revision' });
  });

  it('undoes an initial import by marking its records missing while retaining exact historical data', async () => {
    const f = await fixture(), corrections = createCorrectionService(pool), facts = createMaterialFactReader(pool);
    const imported = await f.prepare('SKU,price\nA,0\nB,15\n', 0);
    await f.imports.apply(f.owner, randomUUID(), imported.id, { ...f.base(0), expectedReviewRevision: 0 });
    const before = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    const history = await f.collections.history(f.owner, f.workspaceId, f.collectionId);
    await corrections.undo(f.owner, randomUUID(), f.collectionId, { ...f.base(1), resolutionId: history.resolutions[0]!.id, reason: 'Выбран не тот файл' });
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId })).records).toEqual([]);
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, revision: 1 })).records).toEqual(before.records);
    expect((await facts.read(f.owner, { workspaceId: f.workspaceId, refs: [before.records[0]!.cells.price!.sourceRef] })).facts[0]).toMatchObject({ state: 'missing', canBind: false });
  });
  it('allocates a new record after a matched key is corrected and preserves the old record and pinned history', async () => {
    const f = await fixture();
    const first = await f.prepare('SKU,price\nA,100\n', 0);
    await f.imports.apply(f.owner, randomUUID(), first.id, { ...f.base(0), expectedReviewRevision: 0 });
    const original = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, revision: 1 });
    const oldId = original.records[0]!.recordId;
    const next = await f.prepare('SKU,price\nA,200\n', 1);
    const matched = await f.imports.preview(f.owner, f.workspaceId, next.id);
    expect(matched.rows[0]).toMatchObject({ recordId: oldId, change: 'changed' });
    const resolved = await f.imports.resolve(f.owner, randomUUID(), next.id, { ...f.base(1), expectedReviewRevision: 0, changes: [{ ordinal: matched.rows[0]!.ordinal, values: { sku: 'B' } }] });
    const corrected = await f.imports.preview(f.owner, f.workspaceId, next.id);
    expect(corrected.rows[0]).toMatchObject({ change: 'added', before: null });
    expect(corrected.rows[0]!.recordId).not.toBe(oldId);
    const operationId = randomUUID(), input = { ...f.base(1), expectedReviewRevision: resolved.import.reviewRevision };
    const applied = await f.imports.apply(f.owner, operationId, next.id, input);
    expect(await f.imports.apply(f.owner, operationId, next.id, input)).toEqual(applied);
    const current = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    expect(current.records).toHaveLength(2);
    expect(current.records.find((row) => row.recordId === oldId)!.cells.price!.value).toEqual({ kind: 'money', minorUnits: '10000', currency: 'KZT' });
    expect(current.records.find((row) => row.recordId !== oldId)!.cells.sku!.value).toEqual({ kind: 'text', text: 'B' });
    const pinned = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, revision: 1 });
    expect(pinned.records).toEqual(original.records);
  });

  it('keeps an explicit duplicate-key decision through an unrelated edit and commits both distinct rows once', async () => {
    const f = await fixture();
    const item = await f.prepare('SKU,price\n001,100\n001,200\n', 0);
    const preview = await f.imports.preview(f.owner, f.workspaceId, item.id);
    expect(preview.import.counts.ambiguous).toBe(2);
    const ordinal = preview.rows[1]!.ordinal;
    const resolved = await f.imports.resolve(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 0, changes: [{ ordinal, keyOverride: '002' }] });
    expect(resolved.import.counts.ambiguous).toBe(0);
    const edited = await f.imports.resolve(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 1, changes: [{ ordinal, values: { price: '300' } }] });
    expect(edited.import.counts.ambiguous).toBe(0);
    const reviewed = await f.imports.preview(f.owner, f.workspaceId, item.id);
    expect(reviewed.rows[1]!.key).toBe('["002"]');
    await f.imports.apply(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 2 });
    const current = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    expect(new Set(current.records.map((record) => record.recordId)).size).toBe(2);
    expect((await f.datasets.aggregate(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, fieldId: 'price', operation: 'sum' })).value).toBe('40000');
  });

  it('only removes a saved key override when explicitly cleared', async () => {
    const f = await fixture();
    const item = await f.prepare('SKU,price\n001,100\n001,200\n', 0);
    const preview = await f.imports.preview(f.owner, f.workspaceId, item.id), ordinal = preview.rows[1]!.ordinal;
    await f.imports.resolve(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 0, changes: [{ ordinal, keyOverride: '002' }] });
    const cleared = await f.imports.resolve(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 1, changes: [{ ordinal, keyOverride: null }] });
    expect(cleared.import.counts.ambiguous).toBe(2);
    await expect(f.imports.apply(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 2 })).rejects.toMatchObject({ messageKey: 'materials.errors.partial' });
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId })).records).toEqual([]);
  });
  it('previews a batch decision, restores it with a replay-safe undo and never changes the original input', async () => {
    const f = await fixture(), item = await f.prepare('SKU,price\nA,10\nB,20\n', 0);
    const original = await f.imports.preview(f.owner, f.workspaceId, item.id);
    await f.imports.resolve(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 0, changes: original.rows.map((row) => ({ ordinal: row.ordinal, values: { price: '30' }, exclude: true })) });
    const changed = await f.imports.preview(f.owner, f.workspaceId, item.id);
    expect(changed.import.counts.excluded).toBe(2);
    expect(changed.rows[0]!.cells.price!.sourceRawValue).toBe('10');
    const operationId = randomUUID(), body = { ...f.base(0), expectedReviewRevision: 1 };
    const restored = await f.imports.undoResolve(f.owner, operationId, item.id, body);
    expect(await f.imports.undoResolve(f.owner, operationId, item.id, body)).toEqual(restored);
    const preview = await f.imports.preview(f.owner, f.workspaceId, item.id);
    expect(preview.rows).toEqual(original.rows);
    expect(preview.import.reviewRevision).toBe(2);
  });

  it('queries nested filters, exact coverage, facets, grouped results and bounded AI decision context', async () => {
    const f = await fixture(), item = await f.prepare('SKU,price\nA,100\nB,200\nC,\n', 0);
    await f.imports.apply(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 0, allowPartial: true });
    const where = { type: 'group' as const, operator: 'or' as const, children: [
      { type: 'predicate' as const, predicate: { fieldId: 'sku', op: 'eq' as const, value: 'A' } },
      { type: 'predicate' as const, predicate: { fieldId: 'price', op: 'unknown' as const } },
    ] };
    const filtered = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, where });
    expect(filtered.total).toBe(2);
    expect(new Set(filtered.records.map((record) => record.cells.sku!.rawValue))).toEqual(new Set(['A', 'C']));
    const aggregate = await f.datasets.aggregate(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, fieldId: 'price', operation: 'sum' });
    expect(aggregate).toMatchObject({ value: '30000', coverage: { total: 3, included: 2, excluded: 1, missing: 0, unknown: 1, needsReview: 0 } });
    const firstFacet = await f.datasets.facet(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, fieldId: 'sku', limit: 2 });
    expect(firstFacet.values).toHaveLength(2); expect(firstFacet.nextCursor).not.toBeNull();
    const secondFacet = await f.datasets.facet(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, fieldId: 'sku', limit: 2, after: firstFacet.nextCursor });
    expect(secondFacet.values).toHaveLength(1);
    const measures = [{ id: 'price_total', fieldId: 'price', operation: 'sum' as const }];
    const firstGroups = await f.datasets.group(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, dimensions: ['sku'], measures, limit: 2 });
    expect(firstGroups.totalGroups).toBe(3); expect(firstGroups.rows).toHaveLength(2); expect(firstGroups.nextCursor).not.toBeNull();
    const secondGroups = await f.datasets.group(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, dimensions: ['sku'], measures, limit: 2, after: firstGroups.nextCursor });
    expect(secondGroups.totalGroups).toBe(3); expect(secondGroups.rows).toHaveLength(1);
    const context = await f.datasets.context(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, sampleLimit: 1, measures, grouping: { dimensions: [], limit: 1 } });
    expect(context).toMatchObject({ revision: 1, matchedRecords: 3, truncated: true, aggregates: [{ measureId: 'price_total', value: '30000' }] });
    expect(context.sample).toHaveLength(1); expect(context.grouped?.rows).toHaveLength(1); expect(context.evidenceRefs.length).toBeGreaterThan(0);
  });

  it('keeps identities through reorder and price changes and applies append, upsert and complete replace semantics', async () => {
    const f = await fixture();
    const first = await f.prepare('SKU,price\nA,100\nB,200\n', 0);
    await f.imports.apply(f.owner, randomUUID(), first.id, { ...f.base(0), expectedReviewRevision: 0 });
    const repeated = await f.start('SKU,price\nA,100\nB,200\n', 1);
    expect(repeated).toMatchObject({ id: first.id, status: 'applied', appliedRevision: 1 });
    const original = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    const identities = new Map(original.records.map((record) => [record.cells.sku!.rawValue, record.recordId]));
    const reordered = ImportMappingSchema.parse({ ...mapping, fields: mapping.fields.map((field) => ({ ...field, column: field.id === 'sku' ? 1 : 0 })), headers: ['price', 'SKU'] });
    const second = await f.prepare('price,SKU\n200,B\n150,A\n', 1, reordered);
    const preview = await f.imports.preview(f.owner, f.workspaceId, second.id);
    expect(preview.import.counts).toMatchObject({ changed: 1, unchanged: 1, ambiguous: 0 });
    await f.imports.apply(f.owner, randomUUID(), second.id, { ...f.base(1), expectedReviewRevision: 0 });
    const afterReorder = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    expect(afterReorder.records.find((record) => record.cells.sku!.rawValue === 'A')).toMatchObject({ recordId: identities.get('A'), cells: { price: { value: { minorUnits: '15000' } } } });
    expect(afterReorder.records.find((record) => record.cells.sku!.rawValue === 'B')?.recordId).toBe(identities.get('B'));

    const upsertOnlyA = await f.prepare('SKU,price\nA,150\n', 2);
    await f.imports.apply(f.owner, randomUUID(), upsertOnlyA.id, { ...f.base(2), expectedReviewRevision: 0 });
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId })).records).toHaveLength(2);

    const append = ImportMappingSchema.parse({ ...mapping, importMode: 'append' });
    const appended = await f.prepare('SKU,price\nA,151\nC,300\n', 3, append);
    const appendPreview = await f.imports.preview(f.owner, f.workspaceId, appended.id);
    expect(appendPreview.import.counts).toMatchObject({ added: 1, ambiguous: 1 });
    await expect(f.imports.apply(f.owner, randomUUID(), appended.id, { ...f.base(3), expectedReviewRevision: 0 })).rejects.toMatchObject({ messageKey: 'materials.errors.partial' });
    const overlap = appendPreview.rows.find((row) => row.change === 'ambiguous')!;
    const resolved = await f.imports.resolve(f.owner, randomUUID(), appended.id, { ...f.base(3), expectedReviewRevision: 0, changes: [{ ordinal: overlap.ordinal, exclude: true }] });
    await f.imports.apply(f.owner, randomUUID(), appended.id, { ...f.base(3), expectedReviewRevision: resolved.import.reviewRevision, allowPartial: true });
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId })).records).toHaveLength(3);

    const replace = ImportMappingSchema.parse({ ...mapping, importMode: 'replace-snapshot' });
    const replacement = await f.prepare('SKU,price\nA,150\n', 4, replace);
    expect((await f.imports.preview(f.owner, f.workspaceId, replacement.id)).import.counts.missing).toBe(2);
    await f.imports.apply(f.owner, randomUUID(), replacement.id, { ...f.base(4), expectedReviewRevision: 0, confirmCompleteSnapshot: true });
    const current = await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId });
    expect(current.records).toHaveLength(1); expect(current.records[0]!.recordId).toBe(identities.get('A'));
    expect((await f.datasets.query(f.owner, { workspaceId: f.workspaceId, collectionId: f.collectionId, revision: 4 })).records).toHaveLength(3);
  });

  it('advances a large source in bounded durable batches instead of loading the collection at once', async () => {
    const f = await fixture();
    const rows = Array.from({ length: 2501 }, (_, index) => `${String(index).padStart(6, '0')},${index + 1}`);
    const started = await f.start(`SKU,price\n${rows.join('\n')}\n`, 0);
    expect(started.chunkCount).toBeGreaterThan(4);
    const first = (await f.imports.advance(f.owner, started.id, f.base(0))).import;
    expect(first).toMatchObject({ status: 'preparing', nextChunk: 4 });
    expect(first.counts.total).toBeLessThanOrEqual(2000);
    let item = first;
    while (item.status === 'preparing') item = (await f.imports.advance(f.owner, item.id, f.base(0))).import;
    expect(item).toMatchObject({ status: 'preview', counts: { total: 2501, added: 2501 } });
  });

  it('pages 100000 records without a latest-100 fallback or full response materialization', async () => {
    const f = await fixture(), item = await f.prepare('SKU,price\nseed,100\n', 0);
    await f.imports.apply(f.owner, randomUUID(), item.id, { ...f.base(0), expectedReviewRevision: 0 });
    await pool.query(`WITH template AS (SELECT cells FROM material_records WHERE collection_id=$1 LIMIT 1), generated AS (
      SELECT gen_random_uuid() AS id,('scale-'||n)::text AS label,md5(('scale-'||n)::text) AS identity_hash FROM generate_series(1,99999) n
    ) INSERT INTO material_records(id,collection_id,identity_hash,identity_key,current_revision,missing,label,cells,row_hash)
      SELECT g.id,$1,g.identity_hash,g.label,1,false,g.label,jsonb_set(jsonb_set(template.cells,'{sku,sourceRef,recordId}',to_jsonb(g.id::text)),'{price,sourceRef,recordId}',to_jsonb(g.id::text)),md5(g.label)
      FROM generated g CROSS JOIN template`,[f.collectionId]);
    await pool.query('UPDATE material_collections SET record_count=100000 WHERE id=$1',[f.collectionId]);
    const page = await f.datasets.query(f.owner,{workspaceId:f.workspaceId,collectionId:f.collectionId,limit:50});
    expect(page).toMatchObject({total:100000,records:expect.any(Array)}); expect(page.records).toHaveLength(50); expect(page.nextCursor).not.toBeNull();
    const next = await f.datasets.query(f.owner,{workspaceId:f.workspaceId,collectionId:f.collectionId,limit:50,after:page.nextCursor});
    expect(next.records).toHaveLength(50); expect(new Set([...page.records,...next.records].map((record)=>record.recordId)).size).toBe(100);
  },120000);
});
