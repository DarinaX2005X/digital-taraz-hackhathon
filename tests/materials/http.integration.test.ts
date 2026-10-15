import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdentityViewerSchema, WorkspaceResultSchema } from '../../src/features/identity/contracts';
import { ProjectResultSchema } from '../../src/features/workspace/contracts';
import { SourceInitResultSchema, SourceUploadResultSchema } from '../../src/contracts/sources';
import { CollectionListSchema, CollectionResultSchema, CorrectionResultSchema, DatasetPageSchema, ImportMappingSchema, ImportPreviewSchema, ImportResultSchema, MaterialHistorySchema, ResolutionResultSchema, type DatasetRecord, type MaterialValue } from '../../src/contracts/materials';
import { artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool, origin: string;
beforeAll(() => { pool = artifactTestPool(); origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`; });
afterAll(async () => { await pool?.end(); });
class Client {
  cookies = new Map<string, string>(); userId?: string; deadline = AbortSignal.timeout(55_000);
  async request(path: string, method = 'GET', body?: unknown, extra: HeadersInit = {}) {
    const headers = new Headers(extra);
    if (method !== 'GET') { if (!headers.has('origin')) headers.set('origin', origin); headers.set('content-type', body instanceof Uint8Array ? 'application/octet-stream' : 'application/json'); }
    if (this.userId && !headers.has('x-tirlik-user-id')) headers.set('x-tirlik-user-id', this.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.any([this.deadline, AbortSignal.timeout(30_000)]) });
    for (const serialized of response.headers.getSetCookie()) { const first = serialized.split(';')[0]!, split = first.indexOf('='); if (first.slice(split + 1)) this.cookies.set(first.slice(0, split), first.slice(split + 1)); else this.cookies.delete(first.slice(0, split)); }
    return response;
  }
}
async function account() {
  const client = new Client(), email = `source-http-${randomUUID()}@example.test`, password = 'Synthetic source password 42';
  expect((await client.request('/api/auth/sign-up/email', 'POST', { email, password, name: 'Synthetic source owner', locale: 'ru' })).status).toBe(200);
  const mailOrigin = `http://127.0.0.1:${process.env.TIRLIK_MAIL_UI_PORT}`, search = new URL('/api/v1/search', mailOrigin); search.searchParams.set('query', `to:${email}`);
  const messages = await (await fetch(search, { signal: client.deadline })).json() as { messages: { ID: string }[] };
  let token: string | null = null;
  for (const message of messages.messages) { const mail = await (await fetch(`${mailOrigin}/api/v1/message/${message.ID}`, { signal: client.deadline })).json() as { Text: string }; const link = mail.Text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/verify\?[^\s]+/)?.[0]; if (link) { token = new URL(link).searchParams.get('token'); break; } }
  expect(token).not.toBeNull(); expect((await client.request('/api/auth/verify-email', 'POST', { token })).status).toBe(200);
  expect((await client.request('/api/auth/sign-in/email', 'POST', { email, password })).status).toBe(200);
  const viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json()); client.userId = viewer.user.id;
  const workspace = WorkspaceResultSchema.parse(await (await client.request('/api/identity/workspaces', 'POST', { name: 'Synthetic source workspace' }, { 'idempotency-key': randomUUID() })).json()).workspace;
  const project = ProjectResultSchema.parse(await (await client.request('/api/projects', 'POST', { workspaceId: workspace.workspaceId, expectedAuthzVersion: workspace.authzVersion, title: 'Synthetic source project' }, { 'idempotency-key': randomUUID() })).json()).project;
  return { client, viewer, workspace, project };
}

