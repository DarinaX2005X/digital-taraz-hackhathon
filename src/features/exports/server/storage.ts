import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { IdSchema } from '../../../contracts/primitives';
import { IdentityError } from '../../identity/server/http';
export const EXPORT_MAX_BYTES = 100 * 1024 * 1024;
export const byteHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const storageError = () => new IdentityError('UNAVAILABLE', 'exports.errors.storage');
export class LocalExportStorage {
  constructor(private readonly root = path.resolve(process.env.TIRLIK_DATA_DIR ?? path.join(process.cwd(), '.local-data', 'files'), 'exports')) {}
  private async location(key: string) {
    const parts = key.split('/');
    if (parts.length !== 3 || parts.some((part) => !IdSchema.safeParse(part).success)) throw storageError();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw storageError();
    let directory = await realpath(this.root);
    for (const part of parts.slice(0, 2)) {
      directory = path.join(directory, part); await mkdir(directory, { recursive: true, mode: 0o700 });
      const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw storageError();
    }
    return path.join(directory, parts[2]!);
  }
  async write(workspaceId: string, jobId: string, bytes: Uint8Array) {
    if (!bytes.byteLength || bytes.byteLength > EXPORT_MAX_BYTES) throw new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooLarge');
    const key = `${workspaceId}/${jobId}/${randomUUID()}`, final = await this.location(key), temporary = `${final}.part`;
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); await handle.close(); await link(temporary, final); }
    finally { await handle.close().catch(() => undefined); await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
    return { key, sha256: byteHash(bytes), byteSize: bytes.byteLength };
  }
  async read(key: string, expected: { sha256: string; byteSize: number }) {
    const file = await this.location(key), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.byteSize || info.size > EXPORT_MAX_BYTES) throw storageError();
    const handle = await open(file, 'r');
    try { const checked = await handle.stat(); if (checked.size !== expected.byteSize) throw storageError(); const bytes = await handle.readFile(); if (byteHash(bytes) !== expected.sha256) throw storageError(); return bytes; }
    finally { await handle.close(); }
  }
  async remove(key: string) {
    const file = await this.location(key), info = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return; if (!info.isFile() || info.isSymbolicLink()) throw storageError(); await unlink(file);
  }
}
