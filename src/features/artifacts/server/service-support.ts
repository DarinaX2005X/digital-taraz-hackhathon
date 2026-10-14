import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ArtifactEnvelope, SourceRef } from '../../../contracts/artifacts';
import type { ConflictRef } from '../../../contracts/errors';
import type { AccessScope } from '../../identity/contracts';
import { hasScope } from '../../identity/domain/policy';
import { assertAuthzVersion, lockProjectAccess, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError } from '../../identity/server/http';
import { readSourceFreshness } from '../../sources/server/source-heads';
import { ArtifactVersionSchema, type ArtifactPermissions, type ArtifactVersion, type ArtifactViewer } from '../contracts';
import { hashJson } from '../domain/canonical';
import { collectSourceRefs } from '../domain/content-state';
import type { JsonValue } from '../domain/content-models';
import { ArtifactDraft, TargetConflictError } from '../domain/operations';
import { locateTarget, type ArtifactState } from '../domain/targets';
import { createChunkStore, lockArtifactContentShared } from './chunk-store';
import { encodeWorkspaceCursor } from './workspace-events';

export class ArtifactConflict extends IdentityError {
  constructor(public readonly conflictRefs?: ConflictRef[], public readonly currentRevision?: number, public readonly recovery: 'reload' | 'resolve-conflict' = 'resolve-conflict') { super('CONFLICT', 'artifacts.errors.conflict'); }
}
export interface ArtifactRow {
  id: string; workspace_id: string; project_id: string; kind: ArtifactEnvelope['kind']; schema_version: number; current_revision: number;
  title: string; status: ArtifactEnvelope['status']; access_class: 'internal' | 'confidential'; content_id: string; content_hash: string;
  created_by: string; created_at: Date; updated_at: Date; trashed_at: Date | null; trash_previous_status: ArtifactEnvelope['status'] | null;
}
export interface VersionRow {
  id: string; workspace_id: string; artifact_id: string; revision: number; parent_revision: number | null; content_id: string; content_hash: string; snapshot_hash: string;
  project_id: string; title: string; status: ArtifactEnvelope['status']; schema_version: number; reason: string; author_id: string; author_name?: string;
  input_revisions: Record<string, number>; created_at: Date;
}
export const artifactColumns = 'id,workspace_id,project_id,kind,schema_version,current_revision,title,status,access_class,content_id,content_hash,created_by,created_at,updated_at,trashed_at,trash_previous_status';
export const viewer = (access: WorkspaceAccess): ArtifactViewer => ({ userId: access.userId, workspaceId: access.workspace.id, authzVersion: access.workspace.authz_version });
export const notFound = () => new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
export const editableStatus = (status: ArtifactRow['status']) => !['archived', 'trashed'].includes(status);

