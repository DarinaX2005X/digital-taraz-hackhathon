import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createProjectPackageClient, ProjectPackageRequestError } from '../../src/features/project-packages/client';
import { CreateProjectPackageSchema } from '../../src/features/project-packages/contracts';
import { projectPackageCopy } from '../../src/features/project-packages/locales';

const workspaceId = randomUUID(), projectId = randomUUID(), artifactId = randomUUID();
const viewer = { userId: randomUUID(), workspaceId, authzVersion: 3 };
const release = { projectId, title: 'October release', audience: 'Client', knownOmissions: ['Final signature'] };
const packageJob = {
  id: randomUUID(), workspaceId, createdAt: '2026-10-17T10:00:00.000Z', historicalDraft: false, locale: 'en' as const,
  privateFieldsPolicy: 'exclude-internal' as const, release, revisions: [{ artifactId, revision: 2 }], status: 'queued' as const,
  files: [{ id: randomUUID(), artifactId, revision: 2, format: 'pdf' as const, fileName: 'release.pdf', status: 'pending' as const, warnings: [] }], authzVersion: 4,
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('project package HTTP client', () => {
  it('keeps release metadata scoped to the requested project and accepts a refreshed authz version', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ packages: [packageJob], authzVersion: 4 })).mockResolvedValueOnce(response(packageJob, 201));
    const client = createProjectPackageClient(viewer, projectId, fetcher);
    expect((await client.list()).packages[0]?.release).toEqual(release);
    const input = CreateProjectPackageSchema.parse({ workspaceId, expectedAuthzVersion: 4, locale: 'en', historicalDraft: false, privateFieldsPolicy: 'exclude-internal', release, items: [{ artifactId, revision: 2, formats: ['pdf'], options: {} }] });
    await expect(client.create(input, '75bbcab3-281f-441f-9209-39b7d67366ea')).resolves.toMatchObject({ release });
    expect(fetcher).toHaveBeenLastCalledWith('/api/packages', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': '75bbcab3-281f-441f-9209-39b7d67366ea' }) }));
  });

  it('rejects cross-project list data and stale create attempts before they can be trusted', async () => {
    const foreign = { ...packageJob, release: { ...release, projectId: randomUUID() } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ packages: [foreign], authzVersion: 4 }));
    await expect(createProjectPackageClient(viewer, projectId, fetcher).list()).rejects.toBeInstanceOf(ProjectPackageRequestError);
    const stale = CreateProjectPackageSchema.parse({ workspaceId, expectedAuthzVersion: 2, locale: 'en', release, items: [{ artifactId, revision: 2, formats: ['pdf'], options: {} }] });
    await expect(createProjectPackageClient(viewer, projectId, fetcher).create(stale, randomUUID())).rejects.toMatchObject({ status: 409, uncertain: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps package workflow copy in locale parity', () => {
    expect(Object.keys(projectPackageCopy.kk)).toEqual(Object.keys(projectPackageCopy.ru));
    expect(Object.keys(projectPackageCopy.en)).toEqual(Object.keys(projectPackageCopy.ru));
    for (const locale of ['ru', 'kk', 'en'] as const) expect(projectPackageCopy[locale].notSent.length).toBeGreaterThan(20);
  });
});
