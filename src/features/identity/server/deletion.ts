import { randomUUID } from 'node:crypto';
import { verifyPassword } from 'better-auth/crypto';
import type { Pool, PoolClient } from 'pg';
import { DELETION_RETENTION_DAYS, type AccountDeletionPreview, type AccountDeletionResult, type DeleteAccount } from '../contracts';
import { scopesForRole } from '../domain/policy';
import { identityTransaction, lockIdentityActor, type MembershipRow, type SessionPrincipal, type WorkspaceRow } from './access';
import { IdentityError } from './http';
import { identityOperation } from './operations';
import { incrementAuthzVersion, revokeInvalidInvitations } from './workspaces';

interface DeletionWorkspace extends WorkspaceRow { role: MembershipRow['role'] }
interface DeletionMember { user_id: string; name: string; email: string; role: MembershipRow['role'] }
async function members(transaction: PoolClient, workspaceId: string) {
  return (await transaction.query<DeletionMember>("SELECT m.user_id,m.role,u.name,u.email FROM identity_memberships m JOIN identity_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.state='active' AND u.deletion_requested_at IS NULL ORDER BY m.created_at,m.id", [workspaceId])).rows;
}

export function createDeletionService(pool: Pool, secret: string) {
  async function preview(principal: SessionPrincipal): Promise<AccountDeletionPreview> {
    return identityTransaction(pool, async (transaction) => {
      await lockIdentityActor(transaction, principal);
      const workspaces = (await transaction.query<DeletionWorkspace>("SELECT w.*,m.role FROM identity_workspaces w JOIN identity_memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 AND m.state='active' AND w.status='active' ORDER BY w.id", [principal.userId])).rows;
      const ownedWorkspaces: AccountDeletionPreview['ownedWorkspaces'] = [];
      for (const workspace of workspaces.filter((row) => row.role === 'owner')) {
        const team = await members(transaction, workspace.id);
        ownedWorkspaces.push({ workspaceId: workspace.id, name: workspace.name, authzVersion: workspace.authz_version, memberCount: team.length, canLeave: team.filter((member) => member.role === 'owner').length > 1, transferCandidates: team.filter((member) => member.user_id !== principal.userId && member.role !== 'owner').map((member) => ({ userId: member.user_id, name: member.name, email: member.email })) });
      }
      return { ownedWorkspaces, otherWorkspaceCount: workspaces.filter((workspace) => workspace.role !== 'owner').length, retentionDays: DELETION_RETENTION_DAYS };
    });
  }
  async function remove(principal: SessionPrincipal, key: string, body: DeleteAccount): Promise<AccountDeletionResult> {
    const hash = (await pool.query<{ password: string }>("SELECT a.password FROM identity_accounts a JOIN identity_users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.provider_id='credential' AND u.deletion_requested_at IS NULL", [principal.userId])).rows[0]?.password;
    if (!hash || !await verifyPassword({ hash, password: body.password })) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.invalidPassword', { password: ['identity.errors.invalidPassword'] });
    return identityTransaction(pool, async (transaction) => {
      const actor = await lockIdentityActor(transaction, principal, true);
      const currentHash = (await transaction.query<{ password: string }>("SELECT password FROM identity_accounts WHERE user_id=$1 AND provider_id='credential' FOR SHARE", [principal.userId])).rows[0]?.password;
      if (currentHash !== hash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      return identityOperation(transaction, { secret, actorId: principal.userId, kind: 'account:delete', key, body }, async (): Promise<AccountDeletionResult> => {
        // Lock the entire affected set in a stable order, then recompute ownership.
        // A transfer completed while we waited must require a fresh user decision.
        const ids = (await transaction.query<{ id: string }>("SELECT workspace_id AS id FROM identity_memberships WHERE user_id=$1 AND state='active' UNION SELECT workspace_id AS id FROM identity_invitations WHERE created_by=$1 OR email=$2 ORDER BY id", [principal.userId, actor.email])).rows;
        const locked = new Map<string, WorkspaceRow>();
        for (const { id } of ids) {
          const row = (await transaction.query<WorkspaceRow>("SELECT id,name,authz_version,created_at,status FROM identity_workspaces WHERE id=$1 AND status='active' FOR UPDATE", [id])).rows[0];
          if (row) locked.set(id, row);
        }
        const active = (await transaction.query<MembershipRow>("SELECT m.* FROM identity_memberships m JOIN identity_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.state='active' AND w.status='active' ORDER BY m.workspace_id", [principal.userId])).rows;
        const owned = active.filter((member) => member.role === 'owner');
        if (owned.length !== body.workspaces.length || body.workspaces.some((choice) => !owned.some((member) => member.workspace_id === choice.workspaceId))) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
        for (const choice of body.workspaces) {
          const workspace = locked.get(choice.workspaceId);
          if (!workspace || workspace.authz_version !== choice.expectedAuthzVersion) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
          const team = await members(transaction, workspace.id);
          if (choice.action === 'leave' && team.filter((member) => member.role === 'owner').length < 2) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
          if (choice.action === 'transfer') {
            if (!team.some((member) => member.user_id === choice.targetUserId && member.user_id !== principal.userId && member.role !== 'owner')) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
            await transaction.query("UPDATE identity_memberships SET role='owner',scopes=$3,updated_at=now() WHERE workspace_id=$1 AND user_id=$2", [workspace.id, choice.targetUserId, scopesForRole('owner')]);
          }
          if (choice.action === 'delete') {
            if (choice.confirmationName !== workspace.name) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
            await transaction.query("UPDATE identity_workspaces SET status='deletion-pending',deletion_requested_at=now(),cleanup_after=now()+$2*interval '1 day',updated_at=now() WHERE id=$1", [workspace.id, DELETION_RETENTION_DAYS]);
            await transaction.query("UPDATE identity_memberships SET state='revoked',revoked_at=now(),updated_at=now() WHERE workspace_id=$1 AND state='active'", [workspace.id]);
            await transaction.query('DELETE FROM identity_project_grants WHERE workspace_id=$1', [workspace.id]);
            await transaction.query("UPDATE identity_invitations SET status='revoked',updated_at=now() WHERE workspace_id=$1 AND status='pending'", [workspace.id]);
          }
        }
        // A non-email tombstone cannot be pre-registered to block deletion.
        const anonymousEmail = `deleted:${principal.userId}`;
        for (const [workspaceId] of locked) {
          await transaction.query("UPDATE identity_memberships SET state='revoked',revoked_at=now(),updated_at=now() WHERE workspace_id=$1 AND user_id=$2 AND state='active'", [workspaceId, principal.userId]);
          await transaction.query('DELETE FROM identity_project_grants WHERE workspace_id=$1 AND user_id=$2', [workspaceId, principal.userId]);
          await revokeInvalidInvitations(transaction, workspaceId, principal.userId);
          await transaction.query("UPDATE identity_invitations SET email=$3,status=CASE WHEN status='pending' THEN 'revoked' ELSE status END,updated_at=now() WHERE workspace_id=$1 AND email=$2", [workspaceId, actor.email, anonymousEmail]);
          await incrementAuthzVersion(transaction, workspaceId);
        }
        await transaction.query('DELETE FROM identity_sessions WHERE user_id=$1', [principal.userId]);
        await transaction.query('DELETE FROM identity_accounts WHERE user_id=$1', [principal.userId]);
        await transaction.query('DELETE FROM identity_verifications WHERE value=$1 OR identifier=$2', [principal.userId, actor.email]);
        await transaction.query('DELETE FROM identity_intents WHERE claimed_by=$1', [principal.userId]);
        await transaction.query("UPDATE identity_users SET name='Deleted account',email=$2,email_verified=false,image=NULL,deletion_requested_at=now(),updated_at=now() WHERE id=$1", [principal.userId, anonymousEmail]);
        const requestId = randomUUID();
        const tombstone = (await transaction.query<{ requested_at: Date; cleanup_after: Date }>("INSERT INTO identity_deletion_requests(id,user_id,cleanup_after) VALUES($1,$2,now()+$3*interval '1 day') RETURNING requested_at,cleanup_after", [requestId, principal.userId, DELETION_RETENTION_DAYS])).rows[0]!;
        return { status: 'deletion-requested', requestId, requestedAt: tombstone.requested_at.toISOString(), cleanupAfter: tombstone.cleanup_after.toISOString() };
      });
    });
  }
  return { preview, remove };
}
