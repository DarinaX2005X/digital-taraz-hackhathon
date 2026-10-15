import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { IdentityViewerSchema, WorkspaceResultSchema } from '@/features/identity/contracts';
import { ProjectResultSchema } from '@/features/workspace/contracts';
import { SourceInitResultSchema, SourceUploadResultSchema } from '@/contracts/sources';
import { ArtifactMutationResultSchema, ArtifactSnapshotSchema } from '@/features/artifacts/contracts';
import type { ExportJob } from '@/features/exports/contracts';
import { sheetCommand } from '@/features/sheets/domain/commands';
import { requireTable } from '@/features/sheets/domain/model';

const origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
class Client {
  cookies = new Map<string, string>(); userId?: string;
  async request(path: string, method = 'GET', body?: unknown, custom: HeadersInit = {}) {
    const headers = new Headers(custom);
    if (method !== 'GET') { if (!headers.has('origin')) headers.set('origin', origin); headers.set('content-type', body instanceof Uint8Array ? 'application/octet-stream' : 'application/json'); }
    if (this.userId && !headers.has('x-tirlik-user-id')) headers.set('x-tirlik-user-id', this.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    for (const serialized of response.headers.getSetCookie()) { const first = serialized.split(';')[0]!, split = first.indexOf('='); if (first.slice(split + 1)) this.cookies.set(first.slice(0, split), first.slice(split + 1)); else this.cookies.delete(first.slice(0, split)); }
    return response;
  }
}
const client = new Client();
let workspaceId: string, authzVersion: number, projectId: string, artifactId: string, sourceId: string, sourceVersionId: string;
beforeAll(async () => {
  const email = `sheet-http-${randomUUID()}@example.test`, password = 'Synthetic spreadsheet password 42';
  expect((await client.request('/api/auth/sign-up/email', 'POST', { email, password, name: 'Synthetic spreadsheet owner', locale: 'ru' })).status).toBe(200);
  const mailOrigin = `http://127.0.0.1:${process.env.TIRLIK_MAIL_UI_PORT}`, search = new URL('/api/v1/search', mailOrigin); search.searchParams.set('query', `to:${email}`);
  const messages = await (await fetch(search, { signal: AbortSignal.timeout(10000) })).json() as { messages: { ID: string }[] };
  let token: string | null = null;
  for (const message of messages.messages) { const mail = await (await fetch(`${mailOrigin}/api/v1/message/${message.ID}`, { signal: AbortSignal.timeout(10000) })).json() as { Text: string }; const link = mail.Text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/verify\?[^\s]+/)?.[0]; if (link) { token = new URL(link).searchParams.get('token'); break; } }
  expect(token).not.toBeNull(); expect((await client.request('/api/auth/verify-email', 'POST', { token })).status).toBe(200);
  expect((await client.request('/api/auth/sign-in/email', 'POST', { email, password })).status).toBe(200);
  client.userId = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json()).user.id;
  const workspace = WorkspaceResultSchema.parse(await (await client.request('/api/identity/workspaces', 'POST', { name: 'Synthetic spreadsheet workspace' }, { 'idempotency-key': randomUUID() })).json()).workspace;
  workspaceId = workspace.workspaceId; authzVersion = workspace.authzVersion;
  projectId = ProjectResultSchema.parse(await (await client.request('/api/projects', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, title: 'Synthetic spreadsheet project' }, { 'idempotency-key': randomUUID() })).json()).project.id;
}, 120000);

