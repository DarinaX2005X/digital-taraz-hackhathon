import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { IdSchema, InstantSchema } from '../../../contracts/primitives';
import { AuthzVersionSchema, type AccessScope } from '../../identity/contracts';
import { hasScope } from '../../identity/domain/policy';
import { assertAuthzVersion, identityTransaction, lockIdentityActor, lockProjectAccess, lockWorkspaceAccess, withWorkspaceAccess, type IdentityPrincipal, type MembershipRow, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { incrementAuthzVersion } from '../../identity/server/workspaces';
import { appendWorkspaceEvents, lockWorkspaceSnapshotCursor } from '../../artifacts/server/workspace-events';
import { readCursor } from '../../artifacts/server/service-support';
import { CreateProjectSchema, ProjectGrantResultSchema, ProjectListInputSchema, ProjectListResultSchema, ProjectResultSchema, UpdateProjectSchema, ProjectLifecycleSchema, type Project } from '../contracts';
import { SetProjectGrantSchema } from '../contracts';
export { CreateProjectSchema, ProjectSchema, ProjectResultSchema, SetProjectGrantSchema, ProjectGrantResultSchema, ProjectListInputSchema, ProjectListResultSchema } from '../contracts';
export type { Project } from '../contracts';

const ProjectPageCursorSchema = z.strictObject({ workspaceId: IdSchema, userId: IdSchema.optional(), authzVersion: AuthzVersionSchema, status: ProjectListInputSchema.shape.status, order: ProjectListInputSchema.shape.order, query: z.string().max(200), updatedAt: InstantSchema, id: IdSchema });
interface ProjectRow { id: string; workspace_id: string; title: string; goal: string | null; status: Project['status']; revision: number; created_by: string; creation_body_hash: string; created_at: Date; updated_at: Date; page_updated_at?: string }
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
  async function list(principal: IdentityPrincipal, input: z.input<typeof ProjectListInputSchema>) {
    const body = validate(ProjectListInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (transaction, access) => {
      let after: z.infer<typeof ProjectPageCursorSchema> | undefined;
      if (body.after) {
        try { after = ProjectPageCursorSchema.parse(JSON.parse(Buffer.from(body.after, 'base64url').toString('utf8'))); }
        catch { throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed'); }
        if (after.workspaceId !== body.workspaceId || after.status !== body.status || after.order !== body.order || (body.order === 'recent' && after.userId !== access.userId) || after.query !== body.query || after.authzVersion !== access.workspace.authz_version) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      }
      const cursor = await readCursor(transaction, access);
      const search = `%${body.query.replace(/[\\%_]/g, '\\$&')}%`;
      const orderColumn = body.order === 'recent' ? 'COALESCE(v.last_opened_at,p.updated_at)' : 'p.updated_at';
      const viewJoin = body.order === 'recent' ? 'LEFT JOIN workspace_project_views v ON v.workspace_id=p.workspace_id AND v.project_id=p.id AND v.user_id=$4' : '';
      const rows = (await transaction.query<ProjectRow>(`SELECT ${projectColumns.split(',').map((column) => `p.${column}`).join(',')},to_char(${orderColumn} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_updated_at FROM projects p ${viewJoin} WHERE p.workspace_id=$1 AND p.status=$2
        AND ($3::boolean OR EXISTS(SELECT 1 FROM identity_project_grants g WHERE g.workspace_id=p.workspace_id AND g.project_id=p.id AND g.user_id=$4 AND 'read'=ANY(g.scopes)))
        AND ($5='' OR p.title ILIKE $6 ESCAPE '\\' OR COALESCE(p.goal,'') ILIKE $6 ESCAPE '\\')
        AND ($7::timestamptz IS NULL OR (${orderColumn},p.id)<($7,$8::uuid)) ORDER BY ${orderColumn} DESC,p.id DESC LIMIT $9`, [body.workspaceId, body.status, access.membership.role === 'owner', access.userId, body.query, search, after?.updatedAt ?? null, after?.id ?? null, body.limit + 1])).rows;
      const page = rows.slice(0, body.limit), last = page.at(-1);
      const nextAfter = rows.length > body.limit && last ? Buffer.from(JSON.stringify({ workspaceId: body.workspaceId, userId: access.userId, authzVersion: access.workspace.authz_version, status: body.status, order: body.order, query: body.query, updatedAt: last.page_updated_at, id: last.id })).toString('base64url') : null;
      return ProjectListResultSchema.parse({ projects: page.map(projectDto), authzVersion: access.workspace.authz_version, cursor, nextAfter });
    });
  }
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
      return { project: projectDto(row), authzVersion: access.workspace.authz_version, cursor, canEdit: hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'edit') };
    });
  }

  async function readRoute(principal: IdentityPrincipal, projectId: string) {
    validate(IdSchema, projectId);
    const row = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM projects WHERE id=$1', [projectId])).rows[0];
    if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    return read(principal, row.workspace_id, projectId);
  }

  async function mutate(principal: SessionPrincipal, operationId: string, projectId: string, action: 'update' | 'archive' | 'restore', input: unknown) {
    const body = action === 'update' ? validate(UpdateProjectSchema, input) : validate(ProjectLifecycleSchema, input);
    const key = validate(IdSchema, operationId); validate(IdSchema, projectId);
    const bodyHash = digest([projectId, action, body]);
    return identityTransaction(pool, async (transaction) => {
      const workspace = await lockProjectWriter(transaction, principal, body.workspaceId);
      const access = await lockProjectAccess(transaction, workspace, { projectId, scope: 'edit' });
      const previous = (await transaction.query<{ kind: string; body_hash: string; result: unknown }>('SELECT kind,body_hash,result FROM artifact_operation_receipts WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [body.workspaceId, principal.userId, key])).rows[0];
      if (previous) {
        if (previous.kind !== 'project-update' || previous.body_hash !== bodyHash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
        const saved = ProjectResultSchema.parse(previous.result);
        return { ...saved, authzVersion: access.workspace.authz_version, cursor: await lockWorkspaceSnapshotCursor(transaction, access) };
      }
      assertAuthzVersion(access, body.expectedAuthzVersion);
      const current = (await transaction.query<ProjectRow>(`SELECT ${projectColumns} FROM projects WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [body.workspaceId, projectId])).rows[0]!;
      if (current.revision !== body.expectedRevision) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      if (current.status === 'trashed' || (action === 'update' && current.status !== 'active')) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      const update = action === 'update' ? validate(UpdateProjectSchema, input) : null;
      const status = action === 'archive' ? 'archived' : action === 'restore' ? 'active' : current.status;
      const row = (await transaction.query<ProjectRow>(`UPDATE projects SET title=$3,goal=$4,status=$5,revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${projectColumns}`, [body.workspaceId, projectId, update?.title ?? current.title, update ? update.goal : current.goal, status])).rows[0]!;
      const cursor = await appendWorkspaceEvents(transaction, access, [{ projectId, accessClass: 'internal', kind: 'project.changed', objectId: projectId, revision: row.revision, payload: {} }]);
      const result = { project: projectDto(row), authzVersion: access.workspace.authz_version, cursor, canEdit: true };
      await transaction.query("INSERT INTO artifact_operation_receipts(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,'project-update',$4,$5)", [body.workspaceId, principal.userId, key, bodyHash, JSON.stringify(result)]);
      return result;
    });
  }
  async function read(principal: IdentityPrincipal, workspaceId: string, projectId: string) {
    validate(IdSchema, workspaceId); validate(IdSchema, projectId);
    return withWorkspaceAccess(pool, principal, { workspaceId, projectId, scope: 'read' }, async (transaction, access) => {
      const cursor = await lockWorkspaceSnapshotCursor(transaction, access);
      const row = (await transaction.query<ProjectRow>(`SELECT ${projectColumns} FROM projects WHERE workspace_id=$1 AND id=$2`, [workspaceId, projectId])).rows[0]!;
      return { project: projectDto(row), authzVersion: access.workspace.authz_version, cursor, canEdit: hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'edit') };
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
  return { create, read, readRoute, list, mutate, setGrant };
}
