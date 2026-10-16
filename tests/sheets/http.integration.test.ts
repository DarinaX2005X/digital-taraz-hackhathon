import { createHash, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { IdentityViewerSchema, WorkspaceResultSchema } from '@/features/identity/contracts';
import { ProjectResultSchema } from '@/features/workspace/contracts';
import { SourceInitResultSchema, SourceUploadResultSchema } from '@/contracts/sources';
import { PreparedCalculationSchema } from '@/contracts/calculations';
import { ArtifactMutationResultSchema, ArtifactSnapshotSchema } from '@/features/artifacts/contracts';
import type { ExportJob } from '@/features/exports/contracts';
import { sheetCommand } from '@/features/sheets/domain/commands';
import { requireTable, stableCellId } from '@/features/sheets/domain/model';

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
    expect(desired.workbook.sheets[sheetId]!.cellData[1]![0]).toEqual({ v: '00123', t: 1 });
    desired.workbook.sheets[sheetId]!.cellData[0]![0] = { v: 4, t: 2 }; desired.workbook.sheets[sheetId]!.cellData[0]![2] = { f: '=A1*B1' };
    const draft = (await sheetCommand(initial, desired, 'Change quantity and formula'))!, groupId = randomUUID();
    const group = { ...draft, commandGroupId: groupId, commands: draft.commands.map((command) => ({ ...command, commandId: randomUUID() })) };
    const response = await client.request('/api/artifacts/commands', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, group }, { 'idempotency-key': groupId }); expect(response.status).toBe(200);
    const reopened = ArtifactSnapshotSchema.parse(await (await client.request(url)).json());
    expect(requireTable(reopened.content).workbook.sheets[sheetId]!.cellData[0]![2]).toMatchObject({ f: '=A1*B1', v: 79.96 }); expect(reopened.artifact.sourceRefs).toEqual(initial.artifact.sourceRefs);
    const undoId = randomUUID(); expect((await client.request('/api/artifacts/history/undo', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, commandGroupId: undoId, targetCommandGroupId: groupId, expectedArtifactRevisions: { [artifactId]: reopened.artifact.currentRevision }, expectedSourceRevisions: draft.expectedSourceRevisions }, { 'idempotency-key': undoId })).status).toBe(200);
    expect(ArtifactSnapshotSchema.parse(await (await client.request(url)).json()).content).toEqual(initial.content);
  }, 90000);
  it('prepares and applies the authoritative exact total through the mounted calculation routes', async () => {
    const url = `/api/artifacts/${artifactId}?workspaceId=${workspaceId}`;
    const initial = ArtifactSnapshotSchema.parse(await (await client.request(url)).json()), desired = structuredClone(requireTable(initial.content)), sheetId = desired.workbook.sheetOrder[0]!, sheet = desired.workbook.sheets[sheetId]!;
    const cellId = (row: number, column: number) => stableCellId(desired, { sheetId, row, column });
    sheet.cellData[0]![2] = { f: '=ROUND(A1*B1,2)', v: 999999, t: 2 };
    sheet.cellData[1] = { ...(sheet.cellData[1] ?? {}), 2: { f: '=C1', v: 999999, t: 2 } };
    sheet.cellData[2] = { 2: { f: '=C2', v: 999999, t: 2 } };
    sheet.calculation = { schemaVersion: 1, currency: 'KZT', scale: 2, rounding: 'half-up', lines: [{ id: 'price-line', quantityCellId: cellId(0, 0), priceCellId: cellId(0, 1), amountCellId: cellId(0, 2), expectedFormula: '=ROUND(A1*B1,2)' }], subtotalCellId: cellId(1, 2), subtotalFormula: '=C1', totalCellId: cellId(2, 2), totalFormula: '=C2' };
    const draft = (await sheetCommand(initial, desired, 'Configure exact calculation'))!, configureId = randomUUID();
    const group = { ...draft, commandGroupId: configureId, commands: draft.commands.map((command) => ({ ...command, commandId: randomUUID() })) };
    expect((await client.request('/api/artifacts/commands', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, group }, { 'idempotency-key': configureId })).status).toBe(200);
    const configured = ArtifactSnapshotSchema.parse(await (await client.request(url)).json());
    expect(requireTable(configured.content).workbook.sheets[sheetId]!.cellData[1]![0]).toEqual({ v: '00123', t: 1 });
    const preparedResponse = await client.request('/api/sheets/calculations/prepare', 'POST', { workspaceId, artifactId, expectedAuthzVersion: authzVersion, baseRevision: configured.artifact.currentRevision, sheetId });
    expect(preparedResponse.status).toBe(200);
    const prepared = PreparedCalculationSchema.parse(await preparedResponse.json()); expect(prepared.result.total).toBe('49.98');
    const applyId = randomUUID(), applyBody = { workspaceId, expectedAuthzVersion: authzVersion, prepared, reason: 'Apply verified total' };
    const applied = await client.request('/api/sheets/calculations/apply', 'POST', applyBody, { 'idempotency-key': applyId }); expect(applied.status).toBe(200);
    const replay = await client.request('/api/sheets/calculations/apply', 'POST', applyBody, { 'idempotency-key': applyId }); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(await applied.json());
    const reopened = ArtifactSnapshotSchema.parse(await (await client.request(url)).json());
    expect(requireTable(reopened.content).workbook.sheets[sheetId]!.cellData[1]![0]).toEqual({ v: '00123', t: 1 });
    expect(requireTable(reopened.content).workbook.sheets[sheetId]!.cellData[2]![2]).toMatchObject({ f: '=C2', v: '49.98' });
  }, 90000);
  it('downloads authenticated XLSX and CSV bytes for the saved revision', async () => {
    const snapshot = ArtifactSnapshotSchema.parse(await (await client.request(`/api/artifacts/${artifactId}?workspaceId=${workspaceId}`)).json());
    const table = requireTable(snapshot.content), sheetId = table.workbook.sheetOrder[0]!;
    expect(table.workbook.sheets[sheetId]!.cellData[1]![0]).toEqual({ v: '00123', t: 1 });
    const response = await client.request('/api/exports', 'POST', { workspaceId, expectedAuthzVersion: authzVersion, locale: 'ru', privateFieldsPolicy: 'exclude-internal', items: [{ artifactId, revision: snapshot.artifact.currentRevision, formats: ['xlsx', 'csv'], options: { sheetId } }] }, { 'idempotency-key': randomUUID() }); expect(response.status).toBe(201);
    const job = await response.json() as ExportJob;
    const renderedResponse = await client.request(`/api/exports/${job.id}/render`, 'POST', { workspaceId, expectedAuthzVersion: authzVersion }); expect(renderedResponse.status).toBe(200);
    const rendered = await renderedResponse.json() as ExportJob; expect(rendered.status).toBe('ready'); expect(rendered.files).toHaveLength(2);
    const bundleUrl = `/api/exports/${job.id}/bundle?workspaceId=${workspaceId}`, bundleResponse = await client.request(bundleUrl);
    expect(bundleResponse.status).toBe(200); expect(bundleResponse.headers.get('cache-control')).toBe('no-store'); expect(bundleResponse.headers.get('content-type')).toContain('application/zip');
    const bundle = await JSZip.loadAsync(await bundleResponse.arrayBuffer()), manifest = JSON.parse(await bundle.file('manifest.json')!.async('string')) as { revisions: { artifactId: string; versionId: string; revision: number; snapshotHash: string; contentHash: string; kind: string; sourceVersions: typeof snapshot.artifact.sourceRefs }[]; files: { id: string; fileName: string; sha256: string }[] };
    expect(manifest.revisions).toHaveLength(1);
    const exportedRevision = manifest.revisions[0]!;
    expect(exportedRevision).toEqual({
      artifactId,
      versionId: snapshot.version.id,
      revision: snapshot.artifact.currentRevision,
      snapshotHash: snapshot.version.snapshotHash,
      contentHash: snapshot.version.contentRef.hash,
      kind: 'table',
      sourceVersions: snapshot.artifact.sourceRefs,
    });
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(exportedRevision.artifactId).toMatch(uuidPattern);
    expect(exportedRevision.versionId).toMatch(uuidPattern);
    expect(exportedRevision.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(exportedRevision.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(exportedRevision.sourceVersions).toHaveLength(1);
    const pinnedSourceVersion = exportedRevision.sourceVersions[0]!;
    expect(pinnedSourceVersion).toMatchObject({ sourceId, sourceVersionId, revision: snapshot.artifact.sourceRefs[0]!.revision });
    expect(pinnedSourceVersion.sourceId).toMatch(uuidPattern);
    expect(pinnedSourceVersion.sourceVersionId).toMatch(uuidPattern);
    expect(pinnedSourceVersion.revision).toBeGreaterThan(0);
    expect(manifest.files.map((file) => file.sha256)).toEqual(rendered.files.map((file) => file.sha256));
    for (const file of manifest.files) expect(createHash('sha256').update(await bundle.file(`files/${file.id}/${file.fileName}`)!.async('nodebuffer')).digest('hex')).toBe(file.sha256);
    expect((await new Client().request(bundleUrl)).status).toBe(401);
    for (const file of rendered.files) {
      const url = `/api/exports/${job.id}/files/${file.id}?workspaceId=${workspaceId}`, download = await client.request(url); expect(download.status).toBe(200); expect(download.headers.get('cache-control')).toBe('no-store');
      const bytes = new Uint8Array(await download.arrayBuffer());
      if (file.format === 'xlsx') { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]); expect(workbook.getWorksheet('Prices')!.getCell('A2').value).toBe('00123'); expect(workbook.getWorksheet('Prices')!.getCell('C1').formula).toBe('ROUND(A1*B1,2)'); expect(workbook.getWorksheet('Prices')!.getCell('C3').result).toBe('49.98'); }
      else expect(new TextDecoder().decode(bytes)).toContain('00123');
      expect((await new Client().request(url)).status).toBe(401);
    }
  }, 90000);
});
