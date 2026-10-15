import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { withWorkspaceAccess } from '../../src/features/identity/server/access';
import { createSourceService } from '../../src/features/sources/server/service';
import { createSourceDocumentAdapter } from '../../src/features/sources/server/document-input';
import { createSourceOriginalAdapter } from '../../src/features/sources/server/original-input';
import { readPinnedSource, readPinnedSourceChunk } from '../../src/features/sources/server/pinned-source';
import { LocalSourceStorage } from '../../src/features/sources/server/storage';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
async function fixture() {
  const f = await artifactFixture(pool);
  const storage = new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'source-adapter-tests', randomUUID()));
  const service = createSourceService(pool, storage), documents = createSourceDocumentAdapter(pool, storage);
  async function upload(bytes: Buffer, changes = {}) {
    const item = await service.init(f.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: f.workspaceId, projectId: f.projectId, title: 'Synthetic adapter source', fileName: 'source.csv', format: 'csv', size: bytes.length, ...changes }));
    await service.put(f.owner, f.workspaceId, item.upload.id, item.token!, new Blob([new Uint8Array(bytes)]).stream());
    return (await service.finalize(f.owner, f.workspaceId, item.upload.id)).upload;
  }
  return { ...f, storage, service, documents, upload };
}

describe('canonical source consumers', () => {
  it('returns the selected original after replacement and refuses foreign readers or unpublished versions', async () => {
    const f = await fixture(), bytes = Buffer.from('sku,price\n001,1250');
    const first = await f.upload(bytes);
    const adapter = createSourceOriginalAdapter(pool, f.storage);
    const input = { workspaceId: f.workspaceId, sourceId: first.sourceId, sourceVersionId: first.versionId! };
    await f.upload(Buffer.from('sku,price\n001,1400'), { sourceId: first.sourceId, expectedRevision: 1 });
    const original = await adapter.readPublishedOriginal(f.owner, input);
    expect(original.bytes.equals(bytes)).toBe(true);
    expect(original.sourceRef).toEqual({ sourceId: first.sourceId, sourceVersionId: first.versionId, revision: 1 });
    expect(original).toMatchObject({ projectId: f.projectId, accessClass: 'internal', format: 'csv', options: { encoding: 'utf-8' } });
    await expect(adapter.readPublishedOriginal(f.member, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.readPublishedOriginal(f.owner, { ...input, sourceVersionId: randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('pins an old exact version after a new head and fails missing, corrupt or out-of-range chunks', async () => {
    const f = await fixture(), old = await f.upload(Buffer.from('sku,total\n001,10'));
    const input = { sourceId: old.sourceId, sourceVersionId: old.versionId! };
    const read = () => withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, scope: 'read' }, (tx, access) => readPinnedSource(tx, access, input));
    const chunk = (ordinal: number) => withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, scope: 'read' }, (tx, access) => readPinnedSourceChunk(tx, access, { ...input, ordinal }));
    await f.upload(Buffer.from('sku,total\n002,20'), { sourceId: old.sourceId, expectedRevision: 1 });
    expect((await read()).sourceRef).toEqual({ ...input, revision: 1 });
    expect((await chunk(0)).fragments[1]!.values).toEqual(['001', '10']);
    await expect(chunk(1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query("UPDATE source_chunks SET content=jsonb_set(content,'{fragments,1,values,0}','\"999\"') WHERE upload_id=$1", [old.id]);
    await expect(chunk(0)).rejects.toMatchObject({ messageKey: 'sources.errors.integrity' });
    await pool.query('DELETE FROM source_chunks WHERE upload_id=$1', [old.id]);
    await expect(chunk(0)).rejects.toMatchObject({ messageKey: 'sources.errors.integrity' });
  });
  it('rejects a manifest that no longer matches its canonical version hash and foreign ACL', async () => {
    const f = await fixture(), item = await f.upload(Buffer.from('safe'), { format: 'text', fileName: 'source.txt' });
    const input = { sourceId: item.sourceId, sourceVersionId: item.versionId! };
    await expect(withWorkspaceAccess(pool, f.member, { workspaceId: f.workspaceId, scope: 'read' }, (tx, access) => readPinnedSource(tx, access, input))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query("UPDATE source_uploads SET manifest=jsonb_set(manifest,'{fragmentCount}','999') WHERE id=$1", [item.id]);
    await expect(withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, scope: 'read' }, (tx, access) => readPinnedSource(tx, access, input))).rejects.toMatchObject({ messageKey: 'sources.errors.integrity' });
  });
  it('paginates the library after ACL filtering, preserves timestamp ties and binds cursors to literal filters', async () => {
    const f = await fixture();
    await f.upload(Buffer.from('a'), { title: '100% exact', format: 'text', fileName: 'literal.txt' });
    await f.upload(Buffer.from('b'), { title: '100x other', format: 'text', fileName: 'other.txt' });
    await f.upload(Buffer.from('c'), { title: 'Private', format: 'text', fileName: 'private.txt', accessClass: 'confidential' });
    await pool.query("UPDATE sources SET updated_at='2026-10-14T10:00:00.123456Z' WHERE workspace_id=$1", [f.workspaceId]);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    const one = await f.service.listLibrary(f.member, { workspaceId: f.workspaceId, limit: 1 });
    expect(one.sources).toHaveLength(1); expect(one.nextCursor).toBeTruthy();
    const two = await f.service.listLibrary(f.member, { workspaceId: f.workspaceId, limit: 1, after: one.nextCursor! });
    expect(two.sources).toHaveLength(1); expect(two.nextCursor).toBeNull();
    expect(two.sources[0]!.id).not.toBe(one.sources[0]!.id);
    expect([...one.sources, ...two.sources].some((source) => source.accessClass === 'confidential')).toBe(false);
    const literal = await f.service.listLibrary(f.owner, { workspaceId: f.workspaceId, query: '100%', from: '2026-10-14', to: '2026-10-14' });
    expect(literal.sources.map((source) => source.title)).toEqual(['100% exact']);
    await expect(f.service.listLibrary(f.member, { workspaceId: f.workspaceId, after: one.nextCursor!, query: 'changed' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(f.service.listLibrary(f.owner, { workspaceId: f.workspaceId, from: '2026-02-30' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('reuses immutable embedded image bytes and resolves both derived and direct images with current ACL', async () => {
    const f = await fixture(), bytes = await readFile('fixtures/business/services/request.docx');
    const item = await f.upload(bytes, { format: 'docx', fileName: 'request.docx' });
    const input = { workspaceId: f.workspaceId, sourceId: item.sourceId, uploadId: item.id };
    expect((await f.documents.read(f.owner, input)).bytes.equals(bytes)).toBe(true);
    const image = await readFile('fixtures/business/services/product-photo.jpg');
    const saved = await f.documents.persistImage(f.owner, { ...input, producerKey: 'word/media/image1.jpeg', bytes: image });
    expect(await f.documents.persistImage(f.owner, { ...input, producerKey: 'word/media/image1.jpeg', bytes: image })).toEqual(saved);
    expect((await f.documents.resolveImage(f.owner, { workspaceId: f.workspaceId, assetId: saved.id })).bytes.equals(image)).toBe(true);
    const direct = await f.upload(image, { format: 'jpeg', fileName: 'photo.jpg' });
    expect((await f.documents.resolveImage(f.owner, { workspaceId: f.workspaceId, assetId: direct.id })).bytes.equals(image)).toBe(true);
    await expect(f.documents.resolveImage(f.member, { workspaceId: f.workspaceId, assetId: saved.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [f.owner.sessionId]);
    await expect(f.documents.resolveImage(f.owner, { workspaceId: f.workspaceId, assetId: saved.id })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
