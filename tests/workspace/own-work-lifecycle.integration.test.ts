import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectResultSchema } from '@/features/workspace/contracts';
import { SourceInitResultSchema, SourceUploadResultSchema } from '@/contracts/sources';
import { ImportMappingSchema } from '@/contracts/materials';
import { RunSchema } from '@/contracts/runs';
import { createWorkspaceHandlers } from '@/features/workspace/server/handlers';
import { createSourceHandlers } from '@/features/sources/server/handlers';
import { LocalSourceStorage } from '@/features/sources/server/storage';
import { createRunHandlers } from '@/features/runs/server/handlers';
import { createRunRegistry } from '@/features/runs/server/registry';
import { createRunService } from '@/features/runs/server/service';
import { runtimeFixture } from '@/features/runs/server/fixture';
import { documentCommand } from '@/features/documents/domain/commands';
import { readDocument } from '@/features/documents/domain/document';
import { createProjectViews } from '@/features/workspace/server/project-views';
import { createCollectionService } from '@/features/materials/server/collections';
import { createImportService } from '@/features/materials/server/imports';
import { createDatasetService } from '@/features/materials/server/datasets';
import { createCorrectionService } from '@/features/materials/server/corrections';
import { createCollectionLibraryLifecycleService } from '@/features/materials/server/library-lifecycle';
import { createSourceLibraryLifecycleService } from '@/features/sources/server/library-lifecycle';
import { createSourceService } from '@/features/sources/server/service';
import { InitSourceUploadSchema } from '@/contracts/sources';
import { artifactFixture, artifactTestPool, currentArtifactAuthz, testDocument } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

const priceMapping = ImportMappingSchema.parse({
  fields: [
    { id: 'sku', label: 'Артикул', column: 0, header: 'SKU', kind: 'text' },
    { id: 'price', label: 'Цена', column: 1, header: 'price', kind: 'money', currency: 'KZT' },
  ],
  headerRow: 1, headers: ['SKU', 'price'], importMode: 'upsert',
  recordKeySpec: { kind: 'fields', fieldIds: ['sku'], trim: true, caseSensitive: true, confirmed: true },
});

function blobBytes(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer]);
}

