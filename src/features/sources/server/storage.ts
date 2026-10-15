import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_MAX_BYTES } from '../../../contracts/sources';
import { IdSchema } from '../../../contracts/primitives';
import { IdentityError } from '../../identity/server/http';

export const sourceHash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface OriginalBytes { key: string; hash: string; size: number }
const fail = (key: string) => new IdentityError('VALIDATION_FAILED', `sources.errors.${key}`);

export class LocalSourceStorage {
  constructor(private readonly root = path.resolve(process.env.TIRLIK_DATA_DIR ?? path.join(process.cwd(), '.local-data', 'files'), 'sources')) {}
  private async directory(workspaceId: string, uploadId: string) {
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
  async write(workspaceId: string, uploadId: string, stream: ReadableStream<Uint8Array>, expectedSize: number, signal?: AbortSignal): Promise<OriginalBytes> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > SOURCE_MAX_BYTES) throw fail('tooLarge');
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
      return { key: `${workspaceId}/${uploadId}/original`, hash: digest, size };
    } finally {
      await handle.close().catch(() => undefined);
      reader.releaseLock();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async read(key: string): Promise<Buffer> {
    const { workspaceId, uploadId } = this.parseKey(key);
    const file = path.join(await this.directory(workspaceId, uploadId), 'original');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > SOURCE_MAX_BYTES) throw fail('storage');
    return readFile(file);
  }
  async remove(key: string): Promise<void> {
    const { workspaceId, uploadId } = this.parseKey(key);
    const file = path.join(await this.directory(workspaceId, uploadId), 'original');
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink()) throw fail('storage');
    await unlink(file);
  }
}