describe('mounted source → editable sheet → file journey', () => {
  it('previews a pinned XLSX version and creates it idempotently after reviewed losses', async () => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Prices');
    sheet.getCell('A1').value = 2.5; sheet.getCell('B1').value = 19.99; sheet.getCell('C1').value = { formula: 'ROUND(A1*B1,2)', result: 999 }; sheet.getCell('A2').value = '00123';
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const init = SourceInitResultSchema.parse(await (await client.request('/api/sources/uploads/init', 'POST', { workspaceId, projectId, title: 'Own price workbook', fileName: 'prices.xlsx', format: 'xlsx', size: bytes.length }, { 'idempotency-key': randomUUID() })).json());
    expect((await client.request(`/api/sources/uploads/${init.upload.id}?workspaceId=${workspaceId}`, 'PUT', bytes, { 'x-upload-token': init.token! })).status).toBe(200);
    const ready = SourceUploadResultSchema.parse(await (await client.request(`/api/sources/uploads/${init.upload.id}/finalize`, 'POST', { workspaceId })).json()).upload;
    sourceId = ready.sourceId; sourceVersionId = ready.versionId!; expect(sourceVersionId).toBeTruthy();
    const key = randomUUID(), input = { workspaceId, sourceId, sourceVersionId, expectedAuthzVersion: authzVersion };
    const response = await client.request('/api/sheets/import', 'POST', { ...input, action: 'preview' }, { 'idempotency-key': key }); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const preview = await response.json() as { previewHash: string; sample: { cells: string[][] }[] }; expect(preview.sample[0]!.cells[1]![0]).toBe('00123'); expect(preview.sample[0]!.cells[0]![2]).not.toBe('999');
    const createBody = { ...input, action: 'create', previewHash: preview.previewHash };
    const createdResponse = await client.request('/api/sheets/import', 'POST', createBody, { 'idempotency-key': key }); expect(createdResponse.status).toBe(201);
    const created = ArtifactMutationResultSchema.parse(await createdResponse.json()); artifactId = created.artifact.id;
    const replay = ArtifactMutationResultSchema.parse(await (await client.request('/api/sheets/import', 'POST', createBody, { 'idempotency-key': key })).json()); expect(replay.artifact.id).toBe(artifactId);
    expect((await client.request('/api/sheets/import', 'POST', { ...createBody, previewHash: '0'.repeat(64) }, { 'idempotency-key': key })).status).toBe(409);
    expect((await new Client().request('/api/sheets/import', 'POST', createBody, { 'idempotency-key': randomUUID() })).status).toBe(401);
    expect((await client.request('/api/sheets/import', 'POST', createBody, { 'idempotency-key': randomUUID(), 'x-tirlik-user-id': randomUUID() })).status).toBe(409);
  }, 120000);
  it('persists direct input and formula changes, reopens them and undoes the one user action', async () => {
    expect(artifactId).toBeTruthy(); const url = `/api/artifacts/${artifactId}?workspaceId=${workspaceId}`;
    const initial = ArtifactSnapshotSchema.parse(await (await client.request(url)).json()), desired = structuredClone(requireTable(initial.content)), sheetId = desired.workbook.sheetOrder[0]!;
    desired.workbook.sheets[sheetId]!.cellData[0]![0] = { v: 4, t: 2 }; desired.workbook.sheets[sheetId]!.cellData[0]![2] = { f: '=A1*B1' };
    const draft = (await sheetCommand(initial, desired, 'Change quantity and formula'))!, groupId = randomUUID();
    const group = { ...draft, commandGroupId: groupId, commands: draft.commands.map((command) => ({ ...command, commandId: randomUUID() })) };
    const response = await client.request('/api/artifacts/commands', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, group }, { 'idempotency-key': groupId }); expect(response.status).toBe(200);
    const reopened = ArtifactSnapshotSchema.parse(await (await client.request(url)).json());
    expect(requireTable(reopened.content).workbook.sheets[sheetId]!.cellData[0]![2]).toMatchObject({ f: '=A1*B1', v: 79.96 }); expect(reopened.artifact.sourceRefs).toEqual(initial.artifact.sourceRefs);
    const undoId = randomUUID(); expect((await client.request('/api/artifacts/history/undo', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, commandGroupId: undoId, targetCommandGroupId: groupId, expectedArtifactRevisions: { [artifactId]: reopened.artifact.currentRevision }, expectedSourceRevisions: draft.expectedSourceRevisions }, { 'idempotency-key': undoId })).status).toBe(200);
    expect(ArtifactSnapshotSchema.parse(await (await client.request(url)).json()).content).toEqual(initial.content);
  }, 90000);
  it('downloads authenticated XLSX and CSV bytes for the saved revision', async () => {
    const snapshot = ArtifactSnapshotSchema.parse(await (await client.request(`/api/artifacts/${artifactId}?workspaceId=${workspaceId}`)).json());
    const sheetId = requireTable(snapshot.content).workbook.sheetOrder[0]!;
    const response = await client.request('/api/exports', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, locale: 'ru', items: [{ artifactId, revision: snapshot.artifact.currentRevision, formats: ['xlsx', 'csv'], options: { sheetId } }] }, { 'idempotency-key': randomUUID() }); expect(response.status).toBe(201);
    const job = await response.json() as ExportJob;
    const renderedResponse = await client.request(`/api/exports/${job.id}/render`, 'POST', { workspaceId, expectedAuthzVersion: authzVersion }); expect(renderedResponse.status).toBe(200);
    const rendered = await renderedResponse.json() as ExportJob; expect(rendered.status).toBe('ready'); expect(rendered.files).toHaveLength(2);
    for (const file of rendered.files) {
      const url = `/api/exports/${job.id}/files/${file.id}?workspaceId=${workspaceId}`, download = await client.request(url); expect(download.status).toBe(200); expect(download.headers.get('cache-control')).toBe('no-store');
      const bytes = new Uint8Array(await download.arrayBuffer());
      if (file.format === 'xlsx') { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]); expect(workbook.getWorksheet('Prices')!.getCell('A2').value).toBe('00123'); expect(workbook.getWorksheet('Prices')!.getCell('C1').formula).toBe('ROUND(A1*B1,2)'); }
      else expect(new TextDecoder().decode(bytes)).toContain('00123');
      expect((await new Client().request(url)).status).toBe(401);
    }
  }, 90000);
});
