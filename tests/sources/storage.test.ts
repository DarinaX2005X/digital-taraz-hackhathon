import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalSourceStorage, sourceHash } from '../../src/features/sources/server/storage';
import { selectStorage } from '../../src/server/storage/r2';

const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const stream = (value: string) => new Blob([value]).stream();
function r2Fixture() {
  const objects = new Map<string, Uint8Array>();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    if (request.method === 'PUT') {
      if (request.headers.get('if-none-match') === '*' && objects.has(key)) return new Response(null, { status: 412 });
      const bytes = new Uint8Array(await request.arrayBuffer()); objects.set(key, bytes);
      return new Response(null, { status: 200, headers: { ETag: '"synthetic"', 'Access-Control-Expose-Headers': 'ETag' } });
    }
    const bytes = objects.get(key);
    if (request.method === 'HEAD') return bytes ? new Response(null, { status: 200, headers: { 'Content-Length': String(bytes.byteLength), ETag: '"synthetic"' } }) : new Response(null, { status: 404 });
    if (request.method === 'GET') return bytes ? new Response(bytes.slice().buffer as ArrayBuffer, { status: 200 }) : new Response(null, { status: 404 });
    if (request.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  });
  const storage = new LocalSourceStorage({ driver: 'r2', accountId: 'a'.repeat(32), bucketName: 'tirlik-test', accessKeyId: 'test-access', secretAccessKey: 'test-secret', fetcher });
  return { storage, fetcher, objects };
}
describe('private immutable source bytes', () => {
  it('keeps explicit self-hosting local but fails closed on Vercel or partial R2 configuration', () => {
    vi.stubEnv('TIRLIK_STORAGE_DRIVER', 'local'); vi.stubEnv('VERCEL', ''); vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32)); vi.stubEnv('R2_BUCKET_NAME', 'tirlik-test'); vi.stubEnv('R2_ACCESS_KEY_ID', 'key'); vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
    expect(selectStorage('/persistent')).toEqual({ driver: 'local', root: '/persistent' });
    vi.stubEnv('R2_SECRET_ACCESS_KEY', '');
    expect(() => selectStorage('/persistent')).toThrow('R2_STORAGE_CONFIGURATION');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret'); vi.stubEnv('VERCEL', '1');
    expect(() => selectStorage('/ephemeral')).toThrow('R2_STORAGE_CONFIGURATION');
    vi.stubEnv('TIRLIK_STORAGE_DRIVER', 'r2');
    expect(selectStorage('/ephemeral')).toMatchObject({ driver: 'r2', bucketName: 'tirlik-test' });
  });
  it('reconciles identical retry and refuses to replace finalized bytes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-source-test-')); directories.push(directory);
    const storage = new LocalSourceStorage(directory), workspace = randomUUID(), upload = randomUUID();
    const original = await storage.write(workspace, upload, stream('one'), 3);
    expect((await storage.read(original.key)).toString()).toBe('one'); expect(original.hash).toBe(sourceHash('one'));
    expect(await storage.write(workspace, upload, stream('one'), 3)).toEqual(original);
    await expect(storage.write(workspace, upload, stream('two'), 3)).rejects.toMatchObject({ messageKey: 'sources.errors.immutable' });
    expect((await storage.read(original.key)).toString()).toBe('one');
  });
  it('rejects undersized, oversized and path-based writes before they become originals', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-source-test-')); directories.push(directory);
    const storage = new LocalSourceStorage(directory), workspace = randomUUID();
    await expect(storage.write(workspace, randomUUID(), stream('small'), 10)).rejects.toMatchObject({ messageKey: 'sources.errors.sizeMismatch' });
    await expect(storage.write(workspace, randomUUID(), stream('too long'), 2)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(storage.read(`${workspace}/../../secret`)).rejects.toThrow();
  });
  it('removes partial bytes after an interrupted upload stream and permits a clean retry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-source-test-')); directories.push(directory);
    const storage = new LocalSourceStorage(directory), workspace = randomUUID(), upload = randomUUID();
    let reads = 0;
    const interrupted = new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode('first'));
      else controller.error(new Error('Synthetic upload interrupted'));
    } });
    await expect(storage.write(workspace, upload, interrupted, 10)).rejects.toThrow('Synthetic upload interrupted');
    expect(await readdir(path.join(directory, workspace, upload))).toEqual([]);
    await expect(storage.read(`${workspace}/${upload}/original`)).rejects.toMatchObject({ code: 'ENOENT' });
    const retried = await storage.write(workspace, upload, stream('first-last'), 10);
    expect((await storage.read(retried.key)).toString()).toBe('first-last');
  });
  it('signs an immutable direct R2 upload and verifies the exact object before commit', async () => {
    const { storage, fetcher } = r2Fixture(), workspace = randomUUID(), upload = randomUUID(), expiry = new Date(Date.now() + 15 * 60_000);
    const token = await storage.uploadToken(workspace, upload, 'local-token', expiry);
    expect(token.startsWith('r2.v1.')).toBe(true);
    const payload = JSON.parse(Buffer.from(token.slice('r2.v1.'.length), 'base64url').toString()) as { url: string };
    const target = new URL(payload.url);
    expect(target.hostname).toBe(`${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    expect(target.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host;if-none-match');
    const uploaded = await fetcher(target, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: 'verified' });
    expect(uploaded.status).toBe(200);
    const receipt = await storage.write(workspace, upload, null, 8);
    expect(receipt).toEqual({ key: `${workspace}/${upload}/original`, hash: sourceHash('verified'), size: 8 });
    expect((await storage.read(receipt.key)).toString()).toBe('verified');
  });
  it('removes a direct R2 object whose declared size does not match', async () => {
    const { storage, fetcher, objects } = r2Fixture(), workspace = randomUUID(), upload = randomUUID();
    const token = await storage.uploadToken(workspace, upload, 'local-token', new Date(Date.now() + 15 * 60_000));
    const { url } = JSON.parse(Buffer.from(token.slice('r2.v1.'.length), 'base64url').toString()) as { url: string };
    await fetcher(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: 'wrong' });
    await expect(storage.write(workspace, upload, null, 10)).rejects.toMatchObject({ messageKey: 'sources.errors.sizeMismatch' });
    expect(objects.size).toBe(0);
  });
});
