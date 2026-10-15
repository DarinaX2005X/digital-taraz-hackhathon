import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { artifactFixture, artifactTestPool, testDocument } from '../artifacts/server/test-fixture';
import { createProjectViews } from '../../src/features/workspace/server/project-views';
import { createWorkspaceHandlers } from '../../src/features/workspace/server/handlers';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('private recent work and selected result', () => {
  it('keeps independent selected materials, preserves selection on overview, and filters moved or revoked results', async () => {
    const f = await artifactFixture(pool), views = createProjectViews(pool);
    const first = await f.create(), second = await f.create(testDocument('Second'), 'Second result');
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    expect((await views.read(f.owner, f.workspaceId, f.projectId)).lastOpenedAt).toBeNull();
    await views.record(f.owner, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 2, selectedArtifactId: first.artifact.id });
    await views.record(f.member, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 2, selectedArtifactId: second.artifact.id });
    await views.record(f.owner, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 2 });
    expect((await views.read(f.owner, f.workspaceId, f.projectId)).selectedArtifactId).toBe(first.artifact.id);
    expect((await views.read(f.member, f.workspaceId, f.projectId)).selectedArtifactId).toBe(second.artifact.id);
    const other = await f.projects.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, title: 'Destination', expectedAuthzVersion: 2 });
    await f.service.move(f.owner, randomUUID(), first.artifact.id, { workspaceId: f.workspaceId, projectId: other.project.id, expectedAuthzVersion: 2, baseRevision: 0 });
    expect((await views.read(f.owner, f.workspaceId, f.projectId)).selectedArtifactId).toBeNull();
    await expect(views.record(f.owner, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 2, selectedArtifactId: first.artifact.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: null, expectedAuthzVersion: 2 });
    await expect(views.read(f.member, f.workspaceId, f.projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not reveal a confidential or archived remembered result and rejects stale write authority', async () => {
    const f = await artifactFixture(pool), views = createProjectViews(pool);
    const secret = await f.service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, title: 'Private terms', expectedAuthzVersion: 1, accessClass: 'confidential', content: testDocument() });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    // The owner's selection must never be returned as the reader's default.
    await views.record(f.owner, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 2, selectedArtifactId: secret.artifact.id });
    expect((await views.read(f.member, f.workspaceId, f.projectId)).selectedArtifactId).toBeNull();
    await expect(views.record(f.member, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 2, selectedArtifactId: secret.artifact.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(views.record(f.owner, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await f.service.archive(f.owner, randomUUID(), secret.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 2, baseRevision: 0 });
    expect((await views.read(f.owner, f.workspaceId, f.projectId)).selectedArtifactId).toBeNull();
  });

  it('orders only the actor recent work and binds pagination to that actor and sort', async () => {
    const f = await artifactFixture(pool), views = createProjectViews(pool);
    const second = await f.projects.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, title: 'Second project', expectedAuthzVersion: 1 });
    const third = await f.projects.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, title: 'Third project', expectedAuthzVersion: 1 });
    await pool.query("UPDATE projects SET updated_at='2025-01-01'::timestamptz WHERE workspace_id=$1", [f.workspaceId]);
    await views.record(f.owner, second.project.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1 });
    await pool.query("UPDATE workspace_project_views SET last_opened_at='2025-02-01'::timestamptz WHERE project_id=$1 AND user_id=$2", [second.project.id, f.owner.userId]);
    await views.record(f.owner, f.projectId, { workspaceId: f.workspaceId, expectedAuthzVersion: 1 });
    const first = await f.projects.list(f.owner, { workspaceId: f.workspaceId, order: 'recent', limit: 1 });
    expect(first.projects.map((project) => project.id)).toEqual([f.projectId]);
    const next = await f.projects.list(f.owner, { workspaceId: f.workspaceId, order: 'recent', limit: 1, after: first.nextAfter! });
    expect(next.projects.map((project) => project.id)).toEqual([second.project.id]);
    const last = await f.projects.list(f.owner, { workspaceId: f.workspaceId, order: 'recent', limit: 1, after: next.nextAfter! });
    expect(last.projects.map((project) => project.id)).toEqual([third.project.id]);
    expect(last.nextAfter).toBeNull();
    await expect(f.projects.list(f.owner, { workspaceId: f.workspaceId, order: 'updated', after: first.nextAfter! })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.projects.list(f.member, { workspaceId: f.workspaceId, order: 'recent', after: first.nextAfter! })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('mounts strict authenticated view endpoints without accepting foreign project selections', async () => {
    const f = await artifactFixture(pool), result = await f.create();
    const handler = createWorkspaceHandlers({ pool, origin: 'http://127.0.0.1:59676', getActor: async () => ({ user: { id: f.owner.userId, name: 'Synthetic owner', email: 'owner@example.test', emailVerified: true, locale: 'ru' }, session: { id: f.owner.sessionId, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() } }) });
    const headers = { 'X-Tirlik-User-Id': f.owner.userId, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:59676', 'Idempotency-Key': randomUUID() };
    const url = `http://127.0.0.1:59676/api/projects/${f.projectId}/view`;
    const saved = await handler(new Request(url, { method: 'POST', headers, body: JSON.stringify({ workspaceId: f.workspaceId, expectedAuthzVersion: 1, selectedArtifactId: result.artifact.id }) }));
    expect(saved.status).toBe(200);
    const opened = await handler(new Request(`${url}?workspaceId=${f.workspaceId}`, { headers }));
    expect((await opened.json()).selectedArtifactId).toBe(result.artifact.id);
    expect((await handler(new Request(`${url}?workspaceId=${f.workspaceId}&status=active`, { headers }))).status).toBe(422);
    expect((await handler(new Request(url, { method: 'POST', headers: { ...headers, Origin: 'http://evil.invalid' }, body: '{}' }))).status).toBe(403);
  });
});
