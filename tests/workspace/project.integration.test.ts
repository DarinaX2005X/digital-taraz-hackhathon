import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';
import { createWorkspaceHandlers } from '../../src/features/workspace/server/handlers';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

describe('project work lifecycle', () => {
  it('keeps a saved goal through reopen, archive and restore with exactly-once writes', async () => {
    const f = await artifactFixture(pool);
    const input = { workspaceId: f.workspaceId, expectedRevision: 1, expectedAuthzVersion: 1, title: 'Клиентке ұсыныс', goal: 'Use my price list\nKeep delivery separate.' };
    const key = randomUUID();
    const changed = await f.projects.mutate(f.owner, key, f.projectId, 'update', input);
    const replay = await f.projects.mutate(f.owner, key, f.projectId, 'update', input);
    expect(replay.project).toEqual(changed.project);
    expect(changed.project.revision).toBe(2);
    expect((await f.projects.readRoute(f.owner, f.projectId)).project.goal).toBe(input.goal);
    await expect(f.projects.mutate(f.owner, key, f.projectId, 'update', { ...input, goal: 'different retry' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.projects.mutate(f.owner, randomUUID(), f.projectId, 'update', { ...input, goal: 'stale edit' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const archived = await f.projects.mutate(f.owner, randomUUID(), f.projectId, 'archive', { workspaceId: f.workspaceId, expectedRevision: 2, expectedAuthzVersion: 1 });
    expect(archived.project.status).toBe('archived');
    expect((await f.projects.list(f.owner, { workspaceId: f.workspaceId })).projects).toHaveLength(0);
    expect((await f.projects.list(f.owner, { workspaceId: f.workspaceId, status: 'archived' })).projects.map((p) => p.id)).toEqual([f.projectId]);
    await expect(f.create()).rejects.toMatchObject({ code: 'CONFLICT' });
    const restored = await f.projects.mutate(f.owner, randomUUID(), f.projectId, 'restore', { workspaceId: f.workspaceId, expectedRevision: 3, expectedAuthzVersion: 1 });
    expect(restored.project).toMatchObject({ status: 'active', revision: 4, goal: input.goal });
    expect((await pool.query("SELECT count(*)::int AS total FROM workspace_events WHERE project_id=$1 AND kind='project.changed'", [f.projectId])).rows[0].total).toBe(3);
  });

  it('intersects current project permissions and rejects revoked replay', async () => {
    const f = await artifactFixture(pool);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    expect((await f.projects.read(f.member, f.workspaceId, f.projectId)).canEdit).toBe(false);
    const body = { workspaceId: f.workspaceId, expectedRevision: 1, expectedAuthzVersion: 2, title: 'New title', goal: null };
    await expect(f.projects.mutate(f.member, randomUUID(), f.projectId, 'update', body)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 2 });
    const key = randomUUID(), input = { ...body, expectedAuthzVersion: 3 };
    await f.projects.mutate(f.member, key, f.projectId, 'update', input);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: null, expectedAuthzVersion: 3 });
    await expect(f.projects.mutate(f.member, key, f.projectId, 'update', input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.projects.readRoute(f.member, f.projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('mounts real create, update and list handlers with origin and actor checks', async () => {
    const f = await artifactFixture(pool);
    const handler = createWorkspaceHandlers({ pool, origin: 'http://127.0.0.1:59676', getActor: async () => ({ user: { id: f.owner.userId, name: 'Synthetic owner', email: 'owner@example.test', locale: 'ru' }, session: { id: f.owner.sessionId, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() } }) });
    const request = (path: string, body?: unknown, origin = 'http://127.0.0.1:59676') => new Request(`http://127.0.0.1:59676/api/projects${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Tirlik-User-Id': f.owner.userId, 'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await handler(request('', { workspaceId: f.workspaceId, title: 'Owned work', expectedAuthzVersion: 1 }))).status).toBe(201);
    const body = { workspaceId: f.workspaceId, title: 'Renamed', goal: 'Prepare quote', expectedAuthzVersion: 1, expectedRevision: 1 };
    expect((await handler(request(`/${f.projectId}/update`, body, 'http://evil.invalid'))).status).toBe(403);
    expect((await handler(request(`/${f.projectId}/update`, body))).status).toBe(200);
    const response = await handler(request(`?workspaceId=${f.workspaceId}&query=Renamed&limit=1`));
    expect(response.status).toBe(200);
    expect((await response.json()).projects[0].goal).toBe('Prepare quote');
    expect((await handler(request(`?workspaceId=${f.workspaceId}&status=invalid`))).status).toBe(422);
    expect((await handler(request(`?workspaceId=${f.workspaceId}&workspaceId=${f.workspaceId}`))).status).toBe(422);
  });
});
