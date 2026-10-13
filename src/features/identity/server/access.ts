import type { Pool, PoolClient } from 'pg';
import type { AccessScope, MembershipRole } from '../contracts';
import { hasScope } from '../domain/policy';
import { IdentityError } from './http';

export type SessionPrincipal = Readonly<{ kind: 'session'; userId: string; sessionId: string }>;
export type JobPrincipal = Readonly<{ kind: 'job'; userId: string; authzVersion: number }>;
export type IdentityPrincipal = SessionPrincipal | JobPrincipal;
export interface WorkspaceRow { id: string; name: string; authz_version: number; created_at: Date; status: string }
export interface MembershipRow { id: string; workspace_id: string; user_id: string; role: MembershipRole; scopes: AccessScope[]; created_at: Date; state: string }
export interface WorkspaceAccess { userId: string; workspace: WorkspaceRow; membership: MembershipRow; projectScopes?: AccessScope[] }

export async function identityTransaction<T>(pool: Pool, action: (transaction: PoolClient) => Promise<T>): Promise<T> {
  const transaction = await pool.connect();
  try {
    await transaction.query('BEGIN');
    await transaction.query("SET LOCAL lock_timeout = '10s'");
    await transaction.query("SET LOCAL statement_timeout = '20s'");
    const result = await action(transaction);
    await transaction.query('COMMIT');
    return result;
  } catch (error) {
    await transaction.query('ROLLBACK');
    throw error;
  } finally { transaction.release(); }
}

export async function lockIdentityActor(transaction: PoolClient, principal: IdentityPrincipal, exclusive = false) {
  const user = await transaction.query<{ id: string; email: string }>(`SELECT id,email FROM identity_users WHERE id=$1 AND email_verified=true AND deletion_requested_at IS NULL FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [principal.userId]);
  if (!user.rows[0]) throw new IdentityError('UNAUTHENTICATED', 'identity.errors.unauthenticated');
  if (principal.kind === 'session') {
    const session = await transaction.query('SELECT id FROM identity_sessions WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR SHARE', [principal.sessionId, principal.userId]);
    if (!session.rowCount) throw new IdentityError('UNAUTHENTICATED', 'identity.errors.unauthenticated');
  }
  return user.rows[0];
}

export async function lockWorkspaceAccess(transaction: PoolClient, userId: string, workspaceId: string, exclusive = false): Promise<WorkspaceAccess> {
  const workspace = (await transaction.query<WorkspaceRow>(`SELECT id,name,authz_version,created_at,status FROM identity_workspaces WHERE id=$1 AND status='active' FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [workspaceId])).rows[0];
  if (!workspace) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  const membership = (await transaction.query<MembershipRow>("SELECT id,workspace_id,user_id,role,scopes,created_at,state FROM identity_memberships WHERE workspace_id=$1 AND user_id=$2 AND state='active' FOR SHARE", [workspaceId, userId])).rows[0];
  if (!membership) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  return { userId, workspace, membership };
}

export function assertAuthzVersion(access: WorkspaceAccess, expected: number) {
  if (access.workspace.authz_version !== expected) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
}

export interface AccessRequest { workspaceId: string; scope: AccessScope; projectId?: string; confidential?: boolean; expectedAuthzVersion?: number }

/** The effect must be short, transaction-local database work. Never send mail,
 * render, call providers or issue remote downloads while holding these locks. */
export async function withWorkspaceAccess<T>(pool: Pool, principal: IdentityPrincipal, request: AccessRequest, effect: (transaction: PoolClient, access: WorkspaceAccess) => Promise<T>): Promise<T> {
  return identityTransaction(pool, async (transaction) => {
    await lockIdentityActor(transaction, principal);
    const access = await lockWorkspaceAccess(transaction, principal.userId, request.workspaceId);
    if (principal.kind === 'job') assertAuthzVersion(access, principal.authzVersion);
    if (request.expectedAuthzVersion !== undefined) assertAuthzVersion(access, request.expectedAuthzVersion);
    if (request.projectId !== undefined) {
      const project = (await transaction.query<{ scopes: AccessScope[] }>('SELECT scopes FROM identity_project_grants WHERE workspace_id=$1 AND project_id=$2 AND user_id=$3 FOR SHARE', [request.workspaceId, request.projectId, principal.userId])).rows[0];
      if (!project) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      access.projectScopes = project.scopes;
    }
    if (!hasScope({ ...access.membership, projectScopes: access.projectScopes, confidential: request.confidential }, request.scope)) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
    return effect(transaction, access);
  });
}
