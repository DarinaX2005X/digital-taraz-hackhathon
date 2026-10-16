import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import PDFDocument from 'pdfkit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

async function syntheticLargePdf() {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ autoFirstPage: false, compress: false }), chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk)); document.on('error', reject); document.on('end', () => resolve(Buffer.concat(chunks)));
    for (let page = 1; page <= 30; page += 1) {
      document.addPage({ size: 'A4', margin: 48 });
      document.fontSize(12).text(`Synthetic recovery page ${page}. This file contains generated test data only.`);
    }
    document.addContent(`\n%${'x'.repeat(6_350_000)}\n`);
    document.end();
  });
}

function r2Storage() {
  const objects = new Map<string, Uint8Array>();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    if (request.method === 'PUT') {
      if (objects.has(key)) return new Response(null, { status: 412 });
      objects.set(key, new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { status: 200, headers: { ETag: '"synthetic"' } });
    }
    const bytes = objects.get(key);
    if (request.method === 'HEAD') return bytes ? new Response(null, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } }) : new Response(null, { status: 404 });
    if (request.method === 'GET') return bytes ? new Response(bytes.slice().buffer as ArrayBuffer, { status: 200 }) : new Response(null, { status: 404 });
    if (request.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  });
  return { storage: new LocalSourceStorage({ driver: 'r2', accountId: 'c'.repeat(32), bucketName: 'tirlik-test', accessKeyId: 'test-access', secretAccessKey: 'test-secret', fetcher }), fetcher };
}

