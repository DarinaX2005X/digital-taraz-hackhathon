import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DependencyEdge } from '../../src/contracts/dependencies';
import { tableCellTargetId } from '../../src/features/artifacts/domain/targets';
import { createDependencyService } from '../../src/features/dependencies/server/service';
import { documentExportAdapter } from '../../src/features/exports/server/documents';
import { ExportRegistry } from '../../src/features/exports/server/registry';
import { createExportService } from '../../src/features/exports/server/service';
import { sheetExportAdapter } from '../../src/features/exports/server/sheets';
import { LocalExportStorage } from '../../src/features/exports/server/storage';
import { createProjectPackageHandlers } from '../../src/features/project-packages/server/handlers';
import { createProjectPackageService } from '../../src/features/project-packages/server/service';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';

let pool: Pool;
const directories: string[] = [];
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => {
  await pool?.end();
  for (const directory of directories) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('tirlik-connected-package-test-')) throw new Error('INVALID_TEST_CLEANUP_PATH');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('connected change review and release package acceptance', () => {
  it('applies one causal group, renders its persisted revisions, reopens the ZIP, and enforces package HTTP boundaries', async () => {
    const fixture = await artifactFixture(pool), dependencies = createDependencyService(pool), authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const cell = (row: string, column: string) => tableCellTargetId('quote', row, column);
    const priceId = cell('service', 'price'), quantityId = cell('service', 'quantity'), totalId = cell('service', 'total');
    const table = await fixture.create({
      kind: 'table', schemaVersion: 1,
      workbook: { id: 'quote-book', name: 'Quote', appVersion: '1', locale: 'ruRU', sheetOrder: ['quote'], sheets: { quote: { id: 'quote', name: 'Quote', rowCount: 1, columnCount: 3, cellData: { 0: { 0: { v: 1500, t: 2 }, 1: { v: 3, t: 2 }, 2: { v: 3000, t: 2, f: '=A1*B1' } } } } } },
      stableIds: { quote: { rows: ['service'], columns: ['price', 'quantity', 'total'] } },
    }, 'Verified quote');
    const document = await fixture.create({
      kind: 'document', schemaVersion: 1,
      document: { type: 'doc', attrs: { id: 'root' }, content: [
        { type: 'paragraph', attrs: { id: 'manual-delivery' }, content: [{ type: 'text', text: 'Срок доставки согласуем отдельно.' }] },
        { type: 'paragraph', attrs: { id: 'amount-line' }, content: [{ type: 'dataField', attrs: { id: 'quote-total', value: '3 000,00 ₸' } }] },
      ] },
    }, 'Client offer');
    const edges: DependencyEdge[] = [
      { id: randomUUID(), inputs: [{ key: 'price', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: priceId } }, { key: 'quantity', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: quantityId } }], target: { artifactId: table.artifact.id, targetElementId: totalId }, transform: { kind: 'decimal', operation: 'product', inputs: ['price', 'quantity'], scale: 2 }, updateMode: 'deterministic', label: 'Quote total' },
      { id: randomUUID(), inputs: [{ key: 'total', ref: { kind: 'artifact', artifactId: table.artifact.id, targetElementId: totalId } }], target: { artifactId: document.artifact.id, targetElementId: 'quote-total' }, transform: { kind: 'money-format', input: 'total', currency: 'KZT', locale: 'ru', scale: 2, basis: 'major' }, updateMode: 'propose', label: 'Offer total' },
    ];
    const scope = { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: authzVersion };
    await dependencies.register(fixture.owner, randomUUID(), { ...scope, edges });
    const proposed = await dependencies.prepare(fixture.owner, randomUUID(), scope), groupId = proposed.proposal.changes[0]!.groupId;
    const accepted = await dependencies.review(fixture.owner, randomUUID(), proposed.id, 'accept', { ...scope, expectedRevision: proposed.revision, groupIds: [groupId] });
    expect(accepted.receipt?.artifacts).toHaveLength(2);
    const persistedTable = await fixture.read(table.artifact.id), persistedDocument = await fixture.read(document.artifact.id);
    expect(persistedTable.artifact.currentRevision).toBe(1); expect(persistedDocument.artifact.currentRevision).toBe(1);
    expect(JSON.stringify(persistedDocument.content)).toContain('Срок доставки согласуем отдельно.');

    const directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-connected-package-test-')); directories.push(directory);
    const exports = createExportService({ pool, storage: new LocalExportStorage(directory), registry: new ExportRegistry([documentExportAdapter, sheetExportAdapter]), assets: () => ({ async image() { throw new Error('UNEXPECTED_IMAGE'); } }) });
    const packages = createProjectPackageService(pool, exports), origin = 'http://127.0.0.1:3000';
    const ownerHandlers = createProjectPackageHandlers({ pool, origin, service: packages, getActor: async () => ({ user: { id: fixture.owner.userId }, session: { id: fixture.owner.sessionId } } as never) });
    const release = { projectId: fixture.projectId, title: 'Approved client package', audience: 'Client procurement team', knownOmissions: ['Wet signature'] };
    const createBody = { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, locale: 'ru', release, items: [
      { artifactId: document.artifact.id, revision: persistedDocument.artifact.currentRevision, formats: ['docx'], options: {} },
      { artifactId: table.artifact.id, revision: persistedTable.artifact.currentRevision, formats: ['xlsx'], options: {} },
    ] };
    const headers = { origin, 'content-type': 'application/json', 'x-tirlik-user-id': fixture.owner.userId, 'idempotency-key': randomUUID() };
    const createdResponse = await ownerHandlers(new Request(`${origin}/api/packages`, { method: 'POST', headers, body: JSON.stringify(createBody) }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; authzVersion: number; release: typeof release };
    expect(created.release).toEqual(release);
    const ready = await exports.render(fixture.owner, fixture.workspaceId, created.id, created.authzVersion);
    expect(ready.status).toBe('ready'); expect(ready.revisions).toEqual([{ artifactId: document.artifact.id, revision: 1 }, { artifactId: table.artifact.id, revision: 1 }]);

    const reopened = await packages.list(fixture.owner, { workspaceId: fixture.workspaceId, projectId: fixture.projectId });
    expect(reopened.packages[0]).toMatchObject({ id: created.id, status: 'ready', release, revisions: ready.revisions });
    const downloaded = await exports.downloadBundle(fixture.owner, fixture.workspaceId, created.id), bundle = await JSZip.loadAsync(downloaded.bytes);
    const manifest = JSON.parse(await bundle.file('manifest.json')!.async('string')) as { release: typeof release; revisions: { artifactId: string; revision: number }[]; files: { id: string; format: string; fileName: string }[] };
    expect(manifest.release).toEqual(release); expect(manifest.revisions).toEqual(ready.revisions.map((item) => expect.objectContaining(item)));
    const docxFile = manifest.files.find((file) => file.format === 'docx')!, xlsxFile = manifest.files.find((file) => file.format === 'xlsx')!;
    const docx = await JSZip.loadAsync(await bundle.file(`files/${docxFile.id}/${docxFile.fileName}`)!.async('uint8array'));
    expect(await docx.file('word/document.xml')!.async('string')).toContain('Срок доставки согласуем отдельно.');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await bundle.file(`files/${xlsxFile.id}/${xlsxFile.fileName}`)!.async('uint8array')) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets[0]!.getCell('C1').value).toEqual(expect.objectContaining({ formula: 'A1*B1', result: 4500 }));

    const listed = await ownerHandlers(new Request(`${origin}/api/packages?workspaceId=${fixture.workspaceId}&projectId=${fixture.projectId}`, { headers: { 'x-tirlik-user-id': fixture.owner.userId } }));
    expect(listed.status).toBe(200); expect(await listed.json()).toMatchObject({ packages: [{ id: created.id, release }] });
    const badOrigin = await ownerHandlers(new Request(`${origin}/api/packages`, { method: 'POST', headers: { ...headers, origin: 'https://other.invalid', 'idempotency-key': randomUUID() }, body: JSON.stringify(createBody) }));
    expect(badOrigin.status).toBe(403);
    const actorMismatch = await ownerHandlers(new Request(`${origin}/api/packages?workspaceId=${fixture.workspaceId}&projectId=${fixture.projectId}`, { headers: { 'x-tirlik-user-id': randomUUID() } }));
    expect(actorMismatch.status).toBe(409);
    const extraQuery = await ownerHandlers(new Request(`${origin}/api/packages?workspaceId=${fixture.workspaceId}&projectId=${fixture.projectId}&debug=1`, { headers: { 'x-tirlik-user-id': fixture.owner.userId } }));
    expect(extraQuery.status).toBe(422);
    const memberHandlers = createProjectPackageHandlers({ pool, origin, service: packages, getActor: async () => ({ user: { id: fixture.member.userId }, session: { id: fixture.member.sessionId } } as never) });
    const denied = await memberHandlers(new Request(`${origin}/api/packages?workspaceId=${fixture.workspaceId}&projectId=${fixture.projectId}`, { headers: { 'x-tirlik-user-id': fixture.member.userId } }));
    expect(denied.status).toBe(404);
  });
});
