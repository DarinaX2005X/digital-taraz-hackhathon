import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_MAX_BYTES } from '../../../contracts/sources';
import { IdSchema } from '../../../contracts/primitives';
import { R2ObjectStorage, R2StorageError, selectStorage, type R2StorageConfig } from '../../../server/storage/r2';
import { IdentityError } from '../../identity/server/http';

export const sourceHash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface OriginalBytes { key: string; hash: string; size: number }
const fail = (key: string) => new IdentityError('VALIDATION_FAILED', `sources.errors.${key}`);
const uploadKey = (workspaceId: string, uploadId: string) => `${IdSchema.parse(workspaceId)}/${IdSchema.parse(uploadId)}/original`;

async function readUpload(stream: ReadableStream<Uint8Array>, expectedSize: number, signal?: AbortSignal) {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > expectedSize || size > SOURCE_MAX_BYTES) { await reader.cancel(); throw new IdentityError('PAYLOAD_TOO_LARGE', 'sources.errors.tooLarge'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  if (size !== expectedSize) throw fail('sizeMismatch');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export class LocalSourceStorage {
  private readonly root: string | null;
  private readonly r2: R2ObjectStorage | null;
  constructor(override?: string | R2StorageConfig) {
    const fallback = path.resolve(process.env.TIRLIK_DATA_DIR || path.join(process.cwd(), '.local-data', 'files'), 'sources');
    const selected = selectStorage(fallback, override);
    this.root = selected.driver === 'local' ? path.resolve(selected.root) : null;
    this.r2 = selected.driver === 'r2' ? new R2ObjectStorage(selected) : null;
  }
  async uploadToken(workspaceId: string, uploadId: string, localToken: string, expiresAt: Date) {
    if (!this.r2) return localToken;
    const seconds = Math.max(60, Math.min(15 * 60, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    const url = await this.r2.presignImmutablePut(uploadKey(workspaceId, uploadId), seconds);
    return `r2.v1.${Buffer.from(JSON.stringify({ url })).toString('base64url')}`;
  }
  private async directory(workspaceId: string, uploadId: string) {
    if (!this.root) throw fail('storage');
    IdSchema.parse(workspaceId); IdSchema.parse(uploadId);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(this.root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw fail('storage');
    const root = await realpath(this.root);
    let current = root;
    for (const part of [workspaceId, uploadId]) {
      current = path.join(current, part);
      await mkdir(current, { recursive: true, mode: 0o700 });
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw fail('storage');
    }
    return current;
  }
  private parseKey(key: string) {
    const parts = key.split('/');
    if (parts.length !== 3 || parts[2] !== 'original') throw fail('storage');
    return { workspaceId: IdSchema.parse(parts[0]), uploadId: IdSchema.parse(parts[1]) };
  }
  async write(workspaceId: string, uploadId: string, stream: ReadableStream<Uint8Array> | null, expectedSize: number, signal?: AbortSignal): Promise<OriginalBytes> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > SOURCE_MAX_BYTES) throw fail('tooLarge');
    const key = uploadKey(workspaceId, uploadId);
    if (this.r2) {
      try {
        if (stream) await this.r2.putImmutable(key, await readUpload(stream, expectedSize, signal), SOURCE_MAX_BYTES);
        const bytes = await this.r2.read(key, SOURCE_MAX_BYTES, expectedSize);
        return { key, hash: sourceHash(bytes), size: bytes.byteLength };
      } catch (error) {
        if (error instanceof IdentityError) throw error;
        if (error instanceof R2StorageError && error.reason === 'size') {
          await this.r2.remove(key).catch(() => undefined);
          throw fail('sizeMismatch');
        }
        if (error instanceof R2StorageError && error.reason === 'immutable') throw fail('immutable');
        throw fail('storage');
      }
    }
    if (!stream) throw fail('uploadExpired');
    const directory = await this.directory(workspaceId, uploadId);
    const temporary = path.join(directory, `${randomUUID()}.part`), final = path.join(directory, 'original');
    const handle = await open(temporary, 'wx', 0o600), reader = stream.getReader();
    const hash = createHash('sha256'); let size = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > expectedSize || size > SOURCE_MAX_BYTES) { await reader.cancel(); throw new IdentityError('PAYLOAD_TOO_LARGE', 'sources.errors.tooLarge'); }
        hash.update(next.value); await handle.writeFile(next.value);
      }
      if (size !== expectedSize) throw fail('sizeMismatch');
      await handle.sync(); await handle.close();
      const digest = hash.digest('hex');
      try { await link(temporary, final); }
      catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
        const original = await this.read(`${workspaceId}/${uploadId}/original`);
        if (original.byteLength !== size || sourceHash(original) !== digest) throw fail('immutable');
      }
      return { key, hash: digest, size };
    } finally {
      await handle.close().catch(() => undefined);
      reader.releaseLock();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async read(key: string): Promise<Buffer> {
    const { workspaceId, uploadId } = this.parseKey(key);
    if (this.r2) {
      try { return Buffer.from(await this.r2.read(uploadKey(workspaceId, uploadId), SOURCE_MAX_BYTES)); }
      catch { throw fail('storage'); }
    }
    const file = path.join(await this.directory(workspaceId, uploadId), 'original');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > SOURCE_MAX_BYTES) throw fail('storage');
    return readFile(file);
  }
  async remove(key: string): Promise<void> {
    const { workspaceId, uploadId } = this.parseKey(key);
    if (this.r2) {
      try { await this.r2.remove(uploadKey(workspaceId, uploadId)); return; }
      catch { throw fail('storage'); }
    }
    const file = path.join(await this.directory(workspaceId, uploadId), 'original');
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink()) throw fail('storage');
    await unlink(file);
  }
}