describe('mounted materials journey', () => {
  let fixture: Awaited<ReturnType<typeof account>>, collectionId: string, importId: string, record: DatasetRecord, original: MaterialValue, resolutionId: string;
  beforeAll(async () => { fixture = await account(); }, 60000);
  beforeEach(() => { fixture.client.deadline = AbortSignal.timeout(55_000); });
  it('imports owned bytes and confirms the mapped preview', async () => {
    const { client, workspace, project } = fixture, workspaceId = workspace.workspaceId;
    const bytes = Buffer.from('SKU,price\n001,100.25\n002,200\n');
    const source = SourceInitResultSchema.parse(await (await client.request('/api/sources/uploads/init', 'POST', { workspaceId, projectId: project.id, title: 'Own price file', fileName: 'prices.csv', format: 'csv', size: bytes.length }, { 'idempotency-key': randomUUID() })).json());
    expect((await client.request(`/api/sources/uploads/${source.upload.id}?workspaceId=${workspaceId}`, 'PUT', bytes, { 'x-upload-token': source.token! })).status).toBe(200);
    const ready = SourceUploadResultSchema.parse(await (await client.request(`/api/sources/uploads/${source.upload.id}/finalize`, 'POST', { workspaceId })).json());
    const collectionResponse = await client.request('/api/materials/collections', 'POST', { workspaceId, projectId: project.id, title: 'Own price data', kind: 'prices', expectedAuthzVersion: workspace.authzVersion }, { 'idempotency-key': randomUUID() });
    expect(collectionResponse.status).toBe(201); expect(collectionResponse.headers.get('cache-control')).toBe('no-store');
    const collection = CollectionResultSchema.parse(await collectionResponse.json()).collection; collectionId = collection.id;
    const mapping = ImportMappingSchema.parse({ fields: [{ id:'sku',label:'SKU',column:0,header:'SKU',kind:'text' },{ id:'price',label:'Price',column:1,header:'price',kind:'money' }],headers:['SKU','price'],headerRow:1,importMode:'upsert',recordKeySpec:{kind:'fields',fieldIds:['sku'],trim:true,caseSensitive:true,confirmed:true} });
    const base = { workspaceId, expectedAuthzVersion:workspace.authzVersion,expectedRevision:0 };
    const started = ImportResultSchema.parse(await (await client.request('/api/materials/imports','POST',{...base,collectionId:collection.id,sourceId:source.upload.sourceId,sourceVersionId:ready.upload.versionId,mapping},{'idempotency-key':randomUUID()})).json());
    importId = started.import.id; const previewPath = `/api/materials/imports/${importId}?workspaceId=${workspaceId}`;
    expect(ImportResultSchema.parse(await (await client.request(`/api/materials/imports/${started.import.id}/advance`,'POST',base)).json()).import.status).toBe('preview');
    const preview = ImportPreviewSchema.parse(await (await client.request(previewPath)).json());
    expect(preview.import.counts.added).toBe(2); expect(preview.canEdit).toBe(true);
    expect((await client.request(`/api/materials/imports/${started.import.id}/apply`,'POST',{...base,expectedReviewRevision:0},{'idempotency-key':randomUUID()})).status).toBe(200);
  },60000);
  it('pages stable records and saves a previewed correction exactly once', async () => {
    const { client, workspace } = fixture, workspaceId = workspace.workspaceId, collection = { id: collectionId };
    const base = { workspaceId, expectedAuthzVersion: workspace.authzVersion, expectedRevision: 0 };
    const datasetInput = {workspaceId,collectionId,limit:1};
    const first = DatasetPageSchema.parse(await (await client.request('/api/materials/datasets/query','POST',datasetInput)).json());
    expect(first.total).toBe(2);expect(first.records).toHaveLength(1);expect(first.nextCursor).not.toBeNull();
    const next = DatasetPageSchema.parse(await (await client.request('/api/materials/datasets/query','POST',{...datasetInput,after:first.nextCursor})).json());
    expect(next.records).toHaveLength(1); expect(next.records[0]!.recordId).not.toBe(first.records[0]!.recordId);
    expect((await client.request('/api/materials/datasets/query','POST',{...datasetInput,query:'changed-scope',after:first.nextCursor})).status).toBe(422);
    record = first.records[0]!; original = record.cells.price!.value;
    const correctionInput = {...base,expectedRevision:1,changes:[{recordId:record.recordId,fieldId:'price',rawValue:'175.50',reason:'Reviewed supplier update'}]};
    const correction = CorrectionResultSchema.parse(await (await client.request(`/api/materials/collections/${collection.id}/correction-preview`,'POST',correctionInput)).json());
    const body = {...correctionInput,previewHash:correction.previewHash}, operation = randomUUID();
    const saved = ResolutionResultSchema.parse(await (await client.request(`/api/materials/collections/${collection.id}/correct`,'POST',body,{'idempotency-key':operation})).json());
    expect(ResolutionResultSchema.parse(await (await client.request(`/api/materials/collections/${collection.id}/correct`,'POST',body,{'idempotency-key':operation})).json())).toEqual(saved);
    resolutionId = saved.resolutionId;
  },60000);
  it('undoes the correction while preserving immutable history', async () => {
    const { client, workspace } = fixture, workspaceId = workspace.workspaceId, collection = { id: collectionId }, saved = { resolutionId };
    const base = { workspaceId, expectedAuthzVersion: workspace.authzVersion, expectedRevision: 0 };
    const history = MaterialHistorySchema.parse(await (await client.request(`/api/materials/collections/${collection.id}/history?workspaceId=${workspaceId}`)).json());
    expect(history.resolutions).toHaveLength(2);expect(history.resolutions[0]).toMatchObject({kind:'correction',canUndo:true});
    expect((await client.request(`/api/materials/collections/${collection.id}/undo`,'POST',{...base,expectedRevision:2,resolutionId:saved.resolutionId,reason:'Undo reviewed update'},{'idempotency-key':randomUUID()})).status).toBe(200);
    const current = DatasetPageSchema.parse(await (await client.request('/api/materials/datasets/query','POST',{workspaceId,collectionId:collection.id})).json());
    expect(current.records.find((item)=>item.recordId===record.recordId)!.cells.price!.value).toEqual(original);
  },60000);
  it('opens the mounted pages and enforces actor, origin and session gates', async () => {
    const { client, workspace, viewer } = fixture, workspaceId = workspace.workspaceId, collection = { id: collectionId };
    const datasetInput = { workspaceId, collectionId, limit: 1 }, previewPath = `/api/materials/imports/${importId}?workspaceId=${workspaceId}`;
    const listed = CollectionListSchema.parse(await (await client.request(`/api/materials/collections?workspaceId=${workspaceId}&query=Own&kind=prices`)).json());
    expect(listed.collections[0]!.id).toBe(collection.id);
    expect((await client.request(`/app/materials?workspaceId=${workspaceId}`)).status).toBe(200);
    const page = `/app/materials/collections/${collection.id}?workspaceId=${workspaceId}`;
    expect((await client.request(page)).status).toBe(200);
    const guest = new Client();expect((await guest.request(previewPath)).status).toBe(401);expect([303,307]).toContain((await guest.request(page)).status);
    expect((await client.request(previewPath,'GET',undefined,{'x-tirlik-user-id':randomUUID()})).status).toBe(409);
    expect((await client.request('/api/materials/datasets/query','POST',datasetInput,{origin:'https://untrusted.example'})).status).toBe(403);
    expect((await client.request(`/api/materials/collections?workspaceId=${workspaceId}&limit=1&limit=2`)).status).toBe(422);
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[viewer.session.id]);
    expect((await client.request(previewPath)).status).toBe(401);
  },60000);
});




