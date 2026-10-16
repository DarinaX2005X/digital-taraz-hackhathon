import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';
import { CreateExportSchema } from '@/features/exports/contracts';
import { createExportService } from '@/features/exports/server/service';
import { ExportRegistry } from '@/features/exports/server/registry';
import { LocalExportStorage } from '@/features/exports/server/storage';

let pool: Pool;
const directories: string[] = [];

beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => {
  await pool?.end();
  for (const directory of directories) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('tirlik-release-test-')) throw new Error('INVALID_TEST_CLEANUP_PATH');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('immutable release metadata in the canonical export service', () => {
  it('persists and bundles release intent and rejects artifacts from another project', async () => {
    const fixture = await artifactFixture(pool);
    const artifact = await fixture.create();
    const otherProject = await fixture.projects.create(fixture.owner, randomUUID(), {
      workspaceId: fixture.workspaceId,
      title: 'Other project',
      expectedAuthzVersion: 1,
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-release-test-'));
    directories.push(directory);
    const service = createExportService({
      pool,
      storage: new LocalExportStorage(directory),
      registry: new ExportRegistry([{ kind: 'document', formats: ['pdf'], async render() { return { bytes: new Uint8Array([1, 2, 3]), mediaType: 'application/pdf', warnings: [] }; } }]),
      assets: () => ({ async image() { throw new Error('UNEXPECTED_IMAGE'); } }),
    });
    const release = { projectId: fixture.projectId, title: 'Пакет для заказчика', audience: 'Заказчик', knownOmissions: ['Подпись добавляется после проверки'] };
    const request = CreateExportSchema.parse({
      workspaceId: fixture.workspaceId,
      expectedAuthzVersion: 1,
      locale: 'ru',
      release,
      items: [{ artifactId: artifact.artifact.id, revision: 0, formats: ['pdf'] }],
    });
    const created = await service.create(fixture.owner, randomUUID(), request);
    expect(created.release).toEqual(release);
    const persisted = await pool.query<{ input_manifest: { release?: unknown } }>('SELECT input_manifest FROM export_jobs WHERE id=$1', [created.id]);
    expect(persisted.rows[0]?.input_manifest.release).toEqual(release);

    const ready = await service.render(fixture.owner, fixture.workspaceId, created.id, 1);
    const archive = await JSZip.loadAsync((await service.downloadBundle(fixture.owner, fixture.workspaceId, ready.id)).bytes);
    const bundled = JSON.parse(await archive.file('manifest.json')!.async('string')) as { release?: unknown };
    expect(bundled.release).toEqual(release);
    expect((await service.read(fixture.owner, fixture.workspaceId, created.id)).release).toEqual(release);

    await expect(service.create(fixture.owner, randomUUID(), CreateExportSchema.parse({
      ...request,
      release: { ...release, projectId: otherProject.project.id },
    }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