describe('source ingestion persistence and access', () => {
  it('commits a direct private R2 upload only after ACL, size, hash and format verification', async () => {
    const base = await artifactFixture(pool), other = await artifactFixture(pool), r2 = r2Storage(), service = createSourceService(pool, r2.storage);
    const bytes = Buffer.from('sku,price\n001,10'), operationId = randomUUID();
    const input = InitSourceUploadSchema.parse({ workspaceId: base.workspaceId, projectId: base.projectId, title: 'R2 source', fileName: 'r2.csv', format: 'csv', size: bytes.length });
    const initialized = await service.init(base.owner, operationId, input);
    const token = initialized.token!;
    expect(token.startsWith('r2.v1.')).toBe(true);
    const { url } = JSON.parse(Buffer.from(token.slice('r2.v1.'.length), 'base64url').toString()) as { url: string };
    expect((await r2.fetcher(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: bytes })).status).toBe(200);
    await expect(service.put(other.owner, base.workspaceId, initialized.upload.id, token, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const committed = await service.put(base.owner, base.workspaceId, initialized.upload.id, token, null);
    expect(committed.upload).toMatchObject({ id: initialized.upload.id, status: 'uploaded', byteHash: sourceHash(bytes), byteSize: bytes.length });
    const replay = await service.init(base.owner, operationId, input);
    expect(replay).toMatchObject({ upload: { id: initialized.upload.id, status: 'uploaded' }, token: null });
    expect((await service.finalize(base.owner, base.workspaceId, initialized.upload.id)).upload.status).toBe('ready');
  });
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
  it('reprocesses a failed stored 6-7 MB PDF without another upload or source identity', async () => {
    const f = await fixture(), bytes = await syntheticLargePdf();
    expect(bytes.length).toBeGreaterThanOrEqual(6 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(7 * 1024 * 1024);
    const initialized = await f.upload(bytes, { format: 'pdf', fileName: 'synthetic-large.pdf' });
    await pool.query("UPDATE source_uploads SET status='failed',error_code='sources.errors.pdf' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, initialized.upload.id]);
    const ready = await f.service.finalize(f.owner, f.workspaceId, initialized.upload.id);
    expect(ready.upload).toMatchObject({ id: initialized.upload.id, sourceId: initialized.upload.sourceId, status: 'ready', byteHash: sourceHash(bytes), manifest: { pageCount: 30, complete: true } });
    expect((await pool.query('SELECT id FROM source_versions WHERE source_id=$1', [initialized.upload.sourceId])).rowCount).toBe(1);
  }, 60_000);
  it('materializes 100000 CSV rows in bounded persisted chunks without truncation', async () => {
    const f = await fixture(), rows = Array.from({ length: 99_999 }, (_, index) => `${String(index + 1).padStart(6, '0')},${index + 1}`);
    const bytes = Buffer.from(`SKU,price\n${rows.join('\n')}\n`), initialized = await f.upload(bytes);
    const ready = await f.service.finalize(f.owner, f.workspaceId, initialized.upload.id);
    expect(ready.upload).toMatchObject({ status: 'ready', manifest: { rowCount: 100_000, fragmentCount: 100_000, complete: true } });
    expect(ready.upload.manifest!.chunkHashes).toHaveLength(400);
    expect((await pool.query('SELECT count(*)::integer AS count FROM source_chunks WHERE upload_id=$1', [initialized.upload.id])).rows[0]).toEqual({ count: 400 });
    const first = await f.service.preview(f.owner, f.workspaceId, initialized.upload.sourceId, initialized.upload.id, 0);
    const last = await f.service.preview(f.owner, f.workspaceId, initialized.upload.sourceId, initialized.upload.id, 399);
    expect(first.chunk.fragments[0]).toMatchObject({ id: 'row:1', row: 1, values: ['SKU', 'price'] });
    expect(last.chunk.fragments.at(-1)).toMatchObject({ id: 'row:100000', row: 100000, values: ['099999', '99999'] });
    expect(await f.service.finalize(f.owner, f.workspaceId, initialized.upload.id)).toEqual(ready);
  }, 120_000);
  it('serializes init retries and rejects changed payload with the same key', async () => {
    const f = await fixture(), key = randomUUID(), body = f.body(Buffer.from('hello'), { format: 'text', fileName: 'text.txt' });
    const [one, two] = await Promise.all([f.service.init(f.owner, key, body), f.service.init(f.owner, key, body)]);
    expect(one.upload.id).toBe(two.upload.id); expect(one.upload.sourceId).toBe(two.upload.sourceId);
    expect((await pool.query('SELECT id FROM sources WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(1);
    await expect(f.service.init(f.owner, key, { ...body, title: 'Changed' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.service.put(f.owner, f.workspaceId, one.upload.id, 'wrong-token', new Blob(['hello']).stream())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('cleans an unpublished invalid original and retries the same upload identity with corrected bytes', async () => {
    const f = await fixture(), key = randomUUID(), invalid = Buffer.from([0, 1, 2, 3]), corrected = Buffer.from('safe');
    const body = f.body(invalid, { format: 'text', fileName: 'notes.txt' });
    const first = await f.service.init(f.owner, key, body);
    await expect(f.service.put(f.owner, f.workspaceId, first.upload.id, first.token!, new Blob([invalid]).stream())).rejects.toMatchObject({ messageKey: 'sources.errors.format' });
    await expect(f.storage.read(`${f.workspaceId}/${first.upload.id}/original`)).rejects.toMatchObject({ code: 'ENOENT' });
    const retry = await f.service.init(f.owner, key, body);
    expect(retry.upload.id).toBe(first.upload.id); expect(retry.token).not.toBeNull();
    await f.service.put(f.owner, f.workspaceId, retry.upload.id, retry.token!, new Blob([corrected]).stream());
    const ready = await f.service.finalize(f.owner, f.workspaceId, retry.upload.id);
    expect(ready.upload.status).toBe('ready');
    expect((await f.service.download(f.owner, f.workspaceId, retry.upload.sourceId, retry.upload.id)).bytes.equals(corrected)).toBe(true);
    expect((await pool.query('SELECT id FROM sources WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(1);
  });
  it('keeps the previous ready head after a new parse fails and cancels pending work without publishing', async () => {
    const f = await fixture(), old = await f.upload(Buffer.from('a,b\n001,2'));
    await f.service.finalize(f.owner, f.workspaceId, old.upload.id);
    const parsedBeforeFailure = Array.from({ length: 1100 }, (_, index) => `${index},${index + 1}`).join('\n');
    const next = await f.upload(Buffer.from(`a,b\n${parsedBeforeFailure}\n"unclosed`), { sourceId: old.upload.sourceId, expectedRevision: 1 });
    await expect(f.service.finalize(f.owner, f.workspaceId, next.upload.id)).rejects.toMatchObject({ messageKey: 'sources.errors.csv' });
    expect((await pool.query('SELECT count(*)::integer AS count FROM source_chunks WHERE upload_id=$1', [next.upload.id])).rows[0]).toEqual({ count: 0 });
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
    const internal = await f.upload(Buffer.from('shared'), { format: 'text', fileName: 'shared.txt' });
    await f.service.finalize(f.owner, f.workspaceId, internal.upload.id);
    expect((await f.service.read(f.member, f.workspaceId, internal.upload.sourceId)).source.id).toBe(internal.upload.sourceId);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: null, expectedAuthzVersion: 2 });
    await expect(f.service.read(f.member, f.workspaceId, internal.upload.sourceId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.service.download(f.member, f.workspaceId, internal.upload.sourceId, internal.upload.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