export async function authorizeProject(tx: PoolClient, access: WorkspaceAccess, projectId: string, scope: AccessScope = 'read', confidential = false) {
  try { return await lockProjectAccess(tx, access, { projectId, scope, confidential }); }
  catch (error) { if (scope === 'read' && error instanceof IdentityError && error.code === 'FORBIDDEN') throw notFound(); throw error; }
}
export async function requireActiveProject(tx: PoolClient, access: WorkspaceAccess, projectId: string) {
  const row = (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, projectId])).rows[0];
  if (!row) throw notFound();
  if (row.status !== 'active') throw new ArtifactConflict();
}
export async function loadArtifact(tx: PoolClient, access: WorkspaceAccess, id: string, options: { scope?: AccessScope; lock?: boolean; retain?: boolean; expectedProjectId?: string } = {}): Promise<{ row: ArtifactRow; access: WorkspaceAccess }> {
  await lockArtifactContentShared(tx, access.workspace.id);
  const initial = (await tx.query<ArtifactRow>(`SELECT ${artifactColumns} FROM artifacts WHERE workspace_id=$1 AND id=$2`, [access.workspace.id, id])).rows[0];
  if (!initial || (options.expectedProjectId && initial.project_id !== options.expectedProjectId)) throw notFound();
  let authorized = await authorizeProject(tx, access, initial.project_id, 'read', initial.access_class === 'confidential');
  if (options.scope && options.scope !== 'read') authorized = await authorizeProject(tx, access, initial.project_id, options.scope, initial.access_class === 'confidential');
  if (options.retain === false && !options.lock) return { row: initial, access: authorized };
  const row = (await tx.query<ArtifactRow>(`SELECT ${artifactColumns} FROM artifacts WHERE workspace_id=$1 AND id=$2 FOR ${options.lock ? 'UPDATE' : 'SHARE'}`, [access.workspace.id, id])).rows[0];
  if (!row || (options.expectedProjectId && row.project_id !== options.expectedProjectId)) throw notFound();
  if (row.project_id !== initial.project_id || row.access_class !== initial.access_class) {
    authorized = await authorizeProject(tx, access, row.project_id, 'read', row.access_class === 'confidential');
    if (options.scope && options.scope !== 'read') authorized = await authorizeProject(tx, access, row.project_id, options.scope, row.access_class === 'confidential');
  }
  return { row, access: authorized };
}
export function assertRevision(row: ArtifactRow, expected: number) {
  if (row.current_revision !== expected) throw new ArtifactConflict([{ kind: 'artifact', objectId: row.id, reason: 'revision', expectedRevision: expected, currentRevision: row.current_revision }], row.current_revision);
}
export function assertMutationEpoch(access: WorkspaceAccess, expected: number) {
  try { assertAuthzVersion(access, expected); }
  catch { throw new ArtifactConflict(undefined, undefined, 'reload'); }
}
export async function operationLock(tx: PoolClient, workspaceId: string, operationId: string) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`artifact-operation:${workspaceId}:${operationId}`]);
}
export async function receipt<T>(tx: PoolClient, access: WorkspaceAccess, operationId: string, kind: string, bodyHash: string): Promise<T | undefined> {
  const saved = (await tx.query<{ kind: string; body_hash: string; result: T }>('SELECT kind,body_hash,result FROM artifact_operation_receipts WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [access.workspace.id, access.userId, operationId])).rows[0];
  if (!saved) return undefined;
  if (saved.kind !== kind || saved.body_hash !== bodyHash) throw new ArtifactConflict();
  return saved.result;
}
export async function saveReceipt(tx: PoolClient, access: WorkspaceAccess, operationId: string, kind: string, bodyHash: string, result: unknown) {
  await tx.query('INSERT INTO artifact_operation_receipts(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [access.workspace.id, access.userId, operationId, kind, bodyHash, JSON.stringify(result)]);
}

// This is a low watermark read before the snapshot, not a head lock. Events
// committed during materialization may replay safely; no event can be skipped.
export async function readCursor(tx: PoolClient, access: WorkspaceAccess): Promise<string> {
  const head = (await tx.query<{ cursor: string }>('SELECT cursor::text FROM workspace_event_heads WHERE workspace_id=$1', [access.workspace.id])).rows[0];
  return encodeWorkspaceCursor({ workspaceId: access.workspace.id, authzVersion: access.workspace.authz_version, position: head?.cursor ?? '0' });
}
export function envelope(row: ArtifactRow, state: ArtifactState): ArtifactEnvelope {
  return { id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, kind: row.kind, schemaVersion: row.schema_version, currentRevision: row.current_revision, title: row.title, status: row.status, contentRef: { id: row.content_id, hash: row.content_hash }, sourceRefs: collectSourceRefs(state), bindings: Object.values(state.bindings), createdBy: row.created_by, updatedAt: row.updated_at.toISOString() };
}
export function permissions(row: ArtifactRow, access: WorkspaceAccess, projectActive = true): ArtifactPermissions {
  const edit = hasScope({ ...access.membership, projectScopes: access.projectScopes, confidential: row.access_class === 'confidential' }, 'edit');
  const activeEdit = edit && projectActive;
  return { edit: activeEdit && editableStatus(row.status), rename: activeEdit && editableStatus(row.status), duplicate: activeEdit && row.status !== 'trashed', move: activeEdit && editableStatus(row.status), archive: activeEdit && editableStatus(row.status), trash: edit && row.status !== 'trashed', restore: activeEdit && ['archived', 'trashed'].includes(row.status), purge: edit && access.membership.role === 'owner' && row.status === 'trashed' };
}
export async function loadState(tx: PoolClient, row: Pick<ArtifactRow, 'workspace_id' | 'content_hash'>) {
  const store = createChunkStore(tx, row.workspace_id);
  await store.prefetch(row.content_hash);
  const state = await store.graph.materialize(row.content_hash) as unknown as ArtifactState;
  return { store, state, draft: new ArtifactDraft(store.graph, row.content_hash) };
}
export const missingTargets = (state: ArtifactState) => [...new Set([...Object.keys(state.bindings), ...Object.keys(state.locks)])].filter((id) => !locateTarget(state.index, id));
export async function loadVersion(tx: PoolClient, row: ArtifactRow, revision = row.current_revision): Promise<VersionRow> {
  const version = (await tx.query<VersionRow>('SELECT v.*,u.name AS author_name FROM artifact_versions v JOIN identity_users u ON u.id=v.author_id WHERE v.workspace_id=$1 AND v.artifact_id=$2 AND v.revision=$3', [row.workspace_id, row.id, revision])).rows[0];
  if (!version) throw notFound();
  return version;
}
export function versionDto(row: VersionRow): ArtifactVersion {
  return ArtifactVersionSchema.parse({ id: row.id, artifactId: row.artifact_id, revision: row.revision, parentRevision: row.parent_revision, contentRef: { id: row.content_id, hash: row.content_hash }, snapshotHash: row.snapshot_hash, title: row.title, reason: row.reason, authorId: row.author_id, ...(row.author_name ? { authorName: row.author_name } : {}), createdAt: row.created_at.toISOString(), inputRevisions: row.input_revisions });
}
export async function branchParent(tx: PoolClient, access: WorkspaceAccess, artifactId: string): Promise<Pick<ArtifactVersion, 'branchParent' | 'branchParentUnavailable'>> {
  const pin = (await tx.query<{ artifact_id: string; revision: number; version_id: string }>(`SELECT p.artifact_id,p.revision,v.id AS version_id FROM artifact_version_pins p JOIN artifact_versions v ON v.workspace_id=p.workspace_id AND v.artifact_id=p.artifact_id AND v.revision=p.revision WHERE p.workspace_id=$1 AND p.holding_artifact_id=$2 AND p.kind='branch' ORDER BY p.created_at,p.id LIMIT 1`, [access.workspace.id, artifactId])).rows[0];
  if (!pin) return {};
  try { await loadArtifact(tx, access, pin.artifact_id, { retain: false }); return { branchParent: { artifactId: pin.artifact_id, revision: pin.revision, versionId: pin.version_id } }; }
  catch (error) { if (error instanceof IdentityError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return { branchParentUnavailable: true }; throw error; }
}
export async function insertVersion(tx: PoolClient, access: WorkspaceAccess, row: ArtifactRow, options: { reason: string; parentRevision: number | null; inputRevisions?: Record<string, number> }): Promise<VersionRow> {
  const snapshotHash = hashJson({ artifactId: row.id, revision: row.current_revision, projectId: row.project_id, title: row.title, status: row.status, schemaVersion: row.schema_version, contentHash: row.content_hash });
  const result = await tx.query<VersionRow>(`INSERT INTO artifact_versions(id,workspace_id,artifact_id,revision,parent_revision,content_id,content_hash,snapshot_hash,project_id,title,status,schema_version,reason,author_id,input_revisions)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [randomUUID(), access.workspace.id, row.id, row.current_revision, options.parentRevision, row.content_id, row.content_hash, snapshotHash, row.project_id, row.title, row.status, row.schema_version, options.reason, access.userId, JSON.stringify(options.inputRevisions ?? {})]);
  return result.rows[0]!;
}
export async function nextVersion(tx: PoolClient, access: WorkspaceAccess, row: ArtifactRow, options: { reason: string; inputRevisions?: Record<string, number>; contentRef?: { id: string; hash: string }; title?: string; projectId?: string; status?: ArtifactRow['status']; trashPreviousStatus?: ArtifactRow['status'] | null }): Promise<{ row: ArtifactRow; version: VersionRow }> {
  const status = options.status ?? row.status;
  const result = await tx.query<ArtifactRow>(`UPDATE artifacts SET current_revision=current_revision+1,content_id=$3,content_hash=$4,title=$5,project_id=$6,status=$7,updated_at=clock_timestamp(),trashed_at=$8,trash_previous_status=$9 WHERE workspace_id=$1 AND id=$2 RETURNING ${artifactColumns}`, [access.workspace.id, row.id, options.contentRef?.id ?? row.content_id, options.contentRef?.hash ?? row.content_hash, options.title ?? row.title, options.projectId ?? row.project_id, status, status === 'trashed' ? row.trashed_at ?? new Date() : null, status === 'trashed' ? options.trashPreviousStatus ?? row.trash_previous_status : null]);
  const changed = result.rows[0]!;
  const version = await insertVersion(tx, access, changed, { reason: options.reason, parentRevision: row.current_revision, inputRevisions: options.inputRevisions });
  return { row: changed, version };
}
export async function sourceVector(tx: PoolClient, access: WorkspaceAccess, refs: SourceRef[]): Promise<Record<string, number> | null> {
  const freshness = await readSourceFreshness(tx, access, refs);
  if (freshness.some((item) => item.sourceStatus === 'unknown' || item.currentRevision === undefined)) return null;
  return Object.fromEntries(freshness.map((item) => [item.sourceRef.sourceId, item.currentRevision!]));
}
export async function assertSources(tx: PoolClient, access: WorkspaceAccess, refs: SourceRef[], expected: Record<string, number>, requireCurrent = false) {
  const freshness = await readSourceFreshness(tx, access, refs);
  const actualIds = new Set(refs.map((ref) => ref.sourceId));
  if (Object.keys(expected).length !== actualIds.size || Object.keys(expected).some((id) => !actualIds.has(id))) throw new ArtifactConflict();
  for (const item of freshness) {
    if (item.sourceStatus === 'unknown' || item.currentRevision === undefined) throw new ArtifactConflict();
    if (expected[item.sourceRef.sourceId] !== item.currentRevision || (requireCurrent && item.status !== 'current')) throw new ArtifactConflict([{ kind: 'source', objectId: item.sourceRef.sourceId, reason: 'source-changed', expectedRevision: expected[item.sourceRef.sourceId], currentRevision: item.currentRevision }]);
  }
}
export function operationBodyHash(value: unknown) { return hashJson(value as JsonValue); }
export function mapTargetConflict(error: unknown, row: ArtifactRow): never {
  if (error instanceof TargetConflictError) throw new ArtifactConflict([{ kind: 'target', objectId: row.id, targetId: error.targetId, reason: error.reason, expectedHash: error.expectedHash, currentHash: error.currentHash }], row.current_revision);
  throw error;
}
