import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { INVITATION_TTL_SECONDS, type AccessScope, type CreateWorkspaceSchema, type MembershipRole, type RevokeMemberSchema, type TeamInvitation, type TeamResult, type TransferOwnershipSchema, type UpdateMemberSchema, type WorkspaceMembership } from '../contracts';
import { canGrant, memberActions, normalizedGrant, scopesForRole } from '../domain/policy';
import { assertAuthzVersion, identityTransaction, lockIdentityActor, lockWorkspaceAccess, type MembershipRow, type SessionPrincipal, type WorkspaceAccess } from './access';
import { IdentityError } from './http';
import { identityOperation } from './operations';

export function membershipDto(access: WorkspaceAccess): WorkspaceMembership {
  return { workspaceId: access.workspace.id, name: access.workspace.name, role: access.membership.role, scopes: access.membership.scopes, authzVersion: access.workspace.authz_version };
}
export async function incrementAuthzVersion(transaction: PoolClient, workspaceId: string): Promise<number> {
  return (await transaction.query<{ authz_version: number }>('UPDATE identity_workspaces SET authz_version=authz_version+1,updated_at=now() WHERE id=$1 RETURNING authz_version', [workspaceId])).rows[0]!.authz_version;
}
export function requireGrant(actor: MembershipRow, role: MembershipRole, requested?: readonly AccessScope[]) {
  const scopes = normalizedGrant(role, requested);
  if (!scopes) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
  if (!canGrant(actor, { role, scopes })) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
  return scopes;
}
export async function revokeInvalidInvitations(transaction: PoolClient, workspaceId: string, userId: string) {
  const member = (await transaction.query<MembershipRow>("SELECT * FROM identity_memberships WHERE workspace_id=$1 AND user_id=$2 AND state='active'", [workspaceId, userId])).rows[0];
  const pending = await transaction.query<{ id: string; role: MembershipRole; scopes: AccessScope[] }>("SELECT id,role,scopes FROM identity_invitations WHERE workspace_id=$1 AND created_by=$2 AND status='pending'", [workspaceId, userId]);
  for (const invitation of pending.rows) {
    if (!member || !canGrant(member, invitation)) await transaction.query("UPDATE identity_invitations SET status='revoked',updated_at=now() WHERE id=$1", [invitation.id]);
  }
}

