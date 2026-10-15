import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSourceStorage, sourceHash } from '../../src/features/sources/server/storage';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const stream = (value: string) => new Blob([value]).stream();
describe('private immutable source bytes', () => {
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
});
