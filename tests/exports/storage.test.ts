import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalExportStorage } from '../../src/features/exports/server/storage';
function r2Storage() {
  const objects = new Map<string, Uint8Array>();
  let failAfterWrite = true;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url);
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
  return { storage: new LocalExportStorage({ driver: 'r2', accountId: 'b'.repeat(32), bucketName: 'tirlik-test', accessKeyId: 'test-access', secretAccessKey: 'test-secret', fetcher }), objects };
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
    const { storage, objects } = r2Storage(), bytes = new TextEncoder().encode('private r2 export');
    const receipt = await storage.write(randomUUID(), randomUUID(), bytes);
    expect(receipt).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), byteSize: bytes.byteLength });
    expect(await storage.read(receipt.key, receipt)).toEqual(Buffer.from(bytes));
    const stored = objects.get(receipt.key)!; stored[0] = stored[0]! ^ 1;
    await expect(storage.read(receipt.key, receipt)).rejects.toMatchObject({ messageKey: 'exports.errors.storage' });
    await storage.remove(receipt.key); await storage.remove(receipt.key);
    expect(objects.size).toBe(0);
  });
});
