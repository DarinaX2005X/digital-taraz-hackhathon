import type { PoolClient } from 'pg';
import { z } from 'zod';
import { SourceRefSchema, type SourceRef } from '../../../contracts/artifacts';
import { HashSchema, IdSchema } from '../../../contracts/primitives';
import { hasScope } from '../../identity/domain/policy';
import { lockProjectAccess, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { SourceFreshnessSchema, type SourceFreshness } from '../../artifacts/contracts';
import { appendWorkspaceEvents } from '../../artifacts/server/workspace-events';

const SourceRevisionSchema = z.number().int().min(0).max(2147483646);
export const CreatePendingSourceSchema = z.strictObject({ sourceId: IdSchema, projectId: IdSchema, accessClass: z.enum(['internal', 'confidential']) });
export const PublishSourceVersionSchema = z.strictObject({ sourceId: IdSchema, versionId: IdSchema, expectedRevision: SourceRevisionSchema, snapshotHash: HashSchema });
export const SourceHeadSchema = z.strictObject({ sourceId: IdSchema, state: z.enum(['pending', 'ready', 'unavailable', 'trashed']), versionId: IdSchema.nullable(), revision: SourceRevisionSchema });
export type SourceHead = z.infer<typeof SourceHeadSchema>;
interface SourceRow { id: string; project_id: string; access_class: 'internal' | 'confidential'; state: SourceHead['state']; current_version_id: string | null; current_revision: number; created_by: string }
const sourceColumns = 'id,project_id,access_class,state,current_version_id,current_revision,created_by';
const headDto = (source: SourceRow): SourceHead => ({ sourceId: source.id, state: source.state, versionId: source.current_version_id, revision: source.current_revision });

async function lockSourceWriter(transaction: PoolClient, access: WorkspaceAccess, sourceId: string): Promise<SourceRow> {
  const metadata = (await transaction.query<SourceRow>(`SELECT ${sourceColumns} FROM sources WHERE workspace_id=$1 AND id=$2`, [access.workspace.id, sourceId])).rows[0];
  if (!metadata) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  await lockProjectAccess(transaction, access, { projectId: metadata.project_id, scope: 'edit', confidential: metadata.access_class === 'confidential' });
  const source = (await transaction.query<SourceRow>(`SELECT ${sourceColumns} FROM sources WHERE workspace_id=$1 AND id=$2 AND project_id=$3 FOR UPDATE`, [access.workspace.id, sourceId, metadata.project_id])).rows[0];
  if (!source) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  // The source's class could change while waiting for its row lock.
  if (source.access_class !== metadata.access_class) await lockProjectAccess(transaction, access, { projectId: source.project_id, scope: 'edit', confidential: source.access_class === 'confidential' });
  return source;
}

/** Low-level creation used by the future upload service; it creates no ready
 * source and accepts no file bytes. Call inside the identity access transaction. */
export async function createPendingSource(transaction: PoolClient, access: WorkspaceAccess, input: z.input<typeof CreatePendingSourceSchema>): Promise<SourceHead> {
  const body = validate(CreatePendingSourceSchema, input);
  await lockProjectAccess(transaction, access, { projectId: body.projectId, scope: 'edit', confidential: body.accessClass === 'confidential' });
  const project = (await transaction.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, body.projectId])).rows[0]!;
  if (project.status !== 'active') throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  await transaction.query('INSERT INTO sources(id,workspace_id,project_id,access_class,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING', [body.sourceId, access.workspace.id, body.projectId, body.accessClass, access.userId]);
  const row = (await transaction.query<SourceRow>(`SELECT ${sourceColumns} FROM sources WHERE workspace_id=$1 AND id=$2 FOR SHARE`, [access.workspace.id, body.sourceId])).rows[0];
  if (!row || row.project_id !== body.projectId || row.access_class !== body.accessClass || row.created_by !== access.userId) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  return headDto(row);
}

/** A trusted finalized-content producer publishes the verified hash here. No
 * provider/storage I/O belongs inside this transaction, and this is not ingestion. */
