import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { createSourceService } from '../../src/features/sources/server/service';
import { LocalSourceStorage, sourceHash } from '../../src/features/sources/server/storage';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
async function fixture() {
  const f = await artifactFixture(pool);
  const storageRoot = path.join(process.env.TIRLIK_DATA_DIR!, 'source-tests', randomUUID());
  const storage = new LocalSourceStorage(storageRoot);
  const service = createSourceService(pool, storage);
  const body = (bytes: Buffer, changes = {}) => InitSourceUploadSchema.parse({ workspaceId: f.workspaceId, projectId: f.projectId, title: 'Synthetic source', fileName: 'source.csv', format: 'csv', size: bytes.length, ...changes });
  async function upload(bytes: Buffer, changes = {}) {
    const initialized = await service.init(f.owner, randomUUID(), body(bytes, changes));
    await service.put(f.owner, f.workspaceId, initialized.upload.id, initialized.token!, new Blob([new Uint8Array(bytes)]).stream());
    return initialized;
  }
  return { ...f, service, storage, storageRoot, body, upload };
}

describe('source ingestion persistence and access', () => {
  it('saves immutable original, canonical manifest and every row; replays finalize without a second version', async () => {
    const f = await fixture(), bytes = Buffer.from('SKU,amount\n001,12.50\n001,\n');
    const initialized = await f.upload(bytes);
    const ready = await f.service.finalize(f.owner, f.workspaceId, initialized.upload.id);
    expect(ready.upload.status).toBe('ready'); expect(ready.upload.byteHash).toBe(sourceHash(bytes));
    const again = await f.service.finalize(f.owner, f.workspaceId, initialized.upload.id); expect(again).toEqual(ready);
    const detail = await f.service.read(f.owner, f.workspaceId, initialized.upload.sourceId);
    expect(detail.source.revision).toBe(1);
    const preview = await f.service.preview(f.owner, f.workspaceId, detail.source.id, initialized.upload.id);
    expect(preview.chunk.fragments.map((item) => item.values)).toEqual([['SKU', 'amount'], ['001', '12.50'], ['001', '']]);
    const original = await f.service.download(f.owner, f.workspaceId, detail.source.id, initialized.upload.id);
    expect(original.bytes.equals(bytes)).toBe(true);
    expect((await pool.query('SELECT snapshot_hash FROM source_versions WHERE id=$1', [ready.upload.versionId])).rows[0].snapshot_hash).not.toBe(sourceHash(bytes));
    expect((await pool.query('SELECT id FROM source_versions WHERE source_id=$1', [detail.source.id])).rowCount).toBe(1);
    await expect(f.service.put(f.owner, f.workspaceId, initialized.upload.id, initialized.token!, new Blob([new Uint8Array(bytes)]).stream())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('serializes init retries and rejects changed payload with the same key', async () => {
    const f = await fixture(), key = randomUUID(), body = f.body(Buffer.from('hello'), { format: 'text', fileName: 'text.txt' });
    const [one, two] = await Promise.all([f.service.init(f.owner, key, body), f.service.init(f.owner, key, body)]);
    expect(one.upload.id).toBe(two.upload.id); expect(one.upload.sourceId).toBe(two.upload.sourceId);
    expect((await pool.query('SELECT id FROM sources WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(1);
    await expect(f.service.init(f.owner, key, { ...body, title: 'Changed' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.service.put(f.owner, f.workspaceId, one.upload.id, 'wrong-token', new Blob(['hello']).stream())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps the previous ready head after a new parse fails and cancels pending work without publishing', async () => {
    const f = await fixture(), old = await f.upload(Buffer.from('a,b\n001,2'));
    await f.service.finalize(f.owner, f.workspaceId, old.upload.id);
    const next = await f.upload(Buffer.from('a,b\n"unclosed'), { sourceId: old.upload.sourceId, expectedRevision: 1 });
    await expect(f.service.finalize(f.owner, f.workspaceId, next.upload.id)).rejects.toMatchObject({ messageKey: 'sources.errors.csv' });
    const detail = await f.service.read(f.owner, f.workspaceId, old.upload.sourceId);
    expect(detail.source.revision).toBe(1); expect(detail.uploads[0]!.status).toBe('failed');
    expect((await f.service.preview(f.owner, f.workspaceId, old.upload.sourceId, old.upload.id)).chunk.fragments).toHaveLength(2);
    await f.service.cancel(f.owner, f.workspaceId, next.upload.id);
    await expect(f.service.finalize(f.owner, f.workspaceId, next.upload.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('denies foreign, missing-grant and confidential reads, previews and originals', async () => {
    const f = await fixture(), other = await fixture(), item = await f.upload(Buffer.from('private'), { format: 'text', fileName: 'private.txt', accessClass: 'confidential' });
    await f.service.finalize(f.owner, f.workspaceId, item.upload.id);
    await expect(f.service.read(other.owner, f.workspaceId, item.upload.sourceId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.service.preview(f.member, f.workspaceId, item.upload.sourceId, item.upload.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 1 });
    expect((await f.service.list(f.member, f.workspaceId, f.projectId)).sources).toEqual([]);
    await expect(f.service.download(f.member, f.workspaceId, item.upload.sourceId, item.upload.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rechecks session and project state before publication', async () => {
    const f = await fixture(), item = await f.upload(Buffer.from('safe'), { format: 'text', fileName: 'safe.txt' });
    await pool.query("UPDATE projects SET status='archived' WHERE id=$1", [f.projectId]);
    await expect(f.service.finalize(f.owner, f.workspaceId, item.upload.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await pool.query("UPDATE projects SET status='active' WHERE id=$1", [f.projectId]);
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [f.owner.sessionId]);
    await expect(f.service.finalize(f.owner, f.workspaceId, item.upload.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await pool.query('SELECT current_revision FROM sources WHERE id=$1', [item.upload.sourceId])).rows[0].current_revision).toBe(0);
  });
  it('keeps image recognition partial and original downloadable without publishing a source head', async () => {
    const f = await fixture(), bytes = await readFile('fixtures/business/services/product-photo.jpg');
    const item = await f.upload(bytes, { format: 'jpeg', fileName: 'photo.jpg' });
    const result = await f.service.finalize(f.owner, f.workspaceId, item.upload.id);
    expect(result.upload.status).toBe('partial'); expect(result.upload.versionId).toBeNull();
    expect((await f.service.read(f.owner, f.workspaceId, item.upload.sourceId)).source.revision).toBe(0);
    expect((await f.service.download(f.owner, f.workspaceId, item.upload.sourceId, item.upload.id)).bytes.equals(bytes)).toBe(true);
    expect((await pool.query('SELECT page,state FROM source_pages WHERE upload_id=$1', [item.upload.id])).rows).toEqual([{ page: 1, state: 'pending' }]);
  });
  it('rejects stored-original hash corruption on read and finalize without replacing the previous head', async () => {
    const f = await fixture(), bytes = Buffer.from('sku,total\n001,100');
    const old = await f.upload(bytes);
    const first = await f.service.finalize(f.owner, f.workspaceId, old.upload.id);
    const next = await f.upload(bytes, { sourceId: old.upload.sourceId, expectedRevision: 1 });
    const corrupted = Buffer.from('sku,total\n999,999');
    expect(corrupted.length).toBe(bytes.length);
    await writeFile(path.join(f.storageRoot, f.workspaceId, next.upload.id, 'original'), corrupted);
    await expect(f.service.download(f.owner, f.workspaceId, old.upload.sourceId, next.upload.id)).rejects.toMatchObject({ messageKey: 'sources.errors.integrity' });
    await expect(f.service.finalize(f.owner, f.workspaceId, next.upload.id)).rejects.toMatchObject({ messageKey: 'sources.errors.integrity' });
    const detail = await f.service.read(f.owner, f.workspaceId, old.upload.sourceId);
    expect(detail.source.revision).toBe(1);
    expect(detail.uploads.find((item) => item.id === next.upload.id)?.status).toBe('failed');
    expect((await pool.query('SELECT id FROM source_versions WHERE source_id=$1', [old.upload.sourceId])).rows).toEqual([{ id: first.upload.versionId }]);
    expect((await f.service.download(f.owner, f.workspaceId, old.upload.sourceId, old.upload.id)).bytes.equals(bytes)).toBe(true);
    await writeFile(path.join(f.storageRoot, f.workspaceId, old.upload.id, 'original'), corrupted);
    await expect(f.service.download(f.owner, f.workspaceId, old.upload.sourceId, old.upload.id)).rejects.toMatchObject({ messageKey: 'sources.errors.integrity' });
  });
});
