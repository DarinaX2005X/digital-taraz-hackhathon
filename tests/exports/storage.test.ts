import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalExportStorage } from '../../src/features/exports/server/storage';
function r2Storage() {
  const objects = new Map<string, Uint8Array>();
  const requests: Array<{ method: string; url: string; contentType: string | null; ifNoneMatch: string | null; authorization: string | null }> = [];
  let failAfterWrite = true;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url);
    requests.push({
      method: request.method,
      url: request.url,
      contentType: request.headers.get('content-type'),
      ifNoneMatch: request.headers.get('if-none-match'),
      authorization: request.headers.get('authorization'),
    });
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    if (request.method === 'PUT') {
      if (objects.has(key)) return new Response(null, { status: 412 });
      objects.set(key, new Uint8Array(await request.arrayBuffer()));
      if (failAfterWrite) { failAfterWrite = false; throw new TypeError('Synthetic uncertain transport'); }
      return new Response(null, { status: 200, headers: { ETag: '"synthetic"' } });
    }
    const bytes = objects.get(key);
    if (request.method === 'HEAD') return bytes ? new Response(null, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } }) : new Response(null, { status: 404 });
    if (request.method === 'GET') return bytes ? new Response(bytes.slice().buffer as ArrayBuffer, { status: 200 }) : new Response(null, { status: 404 });
    if (request.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  });
  return { storage: new LocalExportStorage({ driver: 'r2', accountId: 'b'.repeat(32), bucketName: 'tirlik-test', accessKeyId: 'test-access', secretAccessKey: 'test-secret', fetcher }), objects, requests };
}
describe('private immutable export bytes', () => {
  it('verifies hash and size and rejects traversal or overwritten bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tirlik-export-'));
    try {
      const storage = new LocalExportStorage(root), bytes = new TextEncoder().encode('private version 4'), receipt = await storage.write(randomUUID(), randomUUID(), bytes);
      expect(await storage.read(receipt.key, receipt)).toEqual(Buffer.from(bytes));
      await expect(storage.read('../../private', receipt)).rejects.toThrow();
      await writeFile(path.join(root, ...receipt.key.split('/')), 'private version 5');
      await expect(storage.read(receipt.key, receipt)).rejects.toMatchObject({ messageKey: 'exports.errors.storage' });
      await storage.remove(receipt.key); await storage.remove(receipt.key);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('reconciles an uncertain immutable R2 write and verifies every read', async () => {
    const { storage, objects, requests } = r2Storage(), bytes = new TextEncoder().encode('private r2 export');
    const receipt = await storage.write(randomUUID(), randomUUID(), bytes);
    const puts = requests.filter((request) => request.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ contentType: 'application/octet-stream', ifNoneMatch: '*', authorization: null });
    const target = new URL(puts[0]!.url);
    expect(target.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(target.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host;if-none-match');
    expect(receipt).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), byteSize: bytes.byteLength });
    expect(await storage.read(receipt.key, receipt)).toEqual(Buffer.from(bytes));
    const stored = objects.get(receipt.key)!; stored[0] = stored[0]! ^ 1;
    await expect(storage.read(receipt.key, receipt)).rejects.toMatchObject({ messageKey: 'exports.errors.storage' });
    await storage.remove(receipt.key); await storage.remove(receipt.key);
    expect(objects.size).toBe(0);
  });
});
