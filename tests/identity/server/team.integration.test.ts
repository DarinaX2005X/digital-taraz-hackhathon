import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccountDeletionPreviewSchema, AccountDeletionResultSchema, IdentityViewerSchema, InvitationMutationResultSchema, InvitationPreviewSchema, TeamMutationResultSchema, TeamResultSchema, WorkspaceResultSchema, type WorkspaceMembership } from '../../../src/features/identity/contracts';
import { withWorkspaceAccess, type SessionPrincipal } from '../../../src/features/identity/server/access';
import { createInvitationService } from '../../../src/features/identity/server/invitations';
import { createProjectCore } from '../../../src/features/workspace/server/project-core';

let pool: Pool;
let origin: string;
let mailOrigin: string;
let effectTable: string;
const password = 'Synthetic team password 2026';

class Client {
  cookies = new Map<string, string>();
  principal!: SessionPrincipal;
  email = `team-${randomUUID()}@example.test`;
  async request(path: string, method = 'GET', body?: unknown, key: string = randomUUID(), extra: Record<string, string> = {}) {
    const headers = new Headers(extra);
    if (method !== 'GET') { headers.set('origin', origin); headers.set('content-type', 'application/json'); headers.set('idempotency-key', key); }
    if (this.principal) headers.set('x-tirlik-user-id', this.principal.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const serialized of response.headers.getSetCookie()) {
      const first = serialized.split(';')[0]!;
      const at = first.indexOf('=');
      if (first.slice(at + 1)) this.cookies.set(first.slice(0, at), first.slice(at + 1)); else this.cookies.delete(first.slice(0, at));
    }
    return response;
  }
}
async function mailLink(email: string, kind: 'verify' | 'invite') {
  const search = new URL('/api/v1/search', mailOrigin);
  search.searchParams.set('query', `to:${email}`);
  const list = await (await fetch(search)).json() as { messages: { ID: string }[] };
  for (const item of list.messages) {
    const mail = await (await fetch(`${mailOrigin}/api/v1/message/${item.ID}`)).json() as { Text: string };
    const route = kind === 'invite' ? 'settings/invitations/[a-f0-9]{64}' : 'auth/verify\\?[^\\s]+';
    const candidate = mail.Text.match(new RegExp(`http://127\\.0\\.0\\.1:\\d+/${route}`))?.[0];
    if (candidate) return new URL(candidate);
  }
  throw new Error('SYNTHETIC_TEAM_MAIL_MISSING');
}
async function account(email?: string) {
  const client = new Client();
  if (email) client.email = email;
  expect((await client.request('/api/auth/sign-up/email', 'POST', { email: client.email, name: 'Synthetic teammate', password, locale: 'ru' })).status).toBe(200);
  const link = await mailLink(client.email, 'verify');
  expect((await client.request('/api/auth/verify-email', 'POST', { token: link.searchParams.get('token') })).status).toBe(200);
  expect((await client.request('/api/auth/sign-in/email', 'POST', { email: client.email, password })).status).toBe(200);
  const viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json());
  client.principal = { kind: 'session', userId: viewer.user.id, sessionId: viewer.session.id };
  return client;
}
async function workspace(client: Client, name = 'Synthetic team workspace') {
  const response = await client.request('/api/identity/workspaces', 'POST', { name });
  expect(response.status).toBe(201);
  return WorkspaceResultSchema.parse(await response.json()).workspace;
}
async function team(client: Client, workspaceId: string) {
  const response = await client.request(`/api/identity/workspaces/${workspaceId}/team`);
  expect(response.status).toBe(200);
  return TeamResultSchema.parse(await response.json());
}
async function invite(owner: Client, current: WorkspaceMembership, recipient: Client, role: 'owner' | 'editor' | 'reviewer' = 'reviewer') {
  const response = await owner.request(`/api/identity/workspaces/${current.workspaceId}/invitations`, 'POST', { email: recipient.email, role, locale: 'ru', expectedAuthzVersion: current.authzVersion });
  expect(response.status).toBe(201);
  const sent = InvitationMutationResultSchema.parse(await response.json());
  expect(sent.delivery).toBe('sent');
  const link = await mailLink(recipient.email, 'invite');
  return { ...sent, token: link.pathname.split('/').at(-1)!, key: randomUUID() };
}
async function accept(recipient: Client, invitation: { token: string; key: string }) {
  const response = await recipient.request(`/api/identity/invitations/${invitation.token}/accept`, 'POST', {}, invitation.key);
  expect(response.status).toBe(200);
  return WorkspaceResultSchema.parse(await response.json()).workspace;
}
let owner: Client;
let colleague: Client;
let stranger: Client;
beforeAll(async () => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/tirlik' || process.env.SMTP_HOST !== '127.0.0.1' || process.env.SMTP_PASSWORD || process.env.BREVO_API_KEY || process.env.BREVO_SMTP_KEY) throw new Error('ISOLATED_LOCAL_SERVICES_REQUIRED');
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
  mailOrigin = `http://127.0.0.1:${process.env.TIRLIK_MAIL_UI_PORT}`;
  pool = new Pool({ connectionString: url.href, application_name: 'identity-team-integration' });
  effectTable = `identity_test_effects_${process.env.TIRLIK_TEST_NAMESPACE}`;
  await pool.query(`CREATE TABLE ${effectTable} (id uuid PRIMARY KEY, workspace_id uuid NOT NULL)`);
  owner = await account(); colleague = await account(); stranger = await account();
}, 60000);
afterAll(async () => { if (effectTable) await pool.query(`DROP TABLE IF EXISTS ${effectTable}`); await pool?.end(); });

