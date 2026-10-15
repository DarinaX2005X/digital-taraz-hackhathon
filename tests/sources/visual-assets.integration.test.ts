import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { createSourceService } from '../../src/features/sources/server/service';
import { createSourceVisualAssetService } from '../../src/features/sources/server/visual-assets';
import { createSourceVisualImportAdapter } from '../../src/features/sources/server/visual-import';
import { LocalSourceStorage, sourceHash } from '../../src/features/sources/server/storage';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); }); afterAll(async () => { await pool?.end(); });
async function fixture() {
  const f = await artifactFixture(pool), storage = new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'visual-source-tests', randomUUID())), sources = createSourceService(pool, storage), assets = createSourceVisualAssetService(pool, storage);
  async function upload(bytes: Buffer, changes = {}) {
    const init = await sources.init(f.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: f.workspaceId, projectId: f.projectId, title: 'Synthetic visual', fileName: 'image.jpg', format: 'jpeg', size: bytes.length, options: { encoding: 'utf-8', purpose: 'visual' }, ...changes }));
    await sources.put(f.owner, f.workspaceId, init.upload.id, init.token!, new Blob([new Uint8Array(bytes)]).stream());
    return (await sources.finalize(f.owner, f.workspaceId, init.upload.id)).upload;
  }
  return { ...f, storage, sources, assets, upload };
}

describe('canonical private visual asset boundary', () => {
  it('reuses direct original identity and bytes, pages after ACL, and blocks unlicensed portable embedding', async () => {
    const f = await fixture(), bytes = await readFile('fixtures/business/services/product-photo.jpg');
    const one = await f.upload(bytes), two = await f.upload(bytes, { accessClass: 'confidential' });
    const asset = await f.assets.resolve(f.owner, { workspaceId: f.workspaceId, assetId: one.id, purpose: 'display' });
    expect(asset).toMatchObject({ id: one.id, sourceId: one.sourceId, sourceVersionId: one.versionId, sha256: sourceHash(bytes), kind: 'image', license: { permission: 'unknown', canEmbed: false } });
    expect(asset.bytes.equals(bytes)).toBe(true);
    await expect(f.assets.resolve(f.owner, { workspaceId: f.workspaceId, assetId: one.id, purpose: 'embed' })).rejects.toMatchObject({ messageKey: 'sources.errors.license' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    const page = await f.assets.list(f.member, { workspaceId: f.workspaceId, projectId: f.projectId, kind: 'image', limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([one.id]); expect(page.nextCursor).toBeNull();
    await expect(f.assets.resolve(f.member, { workspaceId: f.workspaceId, assetId: two.id, purpose: 'display' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [f.owner.sessionId]);
    await expect(f.assets.resolve(f.owner, { workspaceId: f.workspaceId, assetId: one.id, purpose: 'display' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('persists allowed font metadata and a repeated portable import exactly once', async () => {
    const f = await fixture(), bytes = await readFile('public/fonts/noto-sans/NotoSans-Regular.ttf'), operationId = randomUUID();
    const importer = createSourceVisualImportAdapter(pool, f.storage), input = { workspaceId: f.workspaceId, projectId: f.projectId, operationId, name: 'NotoSans-Regular.ttf', format: 'ttf' as const, sha256: sourceHash(bytes), license: { permission: 'confirmed' as const, canEmbed: true, label: 'SIL Open Font License 1.1' }, accessClass: 'internal' as const, bytes };
    const first = await importer.import(f.owner, input), replay = await importer.import(f.owner, input); expect(replay).toEqual(first);
    const font = await f.assets.resolveFont(f.owner, { workspaceId: f.workspaceId, assetId: first.assetId, purpose: 'embed' });
    expect(font.font.family).toMatch(/Noto Sans/); expect(font.font.codePoints).toContain(0x4d8); expect(font.bytes.equals(bytes)).toBe(true);
    const list = await f.assets.list(f.owner, { workspaceId: f.workspaceId, projectId: f.projectId, kind: 'font' });
    expect(list.items).toHaveLength(1); expect(list.items[0]?.font).not.toHaveProperty('codePoints');
    await expect(pool.query("UPDATE source_assets SET license='{}' WHERE id=$1", [first.assetId])).rejects.toMatchObject({ code: '23514' });
    expect((await f.sources.readVersion(f.owner, f.workspaceId, first.sourceId, first.sourceVersionId)).sourceRef.revision).toBe(1);
  });
});
