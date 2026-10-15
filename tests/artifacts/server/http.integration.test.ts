import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityViewerSchema, WorkspaceResultSchema } from '../../../src/features/identity/contracts';
import { ProjectResultSchema } from '../../../src/features/workspace/contracts';
import { ArtifactHistorySchema, ArtifactListResultSchema, ArtifactMutationResultSchema, ArtifactSnapshotSchema, ArtifactVersionDetailSchema, CommandReceiptSchema } from '../../../src/features/artifacts/contracts';
import { WorkspaceEventPageSchema } from '../../../src/contracts/events';
import { createArtifactTargetResolver } from '../../../src/features/artifacts/domain/targets';
import { artifactTestPool, testDocument } from './test-fixture';

let pool: Pool;
let origin: string;
beforeAll(() => { pool = artifactTestPool(); origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`; });
afterAll(async () => { await pool?.end(); });

class HttpClient {
  cookies = new Map<string, string>();
  userId?: string;
  async request(path: string, method = 'GET', body?: unknown, custom: HeadersInit = {}) {
    const headers = new Headers(custom);
    if (method !== 'GET') { if (!headers.has('origin')) headers.set('origin', origin); headers.set('content-type', 'application/json'); }
    if (this.userId && !headers.has('x-tirlik-user-id')) headers.set('x-tirlik-user-id', this.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    for (const serialized of response.headers.getSetCookie()) {
      const first = serialized.split(';')[0]!, split = first.indexOf('='), name = first.slice(0, split), value = first.slice(split + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}
async function account() {
  const client = new HttpClient(), email = `artifact-http-${randomUUID()}@example.test`, password = 'Synthetic artifact password 42';
  expect((await client.request('/api/auth/sign-up/email', 'POST', { email, password, name: 'Synthetic history owner', locale: 'ru' })).status).toBe(200);
  const mailOrigin = `http://127.0.0.1:${process.env.TIRLIK_MAIL_UI_PORT}`;
  const search = new URL('/api/v1/search', mailOrigin); search.searchParams.set('query', `to:${email}`);
  const messages = await (await fetch(search)).json() as { messages: { ID: string }[] };
  let token: string | null = null;
  for (const message of messages.messages) {
    const mail = await (await fetch(`${mailOrigin}/api/v1/message/${message.ID}`)).json() as { Text: string };
    const link = mail.Text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/verify\?[^\s]+/)?.[0];
    if (link) { token = new URL(link).searchParams.get('token'); break; }
  }
  expect(token).not.toBeNull();
  expect((await client.request('/api/auth/verify-email', 'POST', { token })).status).toBe(200);
  expect((await client.request('/api/auth/sign-in/email', 'POST', { email, password })).status).toBe(200);
  const viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json());
  client.userId = viewer.user.id;
  const created = await client.request('/api/identity/workspaces', 'POST', { name: 'Synthetic artifact workspace' }, { 'idempotency-key': randomUUID() });
  expect(created.status).toBe(201);
  const workspace = WorkspaceResultSchema.parse(await created.json()).workspace;
  return { client, viewer, workspace };
}

