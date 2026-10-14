import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { IdSchema, InstantSchema } from '../../../contracts/primitives';
import { WorkspaceCursorSchema } from '../../../contracts/events';
import { AuthzVersionSchema, ScopeListSchema, type AccessScope } from '../../identity/contracts';
import { hasScope } from '../../identity/domain/policy';
import { assertAuthzVersion, identityTransaction, lockIdentityActor, lockProjectAccess, lockWorkspaceAccess, withWorkspaceAccess, type IdentityPrincipal, type MembershipRow, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { incrementAuthzVersion } from '../../identity/server/workspaces';
import { appendWorkspaceEvents, lockWorkspaceSnapshotCursor } from '../../artifacts/server/workspace-events';

export const ProjectSchema = z.strictObject({
  id: IdSchema, workspaceId: IdSchema, title: z.string().min(1).max(240), goal: z.string().max(12000).nullable(),
  status: z.enum(['active', 'archived', 'trashed']), revision: z.number().int().positive(), createdBy: IdSchema, createdAt: InstantSchema, updatedAt: InstantSchema,
});
export const CreateProjectSchema = z.strictObject({ workspaceId: IdSchema, title: z.string().trim().min(1).max(240), goal: z.string().trim().max(12000).nullable().default(null), expectedAuthzVersion: AuthzVersionSchema });
export const ProjectResultSchema = z.strictObject({ project: ProjectSchema, authzVersion: AuthzVersionSchema, cursor: WorkspaceCursorSchema });
export const SetProjectGrantSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema, userId: IdSchema, scopes: ScopeListSchema.nullable(), expectedAuthzVersion: AuthzVersionSchema });
export const ProjectGrantResultSchema = z.strictObject({ projectId: IdSchema, userId: IdSchema, scopes: ScopeListSchema.nullable(), authzVersion: AuthzVersionSchema, cursor: WorkspaceCursorSchema });
export type Project = z.infer<typeof ProjectSchema>;
interface ProjectRow { id: string; workspace_id: string; title: string; goal: string | null; status: Project['status']; revision: number; created_by: string; creation_body_hash: string; created_at: Date; updated_at: Date }
const projectColumns = 'id,workspace_id,title,goal,status,revision,created_by,creation_body_hash,created_at,updated_at';
function projectDto(row: ProjectRow): Project {
  return { id: row.id, workspaceId: row.workspace_id, title: row.title, goal: row.goal, status: row.status, revision: row.revision, createdBy: row.created_by, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
const digest = (values: readonly unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');

async function lockProjectWriter(transaction: PoolClient, principal: SessionPrincipal, workspaceId: string): Promise<WorkspaceAccess> {
  await lockIdentityActor(transaction, principal);
  return lockWorkspaceAccess(transaction, principal.userId, workspaceId, true);
}

export function createProjectCore(pool: Pool) {
  async function create(principal: SessionPrincipal, operationId: string, input: z.input<typeof CreateProjectSchema>) {
    const body = validate(CreateProjectSchema, input);
    const key = validate(IdSchema, operationId);
    const bodyHash = digest([body.workspaceId, body.title, body.goal, body.expectedAuthzVersion]);
    return identityTransaction(pool, async (transaction) => {
      const access = await lockProjectWriter(transaction, principal, body.workspaceId);
      if (!hasScope(access.membership, 'edit')) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      const previous = (await transaction.query<ProjectRow>(`SELECT ${projectColumns} FROM projects WHERE workspace_id=$1 AND created_by=$2 AND creation_key=$3`, [body.workspaceId, principal.userId, key])).rows[0];
      if (previous) {
        await lockProjectAccess(transaction, access, { projectId: previous.id, scope: 'read' });
        if (previous.creation_body_hash !== bodyHash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
        return { project: projectDto(previous), authzVersion: access.workspace.authz_version, cursor: await lockWorkspaceSnapshotCursor(transaction, access) };
      }
      assertAuthzVersion(access, body.expectedAuthzVersion);
      const id = randomUUID();
      const row = (await transaction.query<ProjectRow>(`INSERT INTO projects(id,workspace_id,title,goal,created_by,creation_key,creation_body_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${projectColumns}`, [id, body.workspaceId, body.title, body.goal, principal.userId, key, bodyHash])).rows[0]!;
      if (access.membership.role !== 'owner') {
        await transaction.query('INSERT INTO identity_project_grants(workspace_id,project_id,user_id,scopes) VALUES($1,$2,$3,$4)', [body.workspaceId, id, principal.userId, access.membership.scopes]);
        access.workspace.authz_version = await incrementAuthzVersion(transaction, body.workspaceId);
      }
      const cursor = await appendWorkspaceEvents(transaction, access, [{ projectId: id, accessClass: 'internal', kind: 'project.created', objectId: id, revision: 1, payload: {} }]);
      return { project: projectDto(row), authzVersion: access.workspace.authz_version, cursor };
    });
  }

  async function read(principal: IdentityPrincipal, workspaceId: string, projectId: string) {
    validate(IdSchema, workspaceId); validate(IdSchema, projectId);
    return withWorkspaceAccess(pool, principal, { workspaceId, projectId, scope: 'read' }, async (transaction, access) => {
      const cursor = await lockWorkspaceSnapshotCursor(transaction, access);
      const row = (await transaction.query<ProjectRow>(`SELECT ${projectColumns} FROM projects WHERE workspace_id=$1 AND id=$2`, [workspaceId, projectId])).rows[0]!;
      return { project: projectDto(row), authzVersion: access.workspace.authz_version, cursor };
    });
  }

  async function setGrant(principal: SessionPrincipal, operationId: string, input: z.input<typeof SetProjectGrantSchema>) {
    const body = validate(SetProjectGrantSchema, input);
    const key = validate(IdSchema, operationId);
    const bodyHash = digest([body.workspaceId, body.projectId, body.userId, body.scopes, body.expectedAuthzVersion]);
    return identityTransaction(pool, async (transaction) => {
      const access = await lockProjectWriter(transaction, principal, body.workspaceId);
      const projectAccess = await lockProjectAccess(transaction, access, { projectId: body.projectId, scope: 'manage-members' });
      const target = (await transaction.query<MembershipRow>("SELECT id,workspace_id,user_id,role,scopes,created_at,state FROM identity_memberships WHERE workspace_id=$1 AND user_id=$2 AND state='active' FOR SHARE", [body.workspaceId, body.userId])).rows[0];
      if (!target) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      if (target.role === 'owner') throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
      const allowed = (scope: AccessScope) => target.scopes.includes(scope) && hasScope({ ...projectAccess.membership, projectScopes: projectAccess.projectScopes }, scope);
      if (body.scopes?.some((scope) => !allowed(scope))) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      const previous = (await transaction.query<{ kind: string; body_hash: string; result: unknown }>('SELECT kind,body_hash,result FROM artifact_operation_receipts WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [body.workspaceId, principal.userId, key])).rows[0];
      if (previous) {
        if (previous.kind !== 'project-grant' || previous.body_hash !== bodyHash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
        return ProjectGrantResultSchema.parse(previous.result);
      }
      assertAuthzVersion(access, body.expectedAuthzVersion);
      if (body.scopes === null) await transaction.query('DELETE FROM identity_project_grants WHERE workspace_id=$1 AND project_id=$2 AND user_id=$3', [body.workspaceId, body.projectId, body.userId]);
      else await transaction.query('INSERT INTO identity_project_grants(workspace_id,project_id,user_id,scopes) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET scopes=EXCLUDED.scopes,updated_at=now()', [body.workspaceId, body.projectId, body.userId, body.scopes]);
      access.workspace.authz_version = await incrementAuthzVersion(transaction, body.workspaceId);
      const cursor = await appendWorkspaceEvents(transaction, access, [{ projectId: body.projectId, accessClass: 'internal', kind: 'project.access-changed', objectId: body.projectId, revision: access.workspace.authz_version, payload: {} }]);
      const result = { projectId: body.projectId, userId: body.userId, scopes: body.scopes, authzVersion: access.workspace.authz_version, cursor };
      await transaction.query("INSERT INTO artifact_operation_receipts(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,'project-grant',$4,$5)", [body.workspaceId, principal.userId, key, bodyHash, JSON.stringify(result)]);
      return result;
    });
  }
  return { create, read, setGrant };
}