export function createWorkspaceService(pool: Pool, secret: string) {
  async function list(principal: SessionPrincipal) {
    return identityTransaction(pool, async (transaction) => {
      await lockIdentityActor(transaction, principal);
      const memberships = await transaction.query<{ workspace_id: string; name: string; role: MembershipRole; scopes: AccessScope[]; authz_version: number }>("SELECT m.workspace_id,w.name,m.role,m.scopes,w.authz_version FROM identity_memberships m JOIN identity_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.state='active' AND w.status='active' ORDER BY w.created_at,w.id", [principal.userId]);
      return { workspaces: memberships.rows.map((row) => ({ workspaceId: row.workspace_id, name: row.name, role: row.role, scopes: row.scopes, authzVersion: row.authz_version })) };
    });
  }
  async function create(principal: SessionPrincipal, key: string, body: z.infer<typeof CreateWorkspaceSchema>) {
    return identityTransaction(pool, async (transaction) => {
      await lockIdentityActor(transaction, principal);
      const receipt = await identityOperation(transaction, { secret, actorId: principal.userId, kind: 'workspace:create', key, body }, async () => {
        const id = randomUUID();
        await transaction.query('INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,$2,$3)', [id, body.name, principal.userId]);
        await transaction.query('INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, principal.userId, 'owner', scopesForRole('owner')]);
        return { workspaceId: id };
      });
      return { workspace: membershipDto(await lockWorkspaceAccess(transaction, principal.userId, receipt.workspaceId)) };
    });
  }
  async function team(principal: SessionPrincipal, workspaceId: string): Promise<TeamResult> {
    return identityTransaction(pool, async (transaction) => {
      await lockIdentityActor(transaction, principal);
      const access = await lockWorkspaceAccess(transaction, principal.userId, workspaceId);
      const rows = (await transaction.query<MembershipRow & { name: string; email: string }>("SELECT m.*,u.name,u.email FROM identity_memberships m JOIN identity_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.state='active' AND u.deletion_requested_at IS NULL ORDER BY m.created_at,m.id", [workspaceId])).rows;
      const ownerCount = rows.filter((row) => row.role === 'owner').length;
      const actor = { ...access.membership, userId: principal.userId };
      const manager = actor.role === 'owner' || actor.scopes.includes('manage-members');
      const invitationRows = manager ? (await transaction.query<{ id: string; email: string; role: MembershipRole; scopes: AccessScope[]; locale: TeamInvitation['locale']; expires_at: Date; delivery_state: TeamInvitation['delivery']; expired: boolean }>("SELECT id,email,role,scopes,locale,expires_at,delivery_state,expires_at<=now() AS expired FROM identity_invitations WHERE workspace_id=$1 AND status='pending' ORDER BY created_at DESC,id", [workspaceId])).rows : [];
      return {
        workspace: { id: workspaceId, name: access.workspace.name, authzVersion: access.workspace.authz_version, createdAt: access.workspace.created_at.toISOString() },
        actorMembership: membershipDto(access),
        members: rows.map((row) => ({ userId: row.user_id, name: row.name, email: row.email, role: row.role, scopes: row.scopes, joinedAt: row.created_at.toISOString(), allowedActions: memberActions(actor, { ...row, userId: row.user_id }, ownerCount) })),
        invitations: invitationRows.map((row) => ({ id: row.id, email: row.email, role: row.role, scopes: row.scopes, locale: row.locale, expiresAt: row.expires_at.toISOString(), status: row.expired ? 'expired' : 'pending', delivery: row.delivery_state, allowedActions: { resend: canGrant(actor, row), revoke: canGrant(actor, row) } })),
        allowedActions: { invite: manager, deleteWorkspace: actor.role === 'owner', roles: !manager ? [] : actor.role === 'owner' ? ['owner', 'editor', 'reviewer'] : ['editor', 'reviewer'], scopes: manager ? actor.scopes : [], invitationTtlSeconds: INVITATION_TTL_SECONDS },
      };
    });
  }
  async function mutate(principal: SessionPrincipal, workspaceId: string, key: string, kind: string, body: { expectedAuthzVersion: number }, effect: (transaction: PoolClient, access: WorkspaceAccess) => Promise<void>) {
    return identityTransaction(pool, async (transaction) => {
      await lockIdentityActor(transaction, principal);
      const access = await lockWorkspaceAccess(transaction, principal.userId, workspaceId, true);
      return identityOperation(transaction, { secret, actorId: principal.userId, workspaceId, key, kind, body }, async () => {
        assertAuthzVersion(access, body.expectedAuthzVersion);
        await effect(transaction, access);
        return { workspaceId, authzVersion: await incrementAuthzVersion(transaction, workspaceId) };
      });
    });
  }
  async function memberContext(transaction: PoolClient, access: WorkspaceAccess, targetUserId: string) {
    const target = (await transaction.query<MembershipRow>("SELECT * FROM identity_memberships WHERE workspace_id=$1 AND user_id=$2 AND state='active'", [access.workspace.id, targetUserId])).rows[0];
    if (!target) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    const ownerCount = (await transaction.query<{ count: number }>("SELECT count(*)::int AS count FROM identity_memberships WHERE workspace_id=$1 AND role='owner' AND state='active'", [access.workspace.id])).rows[0]!.count;
    return { target, allowed: memberActions({ ...access.membership, userId: access.userId }, { ...target, userId: targetUserId }, ownerCount) };
  }
  async function updateMember(principal: SessionPrincipal, workspaceId: string, targetUserId: string, key: string, body: z.infer<typeof UpdateMemberSchema>) {
    return mutate(principal, workspaceId, key, `member:update:${targetUserId}`, body, async (transaction, access) => {
      const { allowed } = await memberContext(transaction, access, targetUserId);
      if (!allowed.update) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      if (!allowed.roles.includes(body.role)) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      const scopes = requireGrant(access.membership, body.role, body.scopes);
      await transaction.query('UPDATE identity_memberships SET role=$3,scopes=$4,updated_at=now() WHERE workspace_id=$1 AND user_id=$2', [workspaceId, targetUserId, body.role, scopes]);
      await transaction.query('UPDATE identity_project_grants SET scopes=ARRAY(SELECT unnest(scopes) INTERSECT SELECT unnest($3::text[])),updated_at=now() WHERE workspace_id=$1 AND user_id=$2', [workspaceId, targetUserId, scopes]);
      await revokeInvalidInvitations(transaction, workspaceId, targetUserId);
    });
  }
  async function revokeMember(principal: SessionPrincipal, workspaceId: string, targetUserId: string, key: string, body: z.infer<typeof RevokeMemberSchema>) {
    return mutate(principal, workspaceId, key, `member:revoke:${targetUserId}`, body, async (transaction, access) => {
      const { target, allowed } = await memberContext(transaction, access, targetUserId);
      if (!allowed.revoke) throw new IdentityError(target.role === 'owner' && access.membership.role === 'owner' ? 'CONFLICT' : 'FORBIDDEN', target.role === 'owner' && access.membership.role === 'owner' ? 'identity.errors.conflict' : 'identity.errors.forbidden');
      await transaction.query("UPDATE identity_memberships SET state='revoked',revoked_at=now(),updated_at=now() WHERE workspace_id=$1 AND user_id=$2", [workspaceId, targetUserId]);
      await transaction.query('DELETE FROM identity_project_grants WHERE workspace_id=$1 AND user_id=$2', [workspaceId, targetUserId]);
      await revokeInvalidInvitations(transaction, workspaceId, targetUserId);
    });
  }
  async function transfer(principal: SessionPrincipal, workspaceId: string, key: string, body: z.infer<typeof TransferOwnershipSchema>) {
    return mutate(principal, workspaceId, key, 'ownership:transfer', body, async (transaction, access) => {
      const { allowed } = await memberContext(transaction, access, body.targetUserId);
      if (!allowed.transfer) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      await transaction.query("UPDATE identity_memberships SET role='owner',scopes=$3,updated_at=now() WHERE workspace_id=$1 AND user_id=$2", [workspaceId, body.targetUserId, scopesForRole('owner')]);
      await transaction.query("UPDATE identity_memberships SET role='editor',scopes=$3,updated_at=now() WHERE workspace_id=$1 AND user_id=$2", [workspaceId, principal.userId, scopesForRole('editor')]);
      await transaction.query('UPDATE identity_project_grants SET scopes=ARRAY(SELECT unnest(scopes) INTERSECT SELECT unnest($3::text[])),updated_at=now() WHERE workspace_id=$1 AND user_id=$2', [workspaceId, principal.userId, scopesForRole('editor')]);
      await revokeInvalidInvitations(transaction, workspaceId, principal.userId);
    });
  }
  return { list, create, team, updateMember, revokeMember, transfer, mutate };
}