export async function publishSourceVersion(transaction: PoolClient, access: WorkspaceAccess, input: z.input<typeof PublishSourceVersionSchema>): Promise<SourceHead> {
  const body = validate(PublishSourceVersionSchema, input);
  const source = await lockSourceWriter(transaction, access, body.sourceId);
  if (source.state === 'trashed') throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  const previous = (await transaction.query<{ revision: number; snapshot_hash: string; created_by: string }>('SELECT revision,snapshot_hash,created_by FROM source_versions WHERE workspace_id=$1 AND source_id=$2 AND id=$3 FOR SHARE', [access.workspace.id, body.sourceId, body.versionId])).rows[0];
  if (previous) {
    if (previous.revision !== body.expectedRevision + 1 || previous.snapshot_hash !== body.snapshotHash || previous.created_by !== access.userId) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
    return { sourceId: source.id, state: 'ready', versionId: body.versionId, revision: previous.revision };
  }
  if (source.current_revision !== body.expectedRevision) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  const inserted = await transaction.query('INSERT INTO source_versions(id,workspace_id,source_id,revision,snapshot_hash,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING', [body.versionId, access.workspace.id, body.sourceId, body.expectedRevision + 1, body.snapshotHash, access.userId]);
  if (!inserted.rowCount) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  await transaction.query("UPDATE sources SET state='ready',current_version_id=$3,current_revision=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2", [access.workspace.id, body.sourceId, body.versionId, body.expectedRevision + 1]);
  await appendWorkspaceEvents(transaction, access, [{ projectId: source.project_id, accessClass: source.access_class, kind: 'source.changed', objectId: source.id, revision: body.expectedRevision + 1, payload: {} }]);
  return { sourceId: source.id, state: 'ready', versionId: body.versionId, revision: body.expectedRevision + 1 };
}

export async function markSourceUnavailable(transaction: PoolClient, access: WorkspaceAccess, sourceId: string): Promise<SourceHead> {
  validate(IdSchema, sourceId);
  const source = await lockSourceWriter(transaction, access, sourceId);
  if (source.state === 'trashed') throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  if (source.state !== 'unavailable') {
    await transaction.query("UPDATE sources SET state='unavailable',updated_at=now() WHERE workspace_id=$1 AND id=$2", [access.workspace.id, sourceId]);
    await appendWorkspaceEvents(transaction, access, [{ projectId: source.project_id, accessClass: source.access_class, kind: 'source.unavailable', objectId: sourceId, revision: source.current_revision, payload: {} }]);
  }
  return { ...headDto(source), state: 'unavailable' };
}

/** Checks current read permission independently of freshness. Retained historical
 * versions of unavailable sources remain readable; trashed sources do not. */
export async function assertSourceReadAccess(transaction: PoolClient, access: WorkspaceAccess, input: readonly SourceRef[]): Promise<void> {
  const refs = validate(z.array(SourceRefSchema).max(1000), input);
  if (!refs.length) return;
  const missing = () => new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  const ids = [...new Set(refs.map((ref) => ref.sourceId))].sort();
  const metadata = (await transaction.query<SourceRow>(`SELECT ${sourceColumns} FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[])`, [access.workspace.id, ids])).rows;
  if (metadata.length !== ids.length) throw missing();
  const projects = new Map<string, WorkspaceAccess>();
  for (const projectId of [...new Set(metadata.map((source) => source.project_id))].sort()) {
    projects.set(projectId, await lockProjectAccess(transaction, access, { projectId, scope: 'read' }));
    const project = (await transaction.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, projectId])).rows[0];
    if (!project || project.status === 'trashed') throw missing();
  }
  const expectedProjects = new Map(metadata.map((source) => [source.id, source.project_id]));
  const sources = (await transaction.query<SourceRow>(`SELECT ${sourceColumns} FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`, [access.workspace.id, ids])).rows;
  if (sources.length !== ids.length) throw missing();
  for (const source of sources) {
    const project = projects.get(source.project_id);
    if (!project || expectedProjects.get(source.id) !== source.project_id || source.state === 'trashed') throw missing();
    if (!hasScope({ ...project.membership, projectScopes: project.projectScopes, confidential: source.access_class === 'confidential' }, 'read')) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
  }
  const versions = new Map((await transaction.query<{ id: string; source_id: string; revision: number }>('SELECT id,source_id,revision FROM source_versions WHERE workspace_id=$1 AND source_id=ANY($2::uuid[]) AND id=ANY($3::uuid[]) ORDER BY id FOR SHARE', [access.workspace.id, ids, [...new Set(refs.map((ref) => ref.sourceVersionId))].sort()])).rows.map((version) => [version.id, version]));
  for (const ref of refs) {
    const version = versions.get(ref.sourceVersionId);
    if (!version || version.source_id !== ref.sourceId || version.revision !== ref.revision) throw missing();
  }
}

