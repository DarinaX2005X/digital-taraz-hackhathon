import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { hasScope } from '../../identity/domain/policy';
import { lockProjectAccess, withWorkspaceAccess, type IdentityPrincipal, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError } from '../../identity/server/http';
import {
  ArtifactVersionCommentSchema,
  ArtifactVersionDecisionSchema,
  CollaborationThreadSchema,
  CreateCommentSchema,
  CreateDecisionSchema,
  ReadCollaborationSchema,
  ResolveCommentSchema,
  type ArtifactVersionComment,
  type ArtifactVersionDecision,
  type CollaborationThread,
} from '../contracts';

interface ArtifactRow { project_id: string; access_class: 'internal' | 'confidential'; status: string }
interface CommentRow {
  id: string; workspace_id: string; project_id: string; artifact_id: string; artifact_revision: number; parent_id: string | null;
  target: unknown; body: string; author_id: string; state: 'open' | 'resolved'; resolved_by: string | null;
  resolved_at: Date | null; created_at: Date; updated_at: Date;
}
interface DecisionRow {
  id: string; workspace_id: string; project_id: string; artifact_id: string; artifact_revision: number;
  decision: 'approved' | 'changes_requested'; note: string; actor_id: string; created_at: Date;
}
const commentColumns = 'id,workspace_id,project_id,artifact_id,artifact_revision,parent_id,target,body,author_id,state,resolved_by,resolved_at,created_at,updated_at';
const decisionColumns = 'id,workspace_id,project_id,artifact_id,artifact_revision,decision,note,actor_id,created_at';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function commentDto(row: CommentRow): ArtifactVersionComment {
  return ArtifactVersionCommentSchema.parse({ id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, artifactId: row.artifact_id, artifactRevision: row.artifact_revision, parentId: row.parent_id, target: row.target, body: row.body, authorId: row.author_id, state: row.state, resolvedBy: row.resolved_by, resolvedAt: row.resolved_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
}
function decisionDto(row: DecisionRow): ArtifactVersionDecision {
  return ArtifactVersionDecisionSchema.parse({ id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, artifactId: row.artifact_id, artifactRevision: row.artifact_revision, decision: row.decision, note: row.note, actorId: row.actor_id, createdAt: row.created_at.toISOString() });
}
function capability(access: WorkspaceAccess) {
  const subject = { ...access.membership, projectScopes: access.projectScopes };
  return { comment: hasScope(subject, 'read'), resolve: hasScope(subject, 'edit') || hasScope(subject, 'approve'), requestChanges: hasScope(subject, 'read'), approve: hasScope(subject, 'approve') };
}

async function artifactAccess(transaction: PoolClient, access: WorkspaceAccess, input: { projectId: string; artifactId: string; artifactRevision: number }, scope: 'read' | 'approve') {
  const artifact = (await transaction.query<ArtifactRow>('SELECT project_id,access_class,status FROM artifacts WHERE workspace_id=$1 AND id=$2', [access.workspace.id, input.artifactId])).rows[0];
  if (!artifact || artifact.project_id !== input.projectId || artifact.status === 'trashed') throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  const secured = await lockProjectAccess(transaction, access, { projectId: input.projectId, scope, confidential: artifact.access_class === 'confidential' });
  const version = await transaction.query('SELECT 1 FROM artifact_versions WHERE workspace_id=$1 AND artifact_id=$2 AND revision=$3 AND project_id=$4 FOR SHARE', [access.workspace.id, input.artifactId, input.artifactRevision, input.projectId]);
  if (!version.rowCount) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  return secured;
}

async function replay<T>(transaction: PoolClient, workspaceId: string, actorId: string, operationId: string, kind: string, hash: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const saved = (await transaction.query<{ kind: string; body_hash: string; result: unknown }>('SELECT kind,body_hash,result FROM business_continuity_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [workspaceId, actorId, operationId])).rows[0];
  if (!saved) return undefined;
  if (saved.kind !== kind || saved.body_hash !== hash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  return schema.parse(saved.result);
}
async function remember(transaction: PoolClient, workspaceId: string, actorId: string, operationId: string, kind: string, hash: string, result: unknown) {
  await transaction.query('INSERT INTO business_continuity_operations(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [workspaceId, actorId, operationId, kind, hash, JSON.stringify(result)]);
}

export function createCollaborationService(pool: Pool) {
  async function thread(principal: IdentityPrincipal, input: z.input<typeof ReadCollaborationSchema>): Promise<CollaborationThread> {
    const body = ReadCollaborationSchema.parse(input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (transaction, workspace) => {
      const access = await artifactAccess(transaction, workspace, body, 'read');
      const comments = (await transaction.query<CommentRow>(`SELECT ${commentColumns} FROM artifact_version_comments WHERE workspace_id=$1 AND artifact_id=$2 AND artifact_revision=$3 ORDER BY created_at,id`, [body.workspaceId, body.artifactId, body.artifactRevision])).rows.map(commentDto);
      const decisions = (await transaction.query<DecisionRow>(`SELECT ${decisionColumns} FROM artifact_version_decisions WHERE workspace_id=$1 AND artifact_id=$2 AND artifact_revision=$3 ORDER BY created_at,id`, [body.workspaceId, body.artifactId, body.artifactRevision])).rows.map(decisionDto);
      return CollaborationThreadSchema.parse({ artifactId: body.artifactId, artifactRevision: body.artifactRevision, comments, decisions, latestDecision: decisions.at(-1) ?? null, permissions: capability(access), authzVersion: access.workspace.authz_version });
    });
  }

  async function comment(principal: SessionPrincipal, operationId: string, input: z.input<typeof CreateCommentSchema>) {
    const body = CreateCommentSchema.parse(input), hash = digest(body);
    if (body.target.kind === 'text-selection' && digest(body.target.quote) !== body.target.quoteHash) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read', expectedAuthzVersion: body.expectedAuthzVersion }, async (transaction, workspace) => {
      const existing = await replay(transaction, body.workspaceId, workspace.userId, operationId, 'comment', hash, ArtifactVersionCommentSchema);
      if (existing) return existing;
      await artifactAccess(transaction, workspace, body, 'read');
      if (body.parentId) {
        const parent = (await transaction.query<{ project_id: string; artifact_id: string; artifact_revision: number }>('SELECT project_id,artifact_id,artifact_revision FROM artifact_version_comments WHERE workspace_id=$1 AND id=$2', [body.workspaceId, body.parentId])).rows[0];
        if (!parent || parent.project_id !== body.projectId || parent.artifact_id !== body.artifactId || parent.artifact_revision !== body.artifactRevision) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
      }
      const row = (await transaction.query<CommentRow>(`INSERT INTO artifact_version_comments(id,workspace_id,project_id,artifact_id,artifact_revision,parent_id,target,body,author_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${commentColumns}`,
      [randomUUID(), body.workspaceId, body.projectId, body.artifactId, body.artifactRevision, body.parentId, JSON.stringify(body.target), body.body, workspace.userId])).rows[0]!;
      const result = commentDto(row);
      await remember(transaction, body.workspaceId, workspace.userId, operationId, 'comment', hash, result);
      return result;
    });
  }

  async function resolve(principal: SessionPrincipal, operationId: string, commentId: string, input: z.input<typeof ResolveCommentSchema>) {
    const body = ResolveCommentSchema.parse(input), hash = digest([commentId, body]);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read', expectedAuthzVersion: body.expectedAuthzVersion }, async (transaction, workspace) => {
      const existing = await replay(transaction, body.workspaceId, workspace.userId, operationId, 'resolve', hash, ArtifactVersionCommentSchema);
      if (existing) return existing;
      const current = (await transaction.query<CommentRow>(`SELECT ${commentColumns} FROM artifact_version_comments WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [body.workspaceId, commentId])).rows[0];
      if (!current) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      const access = await artifactAccess(transaction, workspace, { projectId: current.project_id, artifactId: current.artifact_id, artifactRevision: current.artifact_revision }, 'read');
      const mayResolve = current.author_id === workspace.userId || hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'edit') || hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'approve');
      if (!mayResolve) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      const wanted = body.resolved ? 'resolved' : 'open';
      const row = current.state === wanted ? current : (await transaction.query<CommentRow>(`UPDATE artifact_version_comments SET state=$3,resolved_by=$4,resolved_at=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${commentColumns}`,
      [body.workspaceId, commentId, wanted, body.resolved ? workspace.userId : null, body.resolved ? new Date() : null])).rows[0]!;
      const result = commentDto(row);
      await remember(transaction, body.workspaceId, workspace.userId, operationId, 'resolve', hash, result);
      return result;
    });
  }

  async function decide(principal: SessionPrincipal, operationId: string, input: z.input<typeof CreateDecisionSchema>) {
    const body = CreateDecisionSchema.parse(input), hash = digest(body);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: body.decision === 'approved' ? 'approve' : 'read', expectedAuthzVersion: body.expectedAuthzVersion }, async (transaction, workspace) => {
      const existing = await replay(transaction, body.workspaceId, workspace.userId, operationId, 'decision', hash, ArtifactVersionDecisionSchema);
      if (existing) return existing;
      await artifactAccess(transaction, workspace, body, body.decision === 'approved' ? 'approve' : 'read');
      const row = (await transaction.query<DecisionRow>(`INSERT INTO artifact_version_decisions(id,workspace_id,project_id,artifact_id,artifact_revision,decision,note,actor_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${decisionColumns}`,
      [randomUUID(), body.workspaceId, body.projectId, body.artifactId, body.artifactRevision, body.decision, body.note, workspace.userId])).rows[0]!;
      const result = decisionDto(row);
      await remember(transaction, body.workspaceId, workspace.userId, operationId, 'decision', hash, result);
      return result;
    });
  }

  return { thread, comment, resolve, decide };
}

export type CollaborationService = ReturnType<typeof createCollaborationService>;