describe('mounted artifact, project and workspace event HTTP routes', () => {
  it('creates, edits, reopens, undoes and restores a retained version through authenticated HTTP', async () => {
    const { client, viewer, workspace } = await account();
    const projectResponse = await client.request('/api/projects', 'POST', { workspaceId: workspace.workspaceId, expectedAuthzVersion: workspace.authzVersion, title: 'Synthetic HTTP project' }, { 'idempotency-key': randomUUID() });
    expect(projectResponse.status).toBe(201);
    const project = ProjectResultSchema.parse(await projectResponse.json());
    const createKey = randomUUID(), body = { workspaceId: workspace.workspaceId, projectId: project.project.id, expectedAuthzVersion: project.authzVersion, title: 'Synthetic terms', content: testDocument() };
    const createdResponse = await client.request('/api/artifacts', 'POST', body, { 'idempotency-key': createKey });
    expect(createdResponse.status).toBe(201); expect(createdResponse.headers.get('cache-control')).toBe('no-store');
    const created = ArtifactMutationResultSchema.parse(await createdResponse.json());
    const replay = ArtifactMutationResultSchema.parse(await (await client.request('/api/artifacts', 'POST', body, { 'idempotency-key': createKey })).json());
    expect(replay.artifact.id).toBe(created.artifact.id);
    expect((await client.request('/api/artifacts', 'POST', { ...body, title: 'Changed retry' }, { 'idempotency-key': createKey })).status).toBe(409);
    const query = `workspaceId=${workspace.workspaceId}`;
    const url = `/api/artifacts/${created.artifact.id}?${query}`;
    const initial = ArtifactSnapshotSchema.parse(await (await client.request(url)).json());
    const catalog = ArtifactListResultSchema.parse(await (await client.request(`/api/artifacts?${query}&projectId=${project.project.id}&limit=1`)).json());
    expect(catalog.artifacts.map((item) => item.id)).toEqual([created.artifact.id]);
    const target = createArtifactTargetResolver(initial.content)('p1')!;
    const groupId = randomUUID();
    const command = { workspaceId: workspace.workspaceId, expectedAuthzVersion: initial.viewer.authzVersion, group: { commandGroupId: groupId, expectedArtifactRevisions: { [created.artifact.id]: 0 }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: created.artifact.id, baseRevision: 0, kind: 'document', operations: [{ targetId: 'p1', op: 'set', beforeHash: target.hash, value: { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Confirmed HTTP wording' }] } }], expectedSourceRevisions: {}, reason: 'Manual HTTP change' }] } };
    const appliedResponse = await client.request('/api/artifacts/commands', 'POST', command, { 'idempotency-key': groupId });
    expect(appliedResponse.status).toBe(200);
    const applied = CommandReceiptSchema.parse(await appliedResponse.json());
    expect(CommandReceiptSchema.parse(await (await client.request('/api/artifacts/commands', 'POST', command, { 'idempotency-key': groupId })).json())).toEqual(applied);
    const changed = ArtifactSnapshotSchema.parse(await (await client.request(url)).json());
    expect(changed.content).toEqual(testDocument('Confirmed HTTP wording'));
    const events = WorkspaceEventPageSchema.parse(await (await client.request(`/api/workspace-events?${query}&cursor=${initial.cursor}`)).json());
    expect(events.events.some((event) => event.objectId === created.artifact.id && event.kind === 'artifact.changed')).toBe(true);
    const history = ArtifactHistorySchema.parse(await (await client.request(`/api/artifacts/${created.artifact.id}/history?${query}`)).json());
    expect(history.groups[0]).toMatchObject({ commandGroupId: groupId, canUndo: true });
    const undoId = randomUUID();
    const undo = { workspaceId: workspace.workspaceId, expectedAuthzVersion: changed.viewer.authzVersion, commandGroupId: undoId, targetCommandGroupId: groupId, expectedArtifactRevisions: applied.committedRevisionVector, expectedSourceRevisions: {} };
    expect((await client.request('/api/artifacts/history/undo', 'POST', undo, { 'idempotency-key': undoId })).status).toBe(200);
    expect(ArtifactSnapshotSchema.parse(await (await client.request(url)).json()).content).toEqual(testDocument());
    const retained = ArtifactVersionDetailSchema.parse(await (await client.request(`/api/artifacts/${created.artifact.id}/versions/1?${query}`)).json());
    expect(retained.content).toEqual(changed.content);
    const restore = await client.request(`/api/artifacts/${created.artifact.id}/restore-version`, 'POST', { workspaceId: workspace.workspaceId, expectedAuthzVersion: changed.viewer.authzVersion, baseRevision: 2, revision: 1, reason: 'Restore checked wording' }, { 'idempotency-key': randomUUID() });
    expect(restore.status).toBe(200); expect(ArtifactMutationResultSchema.parse(await restore.json()).artifact.currentRevision).toBe(3);
    const pagePath = `/app/projects/${project.project.id}/artifacts/${created.artifact.id}/history`;
    const authenticatedPage = await client.request(pagePath);
    expect(authenticatedPage.status).toBe(200);
    const authenticatedHtml = await authenticatedPage.text();
    expect(authenticatedHtml).toContain('Synthetic terms');
    expect(authenticatedHtml).toContain('Synthetic HTTP project');
    const guest = new HttpClient();
    const redirect = await guest.request(pagePath);
    if (redirect.status === 200) {
      const html = await redirect.text();
      const meta = html.match(/<meta\b(?=[^>]*\bid="__next-page-redirect")(?=[^>]*\bhttp-equiv="refresh")[^>]*>/)?.[0];
      expect(meta).toContain(`content="1;url=/sign-in?returnTo=${encodeURIComponent(pagePath)}`);
      for (const privateText of ['Synthetic terms', 'Synthetic HTTP project', 'Confirmed HTTP wording']) expect(html).not.toContain(privateText);
    } else {
      expect([303, 307]).toContain(redirect.status);
      expect(redirect.headers.get('location')).toBe(`/sign-in?returnTo=${encodeURIComponent(pagePath)}`);
    }
    expect((await guest.request(url)).status).toBe(401);
    expect((await client.request(url, 'GET', undefined, { 'x-tirlik-user-id': randomUUID() })).status).toBe(409);
    expect((await client.request('/api/artifacts', 'POST', body, { 'idempotency-key': randomUUID(), origin: 'https://other.example' })).status).toBe(403);
    expect((await client.request(`/api/artifacts?${query}&projectId=${project.project.id}&limit=1&limit=2`)).status).toBe(422);
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [viewer.session.id]);
    expect((await client.request(url)).status).toBe(401);
  }, 180000);
});
