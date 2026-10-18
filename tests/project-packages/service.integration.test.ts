import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool, currentArtifactAuthz, testDocument } from '../artifacts/server/test-fixture';
import { createExportService } from '../../src/features/exports/server/service';
import { ExportRegistry } from '../../src/features/exports/server/registry';
import { LocalExportStorage } from '../../src/features/exports/server/storage';
import { createProjectPackageService } from '../../src/features/project-packages/server/service';

let pool: Pool;
const directories: string[] = [];
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => {
  await pool?.end();
  for (const directory of directories) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('tirlik-packages-test-')) throw new Error('INVALID_TEST_CLEANUP_PATH');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('project release packages in PostgreSQL', () => {
  it('reopens only the creator’s immutable packages for the selected project', async () => {
    const fixture = await artifactFixture(pool), artifact = await fixture.create(), directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-packages-test-'));
    directories.push(directory);
    const exports = createExportService({
      pool,
      storage: new LocalExportStorage(directory),
      registry: new ExportRegistry([{ kind: 'document', formats: ['pdf'], async render(input) { return { bytes: new TextEncoder().encode(`${input.title}:${input.revision}`), mediaType: 'application/pdf', warnings: [] }; } }]),
      assets: () => ({ async image() { throw new Error('UNEXPECTED_IMAGE'); } }),
    });
    const packages = createProjectPackageService(pool, exports), authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const release = { projectId: fixture.projectId, title: 'Verified October package', audience: 'Client team', knownOmissions: ['Wet signature'], basis: 'saved-draft' as const };
    const created = await packages.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, locale: 'en', historicalDraft: true, release, items: [{ artifactId: artifact.artifact.id, revision: 0, formats: ['pdf'], options: {} }] });
    const otherProject = await fixture.projects.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, title: 'Other project', expectedAuthzVersion: authzVersion });
    const otherArtifact = await fixture.service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: otherProject.project.id, expectedAuthzVersion: authzVersion, title: 'Other document', content: testDocument() });
    await packages.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, locale: 'en', historicalDraft: true, release: { ...release, projectId: otherProject.project.id }, items: [{ artifactId: otherArtifact.artifact.id, revision: 0, formats: ['pdf'], options: {} }] });
    await fixture.projects.setGrant(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, userId: fixture.member.userId, scopes: ['read', 'export'], expectedAuthzVersion: authzVersion });

    expect(created.release).toEqual(release);
    expect((await packages.list(fixture.member, { workspaceId: fixture.workspaceId, projectId: fixture.projectId })).packages).toEqual([]);
    const firstProject = await packages.list(fixture.owner, { workspaceId: fixture.workspaceId, projectId: fixture.projectId });
    expect(firstProject).toMatchObject({ packages: [{ id: created.id, release }] });
    expect(firstProject.packages.map((item) => item.id)).toEqual([created.id]);
  });
});