/** Locks authorized heads and pinned versions in the mutation transaction. A
 * blocked fact-resolution dimension stays unknown until02.4 supplies authority. */
export async function readSourceFreshness(transaction: PoolClient, access: WorkspaceAccess, input: readonly SourceRef[]): Promise<SourceFreshness[]> {
  const refs = validate(z.array(SourceRefSchema).max(1000), input);
  if (!refs.length) return [];
  const ids = [...new Set(refs.map((ref) => ref.sourceId))].sort();
  const metadata = (await transaction.query<SourceRow>(`SELECT ${sourceColumns} FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[])`, [access.workspace.id, ids])).rows;
  const projects = new Map<string, WorkspaceAccess>();
  for (const projectId of [...new Set(metadata.map((row) => row.project_id))].sort()) {
    try { projects.set(projectId, await lockProjectAccess(transaction, access, { projectId, scope: 'read' })); }
    catch (error) {
      if (!(error instanceof IdentityError) || !['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error;
    }
  }
  const permitted = metadata.filter((source) => {
    const project = projects.get(source.project_id);
    return project && hasScope({ ...project.membership, projectScopes: project.projectScopes, confidential: source.access_class === 'confidential' }, 'read');
  }).map((source) => source.id);
  const heads = new Map((await transaction.query<SourceRow>(`SELECT ${sourceColumns} FROM sources WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`, [access.workspace.id, permitted])).rows.map((source) => [source.id, source]));
  const versions = new Map((await transaction.query<{ id: string; source_id: string; revision: number }>('SELECT id,source_id,revision FROM source_versions WHERE workspace_id=$1 AND source_id=ANY($2::uuid[]) AND id=ANY($3::uuid[]) ORDER BY id FOR SHARE', [access.workspace.id, permitted, refs.map((ref) => ref.sourceVersionId)])).rows.map((version) => [version.id, version]));
  return refs.map((ref) => {
    const unknown: SourceFreshness = { sourceRef: ref, status: 'unknown', sourceStatus: 'unknown', ...(ref.factRevision !== undefined ? { factStatus: 'unknown' as const } : {}) };
    const source = heads.get(ref.sourceId);
    const selected = versions.get(ref.sourceVersionId);
    const project = source && projects.get(source.project_id);
    if (!source || source.state !== 'ready' || !source.current_version_id || !selected || selected.source_id !== source.id || selected.revision !== ref.revision || !project) return unknown;
    if (!hasScope({ ...project.membership, projectScopes: project.projectScopes, confidential: source.access_class === 'confidential' }, 'read')) return unknown;
    const sourceStatus = source.current_version_id === ref.sourceVersionId && source.current_revision === ref.revision ? 'current' : 'stale';
    return SourceFreshnessSchema.parse({ sourceRef: ref, status: sourceStatus === 'stale' ? 'stale' : ref.factRevision === undefined ? 'current' : 'unknown', sourceStatus, ...(ref.factRevision !== undefined ? { factStatus: 'unknown' } : {}), currentVersionId: source.current_version_id, currentRevision: source.current_revision });
  });
}
