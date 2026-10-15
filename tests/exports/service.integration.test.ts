import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool, testDocument } from '../artifacts/server/test-fixture';
import { withWorkspaceAccess } from '../../src/features/identity/server/access';
import { createPendingSource, publishSourceVersion } from '../../src/features/sources/server/source-heads';
import { CreateExportSchema } from '../../src/features/exports/contracts';
import { createExportService } from '../../src/features/exports/server/service';
import { ExportRegistry } from '../../src/features/exports/server/registry';
import { LocalExportStorage } from '../../src/features/exports/server/storage';
import type { ExportAdapter } from '../../src/features/exports/server/types';

let pool: Pool; const directories: string[] = [];
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); for (const directory of directories) { if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('tirlik-exports-test-')) throw new Error('INVALID_TEST_CLEANUP_PATH'); await rm(directory, { recursive: true, force: true }); } });
async function fixture(adapter?: ExportAdapter) {
  const f = await artifactFixture(pool), artifact = await f.create(), directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-exports-test-')); directories.push(directory);
  const calls: string[] = [];
  const exports = createExportService({ pool, storage: new LocalExportStorage(directory), registry: new ExportRegistry([adapter ?? { kind: 'document', formats: ['docx', 'pdf'], async render(input) { calls.push(input.format); return { bytes: new TextEncoder().encode(`${input.format}:${input.revision}:${input.title}`), mediaType: 'application/octet-stream', warnings: [] }; } }]), assets: () => ({ async image() { throw new Error('UNEXPECTED_IMAGE'); } }) });
  const input = () => CreateExportSchema.parse({ workspaceId: f.workspaceId, expectedAuthzVersion: 1, locale: 'ru', items: [{ artifactId: artifact.artifact.id, revision: 0, formats: ['docx', 'pdf'] }] });
  return { ...f, artifact, exports, input, calls };
}
describe('immutable private export lifecycle in PostgreSQL', () => {
  it('replays creation and pins old content across a later edit and service reopen', async () => {
    const f = await fixture(), operationId = randomUUID(), job = await f.exports.create(f.owner, operationId, f.input());
    expect((await f.exports.create(f.owner, operationId, f.input())).id).toBe(job.id);
    await expect(f.exports.create(f.owner, operationId, { ...f.input(), locale: 'en' })).rejects.toMatchObject({ messageKey: 'exports.errors.idempotencyConflict' });
    await f.service.rename(f.owner, randomUUID(), f.artifact.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: 0, title: 'Changed after export selection' });
    const ready = await f.exports.render(f.owner, f.workspaceId, job.id, 1);
    expect(ready.status).toBe('ready'); expect(ready.files.every((file) => file.revision === 0)).toBe(true);
    const bytes = await f.exports.download(f.owner, f.workspaceId, job.id, ready.files[0]!.id);
    expect(bytes.bytes.toString()).toContain('Working conditions'); expect(bytes.bytes.toString()).not.toContain('Changed after');
    expect((await f.exports.read(f.owner, f.workspaceId, job.id)).manifestHash).toBe(ready.manifestHash);
    await f.exports.render(f.owner, f.workspaceId, job.id, 1); expect(f.calls).toEqual(['docx', 'pdf']);
    await expect(pool.query("UPDATE export_jobs SET input_manifest=jsonb_set(input_manifest,'{locale}','\"en\"') WHERE id=$1", [job.id])).rejects.toThrow('Export input is immutable');
  });
  it('requires explicit historical consent for a previously saved revision', async () => {
    const f = await fixture(); await f.service.rename(f.owner, randomUUID(), f.artifact.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: 0, title: 'New head' });
    await expect(f.exports.create(f.owner, randomUUID(), f.input())).rejects.toMatchObject({ messageKey: 'exports.errors.historicalConsent' });
    const job = await f.exports.create(f.owner, randomUUID(), { ...f.input(), historicalDraft: true }); expect(job.historicalDraft).toBe(true); expect(job.files[0]!.fileName).toContain('-draft');
  });
  it('retries only failed slots and leaves successful bytes unchanged', async () => {
    let failed = false; const calls: string[] = [];
    const f = await fixture({ kind: 'document', formats: ['docx', 'pdf'], async render(input) { calls.push(input.format); if (input.format === 'pdf' && !failed) { failed = true; throw new Error('SYNTHETIC_FAILURE'); } return { bytes: new TextEncoder().encode(`${input.format}-frozen-${input.revision}`), mediaType: 'application/octet-stream', warnings: [] }; } });
    const job = await f.exports.create(f.owner, randomUUID(), f.input()), first = await f.exports.render(f.owner, f.workspaceId, job.id, 1); expect(first.status).toBe('partial');
    const second = await f.exports.render(f.owner, f.workspaceId, job.id, 1); expect(second.status).toBe('ready'); expect(second.files[0]!.sha256).toBe(first.files[0]!.sha256); expect(calls).toEqual(['docx', 'pdf', 'pdf']);
  });
  it('denies a private file after project access is revoked', async () => {
    const f = await fixture(); await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'export'], expectedAuthzVersion: 1 });
    const job = await f.exports.create(f.member, randomUUID(), { ...f.input(), expectedAuthzVersion: 2 }), ready = await f.exports.render(f.member, f.workspaceId, job.id, 2);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: null, expectedAuthzVersion: 2 });
    await expect(f.exports.download(f.member, f.workspaceId, job.id, ready.files[0]!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.exports.download(f.owner, f.workspaceId, job.id, ready.files[0]!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rechecks a source project independently of the exported artifact, including historical draft requests', async () => {
    const f = await fixture(), sourceProject = await f.projects.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, title: 'Restricted source project', expectedAuthzVersion: 1 }), sourceId = randomUUID(), sourceVersionId = randomUUID();
    await withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, projectId: sourceProject.project.id, scope: 'edit' }, async (tx, access) => { await createPendingSource(tx, access, { sourceId, projectId: sourceProject.project.id, accessClass: 'internal' }); await publishSourceVersion(tx, access, { sourceId, versionId: sourceVersionId, expectedRevision: 0, snapshotHash: 'a'.repeat(64) }); });
    const artifact = await f.service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1, title: 'Derived offer', content: testDocument(), sourceRefs: [{ sourceId, sourceVersionId, revision: 1 }] });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'export'], expectedAuthzVersion: 1 });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: sourceProject.project.id, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 2 });
    const input = CreateExportSchema.parse({ workspaceId: f.workspaceId, expectedAuthzVersion: 3, locale: 'ru', historicalDraft: true, items: [{ artifactId: artifact.artifact.id, revision: 0, formats: ['pdf'] }] }), operationId = randomUUID();
    const job = await f.exports.create(f.member, operationId, input), ready = await f.exports.render(f.member, f.workspaceId, job.id, 3);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: sourceProject.project.id, userId: f.member.userId, scopes: null, expectedAuthzVersion: 3 });
    expect((await f.read(artifact.artifact.id, f.member)).artifact.id).toBe(artifact.artifact.id);
    await expect(f.exports.download(f.member, f.workspaceId, job.id, ready.files[0]!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.exports.read(f.member, f.workspaceId, job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.exports.render(f.member, f.workspaceId, job.id, 4)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.exports.list(f.member, f.workspaceId, artifact.artifact.id)).jobs).toEqual([]);
    await expect(f.exports.create(f.member, operationId, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.exports.create(f.member, randomUUID(), { ...input, expectedAuthzVersion: 4 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('invalidates a cancelled worker before it can publish bytes', async () => {
    let enter!: () => void, release!: () => void; const entered = new Promise<void>((resolve) => { enter = resolve; }), blocked = new Promise<void>((resolve) => { release = resolve; });
    const f = await fixture({ kind: 'document', formats: ['docx', 'pdf'], async render() { enter(); await blocked; return { bytes: new Uint8Array([1, 2, 3]), mediaType: 'application/octet-stream', warnings: [] }; } });
    const job = await f.exports.create(f.owner, randomUUID(), f.input()), rendering = f.exports.render(f.owner, f.workspaceId, job.id, 1); void rendering.catch(() => undefined);
    await entered; await f.exports.cancel(f.owner, f.workspaceId, job.id, 1); release();
    await expect(rendering).rejects.toMatchObject({ messageKey: 'exports.errors.cancelled' });
    const cancelled = await f.exports.read(f.owner, f.workspaceId, job.id); expect(cancelled.status).toBe('cancelled'); expect(cancelled.files.every((file) => file.status === 'pending')).toBe(true);
  });
  it('releases retention pins only when the export is explicitly deleted', async () => {
    const f = await fixture(), job = await f.exports.create(f.owner, randomUUID(), f.input()); await f.exports.render(f.owner, f.workspaceId, job.id, 1);
    expect((await pool.query("SELECT id FROM artifact_version_pins WHERE kind='export' AND retainer_id=$1", [job.id])).rowCount).toBe(1);
    await f.exports.remove(f.owner, f.workspaceId, job.id, 1); expect((await pool.query("SELECT id FROM artifact_version_pins WHERE kind='export' AND retainer_id=$1", [job.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT storage_key FROM export_file_cleanup WHERE job_id=$1', [job.id])).rowCount).toBe(0); await expect(f.exports.read(f.owner, f.workspaceId, job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