describe('own files to a reopened editable result', () => {
  it('creates one project, pins two ready sources, starts one run, and preserves an edited result across retries', async () => {
    const fixture = await artifactFixture(pool);
    const origin = 'http://localhost:3000';
    const actor = async () => ({
      user: { id: fixture.owner.userId, name: 'Synthetic owner', email: 'owner@example.test', locale: 'ru' as const },
      session: { id: fixture.owner.sessionId, expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date() },
    });
    const headers = (operationId = randomUUID()) => ({ Origin: origin, 'X-Tirlik-User-Id': fixture.owner.userId, 'Content-Type': 'application/json', 'Idempotency-Key': operationId });
    const projects = createWorkspaceHandlers({ pool, origin, getActor: actor });
    const projectKey = randomUUID();
    const projectBody = { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, title: 'Предложение для клиента', goal: 'Собрать предложение по прайсу и условиям доставки' };
    const projectRequest = () => new Request(`${origin}/api/projects`, { method: 'POST', headers: headers(projectKey), body: JSON.stringify(projectBody) });
    const projectResponse = await projects(projectRequest());
    expect(projectResponse.status).toBe(201);
    const project = ProjectResultSchema.parse(await projectResponse.json()).project;
    expect(ProjectResultSchema.parse(await (await projects(projectRequest())).json()).project.id).toBe(project.id);

    const storage = new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'own-work-tests', randomUUID()));
    const sources = createSourceHandlers({ pool, origin, getActor: actor, storage });
    async function upload(title: string, fileName: string, format: 'csv' | 'text', bytes: Uint8Array) {
      const key = randomUUID();
      const body = { workspaceId: fixture.workspaceId, projectId: project.id, title, fileName, format, size: bytes.byteLength };
      const init = () => sources(new Request(`${origin}/api/sources/uploads/init`, { method: 'POST', headers: headers(key), body: JSON.stringify(body) }));
      const first = SourceInitResultSchema.parse(await (await init()).json());
      const initialized = SourceInitResultSchema.parse(await (await init()).json());
      expect(initialized.upload.id).toBe(first.upload.id);
      const uploadBody = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(uploadBody).set(bytes);
      const put = await sources(new Request(`${origin}/api/sources/uploads/${initialized.upload.id}?workspaceId=${fixture.workspaceId}`, { method: 'PUT', headers: { Origin: origin, 'X-Tirlik-User-Id': fixture.owner.userId, 'X-Upload-Token': initialized.token!, 'Content-Type': 'application/octet-stream' }, body: new Blob([uploadBody]) }));
      expect(put.status).toBe(200);
      const finalize = () => sources(new Request(`${origin}/api/sources/uploads/${initialized.upload.id}/finalize`, { method: 'POST', headers: headers(), body: JSON.stringify({ workspaceId: fixture.workspaceId }) }));
      const ready = SourceUploadResultSchema.parse(await (await finalize()).json());
      expect(ready.upload.status).toBe('ready');
      expect(SourceUploadResultSchema.parse(await (await finalize()).json()).upload.versionId).toBe(ready.upload.versionId);
      return { ...ready.upload, revision: 1 as const };
    }
    const price = await upload('Прайс', 'prices.csv', 'csv', new TextEncoder().encode('SKU,price\nCHAIR,45000\n'));
    const terms = await upload('Условия доставки', 'delivery.txt', 'text', new TextEncoder().encode('Доставка занимает пять рабочих дней.'));

    const collections = createCollectionService(pool), imports = createImportService(pool), datasets = createDatasetService(pool), corrections = createCorrectionService(pool);
    const collection = await collections.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: project.id, expectedAuthzVersion: 1, title: 'Прайс для предложения', kind: 'prices' });
    const mutation = (revision: number) => ({ workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, expectedRevision: revision });
    let imported = (await imports.begin(fixture.owner, randomUUID(), { ...mutation(0), collectionId: collection.collection.id, sourceId: price.sourceId, sourceVersionId: price.versionId, mapping: priceMapping })).import;
    while (imported.status === 'preparing') imported = (await imports.advance(fixture.owner, imported.id, mutation(0))).import;
    expect(imported.status).toBe('preview');
    await imports.apply(fixture.owner, randomUUID(), imported.id, { ...mutation(0), expectedReviewRevision: imported.reviewRevision });
    const mapped = await datasets.query(fixture.owner, { workspaceId: fixture.workspaceId, collectionId: collection.collection.id });
    expect(mapped.records[0]?.cells.price?.value).toEqual({ kind: 'money', minorUnits: '4500000', currency: 'KZT' });
    const correction = { ...mutation(1), changes: [{ recordId: mapped.records[0]!.recordId, fieldId: 'price', rawValue: '47000', reason: 'Согласованная цена для предложения' }] };
    const correctionPreview = await corrections.preview(fixture.owner, collection.collection.id, correction);
    await corrections.apply(fixture.owner, randomUUID(), collection.collection.id, { ...correction, previewHash: correctionPreview.previewHash });
    const corrected = await datasets.query(fixture.owner, { workspaceId: fixture.workspaceId, collectionId: collection.collection.id });
    const correctedPrice = corrected.records[0]!.cells.price!;
    expect(correctedPrice).toMatchObject({ value: { kind: 'money', minorUnits: '4700000', currency: 'KZT' }, factRevision: 2 });

    const runtime = runtimeFixture(true);
    const registry = createRunRegistry([runtime.capability], runtime.tools);
    const runService = createRunService(pool, registry);
    const runs = createRunHandlers({ pool, service: runService, registry, origin, getActor: actor, wake: async () => undefined });
    const runKey = randomUUID();
    const runBody = {
      workspaceId: fixture.workspaceId, projectId: project.id, capabilityId: runtime.capability.id, capabilityVersion: 1,
      goal: projectBody.goal, locale: 'ru', inputRefs: [price, terms].map((source) => ({ kind: 'source' as const, id: source.sourceId, revision: source.revision })),
    };
    const runRequest = () => new Request(`${origin}/api/runs`, { method: 'POST', headers: headers(runKey), body: JSON.stringify(runBody) });
    const runResponse = await runs(runRequest());
    expect(runResponse.status).toBe(202);
    const run = RunSchema.parse(await runResponse.json());
    expect(RunSchema.parse(await (await runs(runRequest())).json()).id).toBe(run.id);
    expect((await pool.query<{ input_refs: unknown[] }>('SELECT input_refs FROM agent_runs WHERE id=$1', [run.id])).rows[0]!.input_refs).toEqual(runBody.inputRefs);

    const created = await fixture.service.create(fixture.owner, randomUUID(), {
      workspaceId: fixture.workspaceId, projectId: project.id, expectedAuthzVersion: 1, title: 'Предложение клиенту',
      content: testDocument('20 стульев по прайсу', 'Доставка — отдельной строкой.'),
      sourceRefs: [correctedPrice.sourceRef, { sourceId: terms.sourceId, sourceVersionId: terms.versionId!, revision: terms.revision }],
    });
    const opened = await fixture.service.read(fixture.owner, { workspaceId: fixture.workspaceId, artifactId: created.artifact.id });
    const edited = readDocument(testDocument('24 стула по прайсу', 'Доставка — отдельной строкой, срок пять рабочих дней.'));
    const prepared = await documentCommand(opened, edited, 'Уточнить количество и срок доставки');
    expect(prepared).not.toBeNull();
    const group = { ...prepared!, commandGroupId: randomUUID(), commands: prepared!.commands.map((command) => ({ ...command, commandId: randomUUID() })) };
    const receipt = await fixture.service.apply(fixture.owner, { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, group });
    expect(await fixture.service.apply(fixture.owner, { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, group })).toEqual(receipt);
    await createProjectViews(pool).record(fixture.owner, project.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, selectedArtifactId: created.artifact.id });
    const selected = await createProjectViews(pool).read(fixture.owner, fixture.workspaceId, project.id);
    const reopened = await fixture.service.readRoute(fixture.owner, { projectId: project.id, artifactId: selected.selectedArtifactId! });
    expect(reopened.content).toEqual(edited);
    expect(reopened.artifact.sourceRefs).toHaveLength(2);
    expect(reopened.artifact.sourceRefs[0]).toMatchObject({ collectionId: collection.collection.id, recordId: mapped.records[0]!.recordId, fieldId: 'price', factRevision: 2 });
    expect(reopened.artifact.currentRevision).toBe(created.artifact.currentRevision + 1);
  }, 120_000);

  it('enforces lifecycle authority and replay while copies remain independent', async () => {
    const fixture = await artifactFixture(pool);
    const destination = await fixture.projects.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, expectedAuthzVersion: 1, title: 'Destination project' });
    const sourceService = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'lifecycle-tests', randomUUID())));
    async function readySource(text: string, input: { projectId: string; sourceId?: string; expectedRevision?: number; title: string }) {
      const bytes = new TextEncoder().encode(text);
      const initialized = await sourceService.init(fixture.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: fixture.workspaceId, projectId: input.projectId, sourceId: input.sourceId, expectedRevision: input.expectedRevision ?? 0, title: input.title, fileName: 'prices.csv', format: 'csv', size: bytes.byteLength }));
      await sourceService.put(fixture.owner, fixture.workspaceId, initialized.upload.id, initialized.token!, blobBytes(bytes).stream());
      return (await sourceService.finalize(fixture.owner, fixture.workspaceId, initialized.upload.id)).upload;
    }
    const source = await readySource('SKU,price\nA,10\n', { projectId: fixture.projectId, title: 'Origin source' });
    const collections = createCollectionService(pool), datasets = createDatasetService(pool), corrections = createCorrectionService(pool);
    const createdCollection = await collections.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: 1, title: 'Origin collection', kind: 'prices' });
    const collectionId = createdCollection.collection.id, resolutionId = randomUUID(), mappingVersionId = randomUUID(), recordId = randomUUID();
    const sourceRef = { sourceId: source.sourceId, sourceVersionId: source.versionId!, revision: 1 };
    const cells = {
      sku: { value: { kind: 'text', text: 'A' }, rawValue: 'A', reviewState: 'observed', origin: 'observed', lineage: { fragmentId: 'row-1', row: 1, column: 0 }, sourceRef, factRevision: 1 },
      price: { value: { kind: 'money', minorUnits: '1000', currency: 'KZT' }, rawValue: '10', reviewState: 'observed', origin: 'observed', lineage: { fragmentId: 'row-1', row: 1, column: 1 }, sourceRef, factRevision: 1 },
    };
    await pool.query('UPDATE material_collections SET revision=1,mapping=$3,record_count=1 WHERE workspace_id=$1 AND id=$2', [fixture.workspaceId, collectionId, priceMapping]);
    await pool.query('INSERT INTO material_mapping_versions(id,workspace_id,collection_id,revision,mapping,created_by) VALUES($1,$2,$3,1,$4,$5)', [mappingVersionId, fixture.workspaceId, collectionId, priceMapping, fixture.owner.userId]);
    await pool.query("INSERT INTO material_resolutions(id,workspace_id,collection_id,revision,kind,mapping_version_id,reason,actor_id) VALUES($1,$2,$3,1,'import',$4,'Lifecycle fixture',$5)", [resolutionId, fixture.workspaceId, collectionId, mappingVersionId, fixture.owner.userId]);
    await pool.query('INSERT INTO material_records(id,collection_id,identity_hash,identity_key,current_revision,missing,label,cells,row_hash) VALUES($1,$2,$3,$4,1,false,$5,$6,$7)', [recordId, collectionId, 'identity-a', '["A"]', 'A', cells, 'row-a']);
    await pool.query('INSERT INTO material_record_versions(id,collection_id,record_id,revision,resolution_id,missing,label,cells,row_hash) VALUES($1,$2,$3,1,$4,false,$5,$6,$7)', [randomUUID(), collectionId, recordId, resolutionId, 'A', cells, 'row-a']);

    await fixture.projects.setGrant(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, userId: fixture.member.userId, scopes: ['read', 'edit', 'export'], expectedAuthzVersion: 1 });
    const authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const sourceLifecycle = createSourceLibraryLifecycleService(pool), collectionLifecycle = createCollectionLibraryLifecycleService(pool);
    const sourceBase = { objectKind: 'source' as const, workspaceId: fixture.workspaceId, objectId: source.sourceId, expectedAuthzVersion: authzVersion };
    const collectionBase = { objectKind: 'collection' as const, workspaceId: fixture.workspaceId, objectId: collectionId, expectedAuthzVersion: authzVersion };
    await expect(sourceLifecycle(fixture.member, { operationId: randomUUID(), command: { ...sourceBase, expectedMetadataRevision: 1, action: 'move', destinationProjectId: destination.project.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(collectionLifecycle(fixture.member, { operationId: randomUUID(), command: { ...collectionBase, expectedMetadataRevision: 1, action: 'move', destinationProjectId: destination.project.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const renameKey = randomUUID();
    const renameRequest = { operationId: renameKey, command: { ...sourceBase, expectedMetadataRevision: 1, action: 'rename' as const, title: 'Renamed source' } };
    const renamed = await sourceLifecycle(fixture.owner, renameRequest);
    expect(await sourceLifecycle(fixture.owner, renameRequest)).toEqual(renamed);
    await expect(sourceLifecycle(fixture.owner, { ...renameRequest, command: { ...renameRequest.command, title: 'Conflicting replay' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    const movedSource = await sourceLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...sourceBase, expectedMetadataRevision: 2, action: 'move', destinationProjectId: destination.project.id } });
    const sourceCopy = await sourceLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...sourceBase, expectedMetadataRevision: movedSource.item.metadataRevision, action: 'duplicate', destinationProjectId: fixture.projectId, title: 'Source copy', contentPolicy: 'fork-current' } });
    expect(sourceCopy.item).toMatchObject({ projectId: fixture.projectId, title: 'Source copy', metadataRevision: 1, contentRevision: 1 });
    const sourceStorage = await pool.query<{ id: string; current_version_id: string; original_key: string }>(`SELECT s.id,s.current_version_id,u.original_key FROM sources s JOIN source_uploads u ON u.workspace_id=s.workspace_id AND u.source_id=s.id AND u.published_version_id=s.current_version_id WHERE s.id=ANY($1::uuid[]) ORDER BY s.id`, [[source.sourceId, sourceCopy.item.id]]);
    expect(new Set(sourceStorage.rows.map((row) => row.current_version_id)).size).toBe(2);
    expect(new Set(sourceStorage.rows.map((row) => row.original_key)).size).toBe(1);
    await readySource('SKU,price\nA,12\n', { projectId: destination.project.id, sourceId: source.sourceId, expectedRevision: 1, title: 'Renamed source' });
    expect((await sourceService.read(fixture.owner, fixture.workspaceId, sourceCopy.item.id)).source.revision).toBe(1);
    const trashedSource = await sourceLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...sourceBase, expectedMetadataRevision: movedSource.item.metadataRevision, action: 'trash' } });
    const restoredSource = await sourceLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...sourceBase, expectedMetadataRevision: trashedSource.item.metadataRevision, action: 'restore' } });
    expect(restoredSource.item).toMatchObject({ lifecycleState: 'active', projectId: destination.project.id, contentRevision: 2 });

    const renamedCollection = await collectionLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...collectionBase, expectedMetadataRevision: 1, action: 'rename', title: 'Renamed collection' } });
    const movedCollection = await collectionLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...collectionBase, expectedMetadataRevision: renamedCollection.item.metadataRevision, action: 'move', destinationProjectId: destination.project.id } });
    const collectionCopy = await collectionLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...collectionBase, expectedMetadataRevision: movedCollection.item.metadataRevision, action: 'duplicate', destinationProjectId: fixture.projectId, title: 'Collection copy', contentPolicy: 'fork-current' } });
    expect(collectionCopy.item).toMatchObject({ projectId: fixture.projectId, metadataRevision: 1, contentRevision: 1 });
    const originalPage = await datasets.query(fixture.owner, { workspaceId: fixture.workspaceId, collectionId });
    const change = { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, expectedRevision: 1, changes: [{ recordId: originalPage.records[0]!.recordId, fieldId: 'price', rawValue: '12', reason: 'Original changes independently' }] };
    const preview = await corrections.preview(fixture.owner, collectionId, change);
    await corrections.apply(fixture.owner, randomUUID(), collectionId, { ...change, previewHash: preview.previewHash });
    expect((await datasets.query(fixture.owner, { workspaceId: fixture.workspaceId, collectionId: collectionCopy.item.id })).records[0]!.cells.price!.rawValue).toBe('10');
    const trashedCollection = await collectionLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...collectionBase, expectedMetadataRevision: movedCollection.item.metadataRevision, action: 'trash' } });
    const restoredCollection = await collectionLifecycle(fixture.owner, { operationId: randomUUID(), command: { ...collectionBase, expectedMetadataRevision: trashedCollection.item.metadataRevision, action: 'restore' } });
    expect(restoredCollection.item).toMatchObject({ lifecycleState: 'active', projectId: destination.project.id, contentRevision: 2 });
  }, 120_000);

  it('keeps 100,000 mapped records behind bounded pages and summaries', async () => {
    const fixture = await artifactFixture(pool);
    const sourceService = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'scale-tests', randomUUID())));
    const bytes = new TextEncoder().encode('SKU,price\nSAMPLE,1\n');
    const initialized = await sourceService.init(fixture.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: fixture.workspaceId, projectId: fixture.projectId, title: 'Scale source', fileName: 'scale.csv', format: 'csv', size: bytes.byteLength }));
    await sourceService.put(fixture.owner, fixture.workspaceId, initialized.upload.id, initialized.token!, blobBytes(bytes).stream());
    const source = (await sourceService.finalize(fixture.owner, fixture.workspaceId, initialized.upload.id)).upload;
    const created = await createCollectionService(pool).create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: 1, title: '100k bounded dataset', kind: 'prices' });
    const collectionId = created.collection.id;
    await pool.query('UPDATE material_collections SET revision=1,mapping=$3,record_count=100000 WHERE workspace_id=$1 AND id=$2', [fixture.workspaceId, collectionId, priceMapping]);
    await pool.query(`INSERT INTO material_records(id,collection_id,identity_hash,identity_key,current_revision,missing,label,cells,row_hash)
      SELECT gen_random_uuid(),$1,md5(g::text),jsonb_build_array('SKU-'||g)::text,1,false,'SKU-'||g,
        jsonb_build_object(
          'sku',jsonb_build_object('value',jsonb_build_object('kind','text','text','SKU-'||g),'rawValue','SKU-'||g,'reviewState','observed','origin','observed','lineage',jsonb_build_object('fragmentId','row-'||g,'row',g,'column',0),'sourceRef',jsonb_build_object('sourceId',$2::text,'sourceVersionId',$3::text,'revision',1),'factRevision',1),
          'price',jsonb_build_object('value',jsonb_build_object('kind','money','minorUnits',(g*100)::text,'currency','KZT'),'rawValue',g::text,'reviewState','observed','origin','observed','lineage',jsonb_build_object('fragmentId','row-'||g,'row',g,'column',1),'sourceRef',jsonb_build_object('sourceId',$2::text,'sourceVersionId',$3::text,'revision',1),'factRevision',1)
        ),md5('row-'||g)
      FROM generate_series(1,100000) g`, [collectionId, source.sourceId, source.versionId]);
    const datasets = createDatasetService(pool);
    const first = await datasets.query(fixture.owner, { workspaceId: fixture.workspaceId, collectionId, limit: 50 });
    expect(first).toMatchObject({ total: 100000, revision: 1 });
    expect(first.records).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    expect(JSON.stringify(first).length).toBeLessThan(900_000);
    const second = await datasets.query(fixture.owner, { workspaceId: fixture.workspaceId, collectionId, limit: 50, after: first.nextCursor });
    expect(second.records).toHaveLength(50);
    expect(new Set([...first.records, ...second.records].map((record) => record.recordId)).size).toBe(100);
    const aggregate = await datasets.aggregate(fixture.owner, { workspaceId: fixture.workspaceId, collectionId, fieldId: 'price', operation: 'count' });
    expect(aggregate).toMatchObject({ value: '100000', coverage: { total: 100000, included: 100000, excluded: 0 } });
    const context = await datasets.context(fixture.owner, { workspaceId: fixture.workspaceId, collectionId, sampleLimit: 10, measures: [{ id: 'row_count', fieldId: 'price', operation: 'count' }] });
    expect(context).toMatchObject({ matchedRecords: 100000, truncated: true, aggregates: [{ measureId: 'row_count', value: '100000' }] });
    expect(context.sample).toHaveLength(10);
    expect(JSON.stringify(context).length).toBeLessThan(900_000);
  }, 120_000);
});
