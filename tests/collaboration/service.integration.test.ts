import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';
import { createCollaborationService } from '../../src/features/collaboration/server/service';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('artifact collaboration in PostgreSQL', () => {
  it('binds comments and decisions to an exact artifact version and enforces approval scope', async () => {
    const fixture = await artifactFixture(pool), artifact = await fixture.create(), service = createCollaborationService(pool);
    await fixture.projects.setGrant(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, userId: fixture.member.userId, scopes: ['read'], expectedAuthzVersion: await currentArtifactAuthz(pool, fixture.workspaceId) });
    const authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const operationId = randomUUID();
    const input = { workspaceId: fixture.workspaceId, projectId: fixture.projectId, artifactId: artifact.artifact.id, artifactRevision: 0, parentId: null, target: { kind: 'artifact' as const }, body: 'Please verify the delivery terms.', expectedAuthzVersion: authzVersion };
    const first = await service.comment(fixture.member, operationId, input);
    expect(await service.comment(fixture.member, operationId, input)).toEqual(first);
    const resolved = await service.resolve(fixture.member, randomUUID(), first.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, resolved: true });
    expect(resolved).toMatchObject({ state: 'resolved', resolvedBy: fixture.member.userId });
    expect((await service.resolve(fixture.member, randomUUID(), first.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, resolved: false })).state).toBe('open');

    await expect(service.decide(fixture.member, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, artifactId: artifact.artifact.id, artifactRevision: 0, decision: 'approved', note: '', expectedAuthzVersion: authzVersion })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.decide(fixture.member, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, artifactId: artifact.artifact.id, artifactRevision: 0, decision: 'changes_requested', note: 'Clarify payment date.', expectedAuthzVersion: authzVersion });
    const ownerDecision = await service.decide(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, artifactId: artifact.artifact.id, artifactRevision: 0, decision: 'approved', note: 'Version accepted.', expectedAuthzVersion: authzVersion });
    const thread = await service.thread(fixture.member, { workspaceId: fixture.workspaceId, projectId: fixture.projectId, artifactId: artifact.artifact.id, artifactRevision: 0 });
    expect(thread).toMatchObject({ comments: [{ id: first.id }], latestDecision: { id: ownerDecision.id, decision: 'approved' }, permissions: { comment: true, resolve: false, approve: false } });
    await expect(service.thread(fixture.member, { workspaceId: fixture.workspaceId, projectId: fixture.projectId, artifactId: artifact.artifact.id, artifactRevision: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