describe('real workspace invitations and authorization', () => {
  it('creates idempotently, hides invitations until verified matching login and consumes only once', async () => {
    const key = randomUUID();
    const name = 'Private synthetic workspace';
    const first = await owner.request('/api/identity/workspaces', 'POST', { name }, key);
    expect(first.status).toBe(201);
    const current = WorkspaceResultSchema.parse(await first.json()).workspace;
    expect(WorkspaceResultSchema.parse(await (await owner.request('/api/identity/workspaces', 'POST', { name }, key)).json()).workspace.workspaceId).toBe(current.workspaceId);
    expect((await owner.request('/api/identity/workspaces', 'POST', { name: 'Changed' }, key)).status).toBe(409);
    expect((await stranger.request(`/api/identity/workspaces/${current.workspaceId}/team`)).status).toBe(404);
    const invitation = await invite(owner, current, colleague);
    const guest = new Client();
    const guestResponse = await guest.request(`/api/identity/invitations/${invitation.token}`);
    expect(guestResponse.status).toBe(401);
    expect(await guestResponse.text()).not.toContain(name);
    const foreign = await stranger.request(`/api/identity/invitations/${invitation.token}`);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain(name);
    const preview = InvitationPreviewSchema.parse(await (await colleague.request(`/api/identity/invitations/${invitation.token}`)).json());
    expect(preview.workspaceName).toBe(name);
    const joined = await accept(colleague, invitation);
    expect(joined.authzVersion).toBe(current.authzVersion + 2);
    expect((await accept(colleague, invitation)).workspaceId).toBe(current.workspaceId);
    expect((await colleague.request(`/api/identity/invitations/${invitation.token}/accept`, 'POST', {})).status).toBe(404);
    expect((await colleague.request(`/api/identity/invitations/${invitation.token}`)).status).toBe(404);
    expect((await pool.query("SELECT count(*)::int AS count FROM identity_memberships WHERE workspace_id=$1 AND user_id=$2 AND state='active'", [current.workspaceId, colleague.principal.userId])).rows[0].count).toBe(1);
    expect((await team(owner, current.workspaceId)).members).toHaveLength(2);
    expect(IdentityViewerSchema.parse(await (await colleague.request('/api/identity/me')).json()).workspaces.some((value) => value.workspaceId === current.workspaceId)).toBe(true);
  });

  it('binds project scopes, confidential data and late effects to authoritative access', async () => {
    const current = await workspace(owner, 'Guarded synthetic workspace');
    const joined = await accept(colleague, await invite(owner, current, colleague));
    const projects = createProjectCore(pool);
    const projectId = (await projects.create(owner.principal, randomUUID(), { workspaceId: current.workspaceId, title: 'Guarded synthetic project', expectedAuthzVersion: joined.authzVersion })).project.id;
    const granted = await projects.setGrant(owner.principal, randomUUID(), { workspaceId: current.workspaceId, projectId, userId: colleague.principal.userId, scopes: ['read', 'approve', 'export'], expectedAuthzVersion: joined.authzVersion });
    const effect = vi.fn(async () => 'authorized');
    await expect(withWorkspaceAccess(pool, colleague.principal, { workspaceId: current.workspaceId, projectId, scope: 'approve' }, effect)).resolves.toBe('authorized');
    await expect(withWorkspaceAccess(pool, colleague.principal, { workspaceId: current.workspaceId, projectId, scope: 'edit' }, effect)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(withWorkspaceAccess(pool, colleague.principal, { workspaceId: current.workspaceId, projectId, scope: 'export', confidential: true }, effect)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(withWorkspaceAccess(pool, owner.principal, { workspaceId: current.workspaceId, projectId, scope: 'read' }, effect)).resolves.toBe('authorized');
    await expect(withWorkspaceAccess(pool, owner.principal, { workspaceId: current.workspaceId, projectId: randomUUID(), scope: 'read' }, effect)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(withWorkspaceAccess(pool, colleague.principal, { workspaceId: current.workspaceId, projectId: randomUUID(), scope: 'read' }, effect)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(effect).toHaveBeenCalledTimes(2);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const guarded = withWorkspaceAccess(pool, colleague.principal, { workspaceId: current.workspaceId, projectId, scope: 'export' }, async (transaction) => {
      entered(); await held;
      await transaction.query(`INSERT INTO ${effectTable}(id,workspace_id) VALUES($1,$2)`, [randomUUID(), current.workspaceId]);
    });
    await started;
    let revoked = false;
    const revoking = owner.request(`/api/identity/workspaces/${current.workspaceId}/members/${colleague.principal.userId}`, 'DELETE', { expectedAuthzVersion: granted.authzVersion }).then((response) => { revoked = true; return response; });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        waiting = !!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%identity_workspaces%' AND pid<>pg_backend_pid() LIMIT 1")).rowCount;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
      expect(revoked).toBe(false);
    } finally { release(); }
    await guarded;
    expect((await revoking).status).toBe(200);
    await expect(withWorkspaceAccess(pool, colleague.principal, { workspaceId: current.workspaceId, projectId, scope: 'export' }, effect)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(withWorkspaceAccess(pool, { kind: 'job', userId: owner.principal.userId, authzVersion: joined.authzVersion }, { workspaceId: current.workspaceId, scope: 'read' }, effect)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await pool.query(`SELECT count(*)::int AS count FROM ${effectTable} WHERE workspace_id=$1`, [current.workspaceId])).rows[0].count).toBe(1);
  });

  it('rotates expired invitations, revokes old links and rejects stale role changes', async () => {
    const current = await workspace(owner, 'Expiring synthetic invitation');
    const invitation = await invite(owner, current, colleague);
    await pool.query("UPDATE identity_invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [invitation.invitationId]);
    expect((await colleague.request(`/api/identity/invitations/${invitation.token}`)).status).toBe(404);
    const resend = await owner.request(`/api/identity/workspaces/${current.workspaceId}/invitations/${invitation.invitationId}/resend`, 'POST', { expectedAuthzVersion: invitation.authzVersion });
    expect(resend.status).toBe(200);
    const sent = InvitationMutationResultSchema.parse(await resend.json());
    const newToken = (await mailLink(colleague.email, 'invite')).pathname.split('/').at(-1)!;
    expect(newToken).not.toBe(invitation.token);
    expect((await colleague.request(`/api/identity/invitations/${invitation.token}`)).status).toBe(404);
    expect((await colleague.request(`/api/identity/invitations/${newToken}`)).status).toBe(200);
    expect((await owner.request(`/api/identity/workspaces/${current.workspaceId}/invitations/${sent.invitationId}`, 'DELETE', { expectedAuthzVersion: invitation.authzVersion })).status).toBe(409);
    const revoked = await owner.request(`/api/identity/workspaces/${current.workspaceId}/invitations/${sent.invitationId}`, 'DELETE', { expectedAuthzVersion: sent.authzVersion });
    expect(revoked.status).toBe(200);
    expect(TeamMutationResultSchema.parse(await revoked.json()).authzVersion).toBe(sent.authzVersion + 1);
    expect((await colleague.request(`/api/identity/invitations/${newToken}`)).status).toBe(404);
  });

  it('serializes competing owner removals and never leaves an active workspace ownerless', async () => {
    const current = await workspace(owner, 'Concurrent synthetic owners');
    const joined = await accept(colleague, await invite(owner, current, colleague, 'owner'));
    const responses = await Promise.all([owner, colleague].map((client) => client.request(`/api/identity/workspaces/${current.workspaceId}/members/${client.principal.userId}`, 'DELETE', { expectedAuthzVersion: joined.authzVersion })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const remaining = responses[0]!.status === 200 ? colleague : owner;
    const after = await team(remaining, current.workspaceId);
    expect(after.members.filter((member) => member.role === 'owner')).toHaveLength(1);
    expect((await remaining.request(`/api/identity/workspaces/${current.workspaceId}/members/${remaining.principal.userId}`, 'DELETE', { expectedAuthzVersion: after.workspace.authzVersion })).status).toBe(409);
    expect((await remaining.request(`/api/identity/workspaces/${current.workspaceId}/members/${remaining.principal.userId}`, 'PATCH', { role: 'editor', expectedAuthzVersion: after.workspace.authzVersion })).status).toBe(409);
  });

  it('reconciles uncertain invitation delivery without duplicating the persisted invitation', async () => {
    const current = await workspace(owner, 'Uncertain synthetic mail');
    let attempts = 0;
    const send = vi.fn(async () => { if (++attempts === 1) throw new Error('Synthetic SMTP ambiguous timeout'); });
    const service = createInvitationService({ pool, origin, secret: 'synthetic invitation delivery secret for integration only', mailer: { assertReady() {}, send } });
    const key = randomUUID();
    const body = { email: stranger.email, role: 'reviewer' as const, locale: 'ru' as const, expectedAuthzVersion: current.authzVersion };
    const uncertain = await service.create(owner.principal, current.workspaceId, key, body);
    expect(uncertain.delivery).toBe('uncertain');
    const retried = await service.create(owner.principal, current.workspaceId, key, body);
    expect(retried.invitationId).toBe(uncertain.invitationId);
    expect(retried.delivery).toBe('sent');
    await service.create(owner.principal, current.workspaceId, key, body);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await pool.query('SELECT count(*)::int AS count FROM identity_invitations WHERE workspace_id=$1', [current.workspaceId])).rows[0].count).toBe(1);
  });

  it('enforces delegated scopes, prunes invitations after demotion and makes a transfer authoritative', async () => {
    const current = await workspace(owner, 'Delegated synthetic membership');
    const joined = await accept(colleague, await invite(owner, current, colleague, 'editor'));
    const targetPath = `/api/identity/workspaces/${current.workspaceId}/members/${colleague.principal.userId}`;
    const promoted = await owner.request(targetPath, 'PATCH', { role: 'editor', scopes: ['read', 'edit', 'manage-members'], expectedAuthzVersion: joined.authzVersion });
    expect(promoted.status).toBe(200);
    const managerRevision = TeamMutationResultSchema.parse(await promoted.json()).authzVersion;
    const invitationsPath = `/api/identity/workspaces/${current.workspaceId}/invitations`;
    expect((await colleague.request(invitationsPath, 'POST', { email: stranger.email, role: 'owner', locale: 'ru', expectedAuthzVersion: managerRevision })).status).toBe(403);
    expect((await colleague.request(invitationsPath, 'POST', { email: stranger.email, role: 'reviewer', scopes: ['read', 'approve'], locale: 'ru', expectedAuthzVersion: managerRevision })).status).toBe(403);
    const delegated = await colleague.request(invitationsPath, 'POST', { email: stranger.email, role: 'editor', scopes: ['read', 'edit'], locale: 'ru', expectedAuthzVersion: managerRevision });
    expect(delegated.status).toBe(201);
    const pending = InvitationMutationResultSchema.parse(await delegated.json());
    const token = (await mailLink(stranger.email, 'invite')).pathname.split('/').at(-1)!;
    expect((await stranger.request(`/api/identity/invitations/${token}`)).status).toBe(200);
    const demoted = await owner.request(targetPath, 'PATCH', { role: 'reviewer', expectedAuthzVersion: pending.authzVersion });
    expect(demoted.status).toBe(200);
    const demotedVersion = TeamMutationResultSchema.parse(await demoted.json()).authzVersion;
    expect((await stranger.request(`/api/identity/invitations/${token}`)).status).toBe(404);
    expect((await stranger.request(`/api/identity/invitations/${token}/accept`, 'POST', {})).status).toBe(404);
    expect((await colleague.request(`/api/identity/workspaces/${current.workspaceId}/members/${owner.principal.userId}`, 'PATCH', { role: 'editor', expectedAuthzVersion: demotedVersion })).status).toBe(403);
    const transfer = await owner.request(`/api/identity/workspaces/${current.workspaceId}/transfer`, 'POST', { targetUserId: colleague.principal.userId, expectedAuthzVersion: demotedVersion });
    expect(transfer.status).toBe(200);
    const after = await team(colleague, current.workspaceId);
    expect(after.actorMembership.role).toBe('owner');
    expect(after.members.find((member) => member.userId === owner.principal.userId)?.role).toBe('editor');
    expect(after.workspace.authzVersion).toBe(demotedVersion + 1);
  });
});

describe('ownership-safe account deletion over HTTP', () => {
  it('requires all ownership choices, transfers retained work and tombstones explicitly deleted work', async () => {
    const deleting = await account();
    const originalUserId = deleting.principal.userId;
    const transferWork = await workspace(deleting, 'Retained after transfer');
    await accept(colleague, await invite(deleting, transferWork, colleague, 'editor'));
    const leaveWork = await workspace(deleting, 'Retained by another owner');
    await accept(colleague, await invite(deleting, leaveWork, colleague, 'owner'));
    const deleteWork = await workspace(deleting, 'Explicitly deleted workspace');
    await accept(colleague, await invite(deleting, deleteWork, colleague, 'reviewer'));
    const otherWork = await workspace(owner, 'Retained non-owned workspace');
    await accept(deleting, await invite(owner, otherWork, deleting, 'reviewer'));
    const preview = AccountDeletionPreviewSchema.parse(await (await deleting.request('/api/identity/account/deletion')).json());
    expect(preview.ownedWorkspaces).toHaveLength(3);
    expect(preview.otherWorkspaceCount).toBe(1);
    expect((await deleting.request('/api/identity/account/deletion', 'POST', { password, confirmation: 'DELETE_ACCOUNT', workspaces: [] })).status).toBe(409);
    const choices = preview.ownedWorkspaces.map((item) => ({ workspaceId: item.workspaceId, expectedAuthzVersion: item.authzVersion, ...(item.workspaceId === transferWork.workspaceId ? { action: 'transfer', targetUserId: colleague.principal.userId } : item.workspaceId === leaveWork.workspaceId ? { action: 'leave' } : { action: 'delete', confirmationName: item.name }) }));
    expect((await deleting.request('/api/identity/account/deletion', 'POST', { password: 'Incorrect synthetic password', confirmation: 'DELETE_ACCOUNT', workspaces: choices })).status).toBe(422);
    expect((await deleting.request('/api/identity/me')).status).toBe(200);
    const deleted = await deleting.request('/api/identity/account/deletion', 'POST', { password, confirmation: 'DELETE_ACCOUNT', workspaces: choices });
    expect(deleted.status).toBe(200);
    expect(deleting.cookies.size).toBe(0);
    const result = AccountDeletionResultSchema.parse(await deleted.json());
    expect(Date.parse(result.cleanupAfter) - Date.parse(result.requestedAt)).toBe(30 * 86400_000);
    expect((await deleting.request('/api/identity/me')).status).toBe(401);
    expect((await deleting.request('/api/identity/account/deletion', 'POST', { password, confirmation: 'DELETE_ACCOUNT', workspaces: choices })).status).toBe(401);
    expect((await team(colleague, transferWork.workspaceId)).actorMembership.role).toBe('owner');
    expect((await team(colleague, leaveWork.workspaceId)).actorMembership.role).toBe('owner');
    expect((await colleague.request(`/api/identity/workspaces/${deleteWork.workspaceId}/team`)).status).toBe(404);
    expect((await team(owner, otherWork.workspaceId)).members.map((member) => member.userId)).not.toContain(originalUserId);
    const tombstone = (await pool.query('SELECT deletion_requested_at,email,name FROM identity_users WHERE id=$1', [originalUserId])).rows[0];
    expect(tombstone.deletion_requested_at).toBeInstanceOf(Date);
    expect(tombstone.email).not.toBe(deleting.email);
    expect(tombstone.email).toBe(`deleted:${originalUserId}`);
    expect((await pool.query('SELECT count(*)::int AS count FROM identity_accounts WHERE user_id=$1', [originalUserId])).rows[0].count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM identity_sessions WHERE user_id=$1', [originalUserId])).rows[0].count).toBe(0);
    expect((await pool.query('SELECT status,cleanup_after IS NOT NULL AS retained FROM identity_workspaces WHERE id=$1', [deleteWork.workspaceId])).rows[0]).toEqual({ status: 'deletion-pending', retained: true });
    await expect(withWorkspaceAccess(pool, { kind: 'job', userId: originalUserId, authzVersion: 1 }, { workspaceId: transferWork.workspaceId, scope: 'read' }, async () => 'forbidden')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const registeredAgain = await account(deleting.email);
    expect(registeredAgain.principal.userId).not.toBe(originalUserId);
    expect(IdentityViewerSchema.parse(await (await registeredAgain.request('/api/identity/me')).json()).workspaces).toEqual([]);
  }, 90000);
});
