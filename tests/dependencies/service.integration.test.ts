import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DependencyEdge } from '../../src/contracts/dependencies';
import { ImportMappingSchema } from '../../src/contracts/materials';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { createArtifactTargetResolver, tableCellTargetId } from '../../src/features/artifacts/domain/targets';
import { createDependencyService } from '../../src/features/dependencies/server/service';
import { createDependencyHandlers } from '../../src/features/dependencies/server/handlers';
import { createCollectionService } from '../../src/features/materials/server/collections';
import { createDatasetService } from '../../src/features/materials/server/datasets';
import { createImportService } from '../../src/features/materials/server/imports';
import { createSourceService } from '../../src/features/sources/server/service';
import { LocalSourceStorage } from '../../src/features/sources/server/storage';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
async function setup() {
  const base = await artifactFixture(pool), service = createDependencyService(pool);
  const table = await base.create({ kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Estimate', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Estimate', rowCount: 1, columnCount: 3, cellData: { '0': { '0': { v: 1500, t: 2 }, '1': { v: 3, t: 2 }, '2': { v: 3000, t: 2, f: '=A1*B1' } } } } } }, stableIds: { sheet: { rows: ['service'], columns: ['price', 'quantity', 'total'] } } }, 'Estimate');
  const document = await base.create({ kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'paragraph', attrs: { id: 'manual' }, content: [{ type: 'text', text: 'My personally agreed delivery date.' }] }, { type: 'paragraph', attrs: { id: 'amount-line' }, content: [{ type: 'dataField', attrs: { id: 'amount', value: '3000' } }] }] } }, 'Offer');
  const price = tableCellTargetId('sheet', 'service', 'price'), quantity = tableCellTargetId('sheet', 'service', 'quantity'), total = tableCellTargetId('sheet', 'service', 'total');
  const edges: DependencyEdge[] = [
    { id: randomUUID(), inputs: [{ key: 'price', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: price } }, { key: 'qty', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: quantity } }], target: { artifactId: table.artifact.id, targetElementId: total }, transform: { kind: 'decimal', operation: 'product', inputs: ['price', 'qty'], scale: 2 }, updateMode: 'deterministic', label: 'Line total' },
    { id: randomUUID(), inputs: [{ key: 'total', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: total } }], target: { artifactId: document.artifact.id, targetElementId: 'amount' }, transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale: 'ru', scale: 2, basis: 'major' }, updateMode: 'propose', label: 'Offer total' },
  ];
  const input = { workspaceId: base.workspaceId, projectId: base.projectId, expectedAuthzVersion: await currentArtifactAuthz(pool, base.workspaceId) };
  await service.register(base.owner, randomUUID(), { ...input, edges });
  return { ...base, dependencies: service, input, edges, tableId: table.artifact.id, documentId: document.artifact.id, price, total };
}
describe('authorized linked-change transactions', () => {
  it('uses a real accepted stable fact to draft and apply the canonical quote update while retaining pinned lineage', async () => {
    const base = await artifactFixture(pool), dependencies = createDependencyService(pool);
    const sources = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'dependency-facts', randomUUID())));
    const collections = createCollectionService(pool), imports = createImportService(pool), datasets = createDatasetService(pool);
    const mapping = ImportMappingSchema.parse({ fields: [{ id: 'sku', label: 'SKU', column: 0, header: 'SKU', kind: 'text' }, { id: 'priceKzt', label: 'Цена', column: 1, header: 'priceKzt', kind: 'money', currency: 'KZT' }], headers: ['SKU', 'priceKzt'], headerRow: 1, importMode: 'upsert', recordKeySpec: { kind: 'fields', fieldIds: ['sku'], trim: true, caseSensitive: true, confirmed: true } });
    const collection = await collections.create(base.owner, randomUUID(), { workspaceId: base.workspaceId, projectId: base.projectId, title: 'Service catalog', kind: 'prices', expectedAuthzVersion: 1 });
    const acceptPrice = async (price: number, expectedRevision: number) => {
      const bytes = new TextEncoder().encode(`SKU,priceKzt\n010201,${price}\n`);
      const initialized = await sources.init(base.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: base.workspaceId, projectId: base.projectId, title: 'Accepted service catalog', fileName: `catalog-${price}.csv`, format: 'csv', size: bytes.length }));
      await sources.put(base.owner, base.workspaceId, initialized.upload.id, initialized.token!, new Blob([bytes]).stream());
      const ready = await sources.finalize(base.owner, base.workspaceId, initialized.upload.id);
      const begin = { workspaceId: base.workspaceId, collectionId: collection.collection.id, sourceId: initialized.upload.sourceId, sourceVersionId: ready.upload.versionId, mapping, expectedAuthzVersion: 1, expectedRevision };
      let item = (await imports.begin(base.owner, randomUUID(), begin)).import;
      while (item.status === 'preparing') item = (await imports.advance(base.owner, item.id, { workspaceId: base.workspaceId, expectedAuthzVersion: 1, expectedRevision })).import;
      await imports.apply(base.owner, randomUUID(), item.id, { workspaceId: base.workspaceId, expectedAuthzVersion: 1, expectedRevision, expectedReviewRevision: item.reviewRevision });
      return (await datasets.query(base.owner, { workspaceId: base.workspaceId, collectionId: collection.collection.id })).records[0]!.cells.priceKzt!.sourceRef;
    };
    const oldRef = await acceptPrice(420, 0);
    const cell = (row: string, column: string) => tableCellTargetId('quote', row, column);
    const priceId = cell('service', 'price'), quantityId = cell('service', 'quantity'), serviceAmountId = cell('service', 'amount'), totalId = cell('total', 'amount');
    const table = await base.service.create(base.owner, randomUUID(), { workspaceId: base.workspaceId, projectId: base.projectId, expectedAuthzVersion: 1, title: 'Canonical quote', sourceRefs: [oldRef], bindings: [{ targetElementId: priceId, sourceRef: oldRef, transformId: 'catalog-price', updateMode: 'deterministic' }], content: { kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Quote', appVersion: '1', locale: 'ruRU', sheetOrder: ['quote'], sheets: { quote: { id: 'quote', name: 'Quote', rowCount: 5, columnCount: 3, cellData: { 0: { 0: { v: 420, t: 2 }, 1: { v: 180, t: 2 }, 2: { v: '75600.00', t: 1, f: '=A1*B1' } }, 1: { 2: { v: '21600.00', t: 1 } }, 2: { 2: { v: '31200.00', t: 1 } }, 3: { 2: { v: '3500.00', t: 1 } }, 4: { 2: { v: '131900.00', t: 1, f: '=SUM(C1:C4)' } } } } } }, stableIds: { quote: { rows: ['service', 'windows', 'specialist', 'delivery', 'total'], columns: ['price', 'quantity', 'amount'] } } } });
    const document = await base.service.create(base.owner, randomUUID(), { workspaceId: base.workspaceId, projectId: base.projectId, expectedAuthzVersion: 1, title: 'Offer', sourceRefs: [oldRef], bindings: [{ targetElementId: 'quoteTotal', sourceRef: oldRef, transformId: 'quote-total', updateMode: 'propose' }], content: { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'paragraph', attrs: { id: 'manualDelivery' }, content: [{ type: 'text', text: 'Срок доставки согласуем отдельно.' }] }, { type: 'paragraph', attrs: { id: 'amountLine' }, content: [{ type: 'dataField', attrs: { id: 'quoteTotal', value: '131 900,00 ₸' } }] }] } } });
    const otherAmounts = ['windows', 'specialist', 'delivery'].map((row) => cell(row, 'amount'));
    const edges: DependencyEdge[] = [
      { id: randomUUID(), inputs: [{ key: 'price', ref: { kind: 'source', sourceRef: oldRef } }], target: { artifactId: table.artifact.id, targetElementId: priceId }, transform: { kind: 'copy', input: 'price' }, updateMode: 'deterministic', label: 'Accepted service price' },
      { id: randomUUID(), inputs: [{ key: 'price', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: priceId } }, { key: 'quantity', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: quantityId } }], target: { artifactId: table.artifact.id, targetElementId: serviceAmountId }, transform: { kind: 'decimal', operation: 'product', inputs: ['price', 'quantity'], scale: 2 }, updateMode: 'deterministic', label: 'Service amount' },
      { id: randomUUID(), inputs: [serviceAmountId, ...otherAmounts].map((targetElementId, index) => ({ key: `line${index}`, ref: { kind: 'artifact' as const, artifactId: table.artifact.id, targetElementId } })), target: { artifactId: table.artifact.id, targetElementId: totalId }, transform: { kind: 'decimal', operation: 'sum', inputs: ['line0', 'line1', 'line2', 'line3'], scale: 2 }, updateMode: 'deterministic', label: 'Known quote total' },
      { id: randomUUID(), inputs: [{ key: 'total', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: totalId } }], target: { artifactId: document.artifact.id, targetElementId: 'quoteTotal' }, transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale: 'ru', scale: 2, basis: 'major' }, updateMode: 'propose', label: 'Offer total' },
    ];
    const input = { workspaceId: base.workspaceId, projectId: base.projectId, expectedAuthzVersion: 1 };
    await dependencies.register(base.owner, randomUUID(), { ...input, edges });
    const currentRef = await acceptPrice(485, 1);
    expect(currentRef.recordId).toBe(oldRef.recordId); expect(currentRef.fieldId).toBe(oldRef.fieldId); expect(currentRef.factRevision).toBe(2);
    const change = await dependencies.prepare(base.owner, randomUUID(), input);
    expect(change.proposal.changes.find((item) => item.target.targetElementId === totalId)?.after).toBe('143600.00');
    const groupId = change.proposal.changes[0]!.groupId;
    const accepted = await dependencies.review(base.owner, randomUUID(), change.id, 'accept', { ...input, expectedRevision: change.revision, groupIds: [groupId] });
    expect(accepted.receipt?.artifacts).toHaveLength(2);
    const opened = await base.read(document.artifact.id), resolver = createArtifactTargetResolver(opened.content, opened.artifact.bindings, opened.locks);
    expect(String(resolver('quoteTotal', 'value')!.value)).toContain('143');
    expect(JSON.stringify(resolver('manualDelivery')!.value)).toContain('Срок доставки согласуем отдельно.');
    expect(opened.artifact.bindings[0]!.sourceRef).toMatchObject({ recordId: oldRef.recordId, factRevision: 2 });
    const oldVersion = await base.service.version(base.owner, { workspaceId: base.workspaceId, artifactId: document.artifact.id, revision: 0 });
    expect(oldVersion.artifact.bindings[0]!.sourceRef).toMatchObject({ sourceVersionId: oldRef.sourceVersionId, factRevision: 1 });
  });
  it('accepts table/document changes atomically, replays once, reopens, and undoes through canonical history', async () => {
    const f = await setup(), before = await f.read(f.documentId), proposal = await f.dependencies.prepare(f.owner, randomUUID(), f.input);
    expect(proposal.proposal.changes.map((change) => change.state)).toEqual(['ready', 'ready']);
    const key = randomUUID(), review = { ...f.input, expectedRevision: proposal.revision, groupIds: [proposal.proposal.changes[0]!.groupId] };
    const accepted = await f.dependencies.review(f.owner, key, proposal.id, 'accept', review);
    expect(accepted.receipt?.artifacts).toHaveLength(2);
    expect(await f.dependencies.review(f.owner, key, proposal.id, 'accept', review)).toEqual(accepted);
    const after = await f.read(f.documentId), resolver = createArtifactTargetResolver(after.content);
    expect(JSON.stringify(resolver('amount')!.value)).toContain('500');
    expect(resolver('manual')!.value).toEqual(createArtifactTargetResolver(before.content)('manual')!.value);
    expect((await f.dependencies.changeset(f.owner, proposal.id, { workspaceId: f.workspaceId, projectId: f.projectId })).state).toBe('applied');
    await f.service.undo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, commandGroupId: randomUUID(), targetCommandGroupId: accepted.receipt!.commandGroupId, expectedArtifactRevisions: accepted.receipt!.committedRevisionVector, expectedSourceRevisions: {} });
    expect((await f.read(f.documentId)).content).toEqual(before.content);
    expect(createArtifactTargetResolver((await f.read(f.tableId)).content)(f.total)!.value).toMatchObject({ v: 3000, f: '=A1*B1' });
  });
  it('rejects stale upstream revisions before writing any downstream field', async () => {
    const f = await setup(), proposed = await f.dependencies.prepare(f.owner, randomUUID(), f.input), table = await f.read(f.tableId);
    const target = createArtifactTargetResolver(table.content)(f.price)!;
    await f.service.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [f.tableId]: table.artifact.currentRevision }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: f.tableId, baseRevision: table.artifact.currentRevision, kind: 'table', expectedSourceRevisions: {}, reason: 'New price', operations: [{ targetId: f.price, op: 'set', value: { v: 2000, t: 2 }, beforeHash: target.hash }] }] } });
    await expect(f.dependencies.review(f.owner, randomUUID(), proposed.id, 'accept', { ...f.input, expectedRevision: proposed.revision, groupIds: [proposed.proposal.changes[0]!.groupId] })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read(f.documentId)).artifact.currentRevision).toBe(0);
    expect((await f.dependencies.changeset(f.owner, proposed.id, { workspaceId: f.workspaceId, projectId: f.projectId })).revision).toBe(0);
  });
  it('does not expose graphs or saved previews after project access is absent', async () => {
    const f = await setup(), proposed = await f.dependencies.prepare(f.owner, randomUUID(), f.input);
    await expect(f.dependencies.read(f.member, { workspaceId: f.workspaceId, projectId: f.projectId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.dependencies.changeset(f.member, proposed.id, { workspaceId: f.workspaceId, projectId: f.projectId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('restores the prior graph mapping when the canonical binding group is undone and redone', async () => {
    const f = await setup(), before = await f.read(f.documentId), target = createArtifactTargetResolver(before.content)('amount')!;
    const updated: DependencyEdge = { ...f.edges[1]!, id: randomUUID(), transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale: 'en', scale: 2, basis: 'major' } };
    const applied = await f.service.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, group: { commandGroupId: randomUUID(), dependencyEdges: [updated], expectedArtifactRevisions: { [f.documentId]: before.artifact.currentRevision }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: f.documentId, baseRevision: before.artifact.currentRevision, kind: 'document', expectedSourceRevisions: {}, reason: 'Change linked currency display', operations: [{ targetId: 'amount', op: 'set', value: target.value, beforeHash: target.hash }] }] } });
    const graph = () => f.dependencies.read(f.owner, { workspaceId: f.workspaceId, projectId: f.projectId });
    expect((await graph()).edges.find((edge) => edge.target.artifactId === f.documentId)).toEqual(updated);
    const undo = await f.service.undo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, commandGroupId: randomUUID(), targetCommandGroupId: applied.commandGroupId, expectedArtifactRevisions: applied.committedRevisionVector, expectedSourceRevisions: {} });
    expect((await graph()).edges.find((edge) => edge.target.artifactId === f.documentId)).toEqual(f.edges[1]);
    await f.service.redo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: f.input.expectedAuthzVersion, commandGroupId: randomUUID(), targetCommandGroupId: applied.commandGroupId, expectedArtifactRevisions: undo.committedRevisionVector, expectedSourceRevisions: {} });
    expect((await graph()).edges.find((edge) => edge.target.artifactId === f.documentId)).toEqual(updated);
  });
  it('enforces origin, actor and strict query shape at the HTTP handler', async () => {
    const f = await setup(), origin = 'http://127.0.0.1:3000';
    const handlers = createDependencyHandlers({ pool, origin, getActor: async () => ({ user: { id: f.owner.userId }, session: { id: f.owner.sessionId } } as never) });
    const headers = { 'x-tirlik-user-id': f.owner.userId, 'content-type': 'application/json', 'idempotency-key': randomUUID(), origin };
    const create = await handlers.handle(new Request(`${origin}/api/changesets`, { method: 'POST', headers, body: JSON.stringify(f.input) }));
    expect(create.status).toBe(201); expect(create.headers.get('cache-control')).toBe('no-store');
    const badOrigin = await handlers.handle(new Request(`${origin}/api/changesets`, { method: 'POST', headers: { ...headers, origin: 'https://other.invalid' }, body: JSON.stringify(f.input) }));
    expect(badOrigin.status).toBe(403);
    const mismatch = await handlers.handle(new Request(`${origin}/api/dependencies?workspaceId=${f.workspaceId}&projectId=${f.projectId}`, { headers: { 'x-tirlik-user-id': randomUUID() } }));
    expect(mismatch.status).toBe(409);
    const extra = await handlers.handle(new Request(`${origin}/api/dependencies?workspaceId=${f.workspaceId}&projectId=${f.projectId}&debug=1`, { headers }));
    expect(extra.status).toBe(422);
  });
});
