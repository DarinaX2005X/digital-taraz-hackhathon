import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalExportStorage } from '../../src/features/exports/server/storage';
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
});
