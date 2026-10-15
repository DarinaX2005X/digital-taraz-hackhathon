import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { CollectionSchema, ImportCountsSchema, ImportMappingSchema, MaterialImportSchema, type ImportMapping, type MaterialCollection, type MaterialCell, type ImportCounts } from '@/contracts/materials';
import { IdSchema } from '@/contracts/primitives';
import { hasScope } from '@/features/identity/domain/policy';
import { lockProjectAccess, type WorkspaceAccess } from '@/features/identity/server/access';
import { IdentityError, validate } from '@/features/identity/server/http';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { appendWorkspaceEvents } from '@/features/artifacts/server/workspace-events';

export const materialError = (key: string, code: 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'FORBIDDEN' = 'CONFLICT') => new IdentityError(code, `materials.errors.${key}`);
export interface CollectionRow { id: string; workspace_id: string; project_id: string; title: string; kind: MaterialCollection['kind']; access_class: 'internal' | 'confidential'; revision: number; mapping: ImportMapping | null; record_count: number; created_by: string; created_at: Date; updated_at: Date }
export interface ImportRowDb { id: string; workspace_id: string; collection_id: string; actor_id: string; source_id: string; source_version_id: string; source_revision: number; content_hash: string; mapping: ImportMapping; mapping_hash: string; expected_revision: number; status: 'preparing' | 'preview' | 'applied' | 'cancelled' | 'failed'; next_chunk: number; chunk_count: number; header_seen: boolean; review_revision: number; counts: ImportCounts; error_code: string | null; applied_revision: number | null; created_at: Date }
export interface RecordRow { id: string; collection_id: string; identity_key: string; identity_hash: string; current_revision: number; missing: boolean; label: string; cells: Record<string, MaterialCell>; row_hash: string }
export interface StagedRow { import_id: string; ordinal: number; record_id: string; identity_key: string | null; identity_hash: string | null; label: string; cells: Record<string, MaterialCell>; row_hash: string; issues: string[]; change: 'added' | 'changed' | 'unchanged' | 'missing' | 'ambiguous'; excluded: boolean; key_override: string | null }
export const emptyCounts = (): ImportCounts => ({ added: 0, changed: 0, unchanged: 0, missing: 0, ambiguous: 0, excluded: 0, unknownCells: 0, total: 0 });
export const viewer = (access: WorkspaceAccess) => ({ userId: access.userId, workspaceId: access.workspace.id, authzVersion: access.workspace.authz_version });
export const collectionDto = (row: CollectionRow) => CollectionSchema.parse({ id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, title: row.title, kind: row.kind, accessClass: row.access_class, revision: row.revision, mapping: row.mapping, recordCount: row.record_count, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
export const importDto = (row: ImportRowDb) => MaterialImportSchema.parse({ id: row.id, collectionId: row.collection_id, sourceRef: { sourceId: row.source_id, sourceVersionId: row.source_version_id, revision: row.source_revision }, mapping: row.mapping, status: row.status, expectedRevision: row.expected_revision, nextChunk: row.next_chunk, chunkCount: row.chunk_count, counts: row.counts, errorCode: row.error_code, appliedRevision: row.applied_revision, reviewRevision: row.review_revision, createdAt: row.created_at.toISOString() });

export async function authorizedCollection(tx: PoolClient, access: WorkspaceAccess, id: string, scope: 'read' | 'edit', lock = false): Promise<CollectionRow> {
  validate(IdSchema, id);
  const metadata = (await tx.query<CollectionRow>('SELECT * FROM material_collections WHERE workspace_id=$1 AND id=$2', [access.workspace.id, id])).rows[0];
  if (!metadata) throw materialError('notFound', 'NOT_FOUND');
  await lockProjectAccess(tx, access, { projectId: metadata.project_id, scope, confidential: metadata.access_class === 'confidential' });
  const row = (await tx.query<CollectionRow>(`SELECT * FROM material_collections WHERE workspace_id=$1 AND id=$2 FOR ${lock ? 'UPDATE' : 'SHARE'}`, [access.workspace.id, id])).rows[0];
  if (!row || row.project_id !== metadata.project_id || row.access_class !== metadata.access_class) throw materialError('conflict');
  if (scope === 'edit') {
    const project = (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, row.project_id])).rows[0];
    if (project?.status !== 'active') throw materialError('archived');
  }
  if (row.mapping) row.mapping = ImportMappingSchema.parse(row.mapping);
  return row;
}
export async function authorizedImport(tx: PoolClient, access: WorkspaceAccess, id: string, scope: 'read' | 'edit', lock = false) {
  validate(IdSchema, id);
  const metadata = (await tx.query<{ collection_id: string }>('SELECT collection_id FROM material_imports WHERE workspace_id=$1 AND id=$2', [access.workspace.id, id])).rows[0];
  if (!metadata) throw materialError('notFound', 'NOT_FOUND');
  const collection = await authorizedCollection(tx, access, metadata.collection_id, scope, lock);
  const row = (await tx.query<ImportRowDb>(`SELECT * FROM material_imports WHERE workspace_id=$1 AND id=$2 FOR ${lock ? 'UPDATE' : 'SHARE'}`, [access.workspace.id, id])).rows[0];
  if (!row) throw materialError('notFound', 'NOT_FOUND');
  row.mapping = ImportMappingSchema.parse(row.mapping); row.counts = ImportCountsSchema.parse(row.counts);
  return { collection, row };
}
export function assertRevision(collection: CollectionRow, expected: number) {
  if (collection.revision !== expected) throw materialError('revision');
  if (expected >= 2147483645) throw materialError('revision');
}
export async function canCorrect(tx: PoolClient, access: WorkspaceAccess, collection: CollectionRow): Promise<boolean> {
  try {
    const project = await lockProjectAccess(tx, access, { projectId: collection.project_id, scope: 'edit', confidential: collection.access_class === 'confidential' });
    return hasScope({ ...project.membership, projectScopes: project.projectScopes, confidential: collection.access_class === 'confidential' }, 'edit') && (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, collection.project_id])).rows[0]?.status === 'active';
  } catch (error) { if (error instanceof IdentityError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return false; throw error; }
}
export async function operation<T>(tx: PoolClient, access: WorkspaceAccess, id: string, kind: string, input: JsonValue, effect: () => Promise<T>): Promise<T> {
  validate(IdSchema, id);
  const hash = hashJson(input);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`materials:${access.workspace.id}:${access.userId}:${id}`]);
  const previous = (await tx.query<{ operation: string; body_hash: string; result: T }>('SELECT operation,body_hash,result FROM material_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [access.workspace.id, access.userId, id])).rows[0];
  if (previous) { if (previous.operation !== kind || previous.body_hash !== hash) throw materialError('idempotency'); return previous.result; }
  const result = await effect();
  await tx.query('INSERT INTO material_operations(workspace_id,actor_id,operation_id,operation,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [access.workspace.id, access.userId, id, kind, hash, JSON.stringify(result)]);
  return result;
}
const CursorSchema = z.strictObject({ version: z.literal(1), scope: z.string().length(64), id: z.string(), at: z.string().optional() });
export function encodeCursor(scope: JsonValue, id: string, at?: string) { return Buffer.from(JSON.stringify({ version: 1, scope: hashJson(scope), id, ...(at ? { at } : {}) })).toString('base64url'); }
export function decodeCursor(value: string | undefined, scope: JsonValue): { id: string; at?: string } | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw materialError('cursor', 'VALIDATION_FAILED');
  try { const parsed = CursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); if (parsed.scope !== hashJson(scope)) throw new Error(); return parsed; }
  catch { throw materialError('cursor', 'VALIDATION_FAILED'); }
}
export const literalSearch = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
export async function createResolution(tx: PoolClient, access: WorkspaceAccess, collection: CollectionRow, kind: 'import' | 'correction' | 'undo', reason: string, options: { importId?: string; mappingVersionId?: string; undoOf?: string } = {}) {
  const id = randomUUID(), revision = collection.revision + 1;
  await tx.query('INSERT INTO material_resolutions(id,workspace_id,collection_id,revision,kind,reason,actor_id,import_id,mapping_version_id,undo_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, access.workspace.id, collection.id, revision, kind, reason, access.userId, options.importId ?? null, options.mappingVersionId ?? null, options.undoOf ?? null]);
  return { id, revision };
}
export async function finishResolution(tx: PoolClient, access: WorkspaceAccess, collection: CollectionRow, resolution: { id: string; revision: number }, resolutionKind: 'import' | 'correction' | 'undo', mapping?: ImportMapping) {
  const revision = resolution.revision;
  const result = await tx.query<CollectionRow>('UPDATE material_collections SET revision=$3,mapping=COALESCE($4::jsonb,mapping),record_count=(SELECT count(*) FROM material_records WHERE collection_id=$2 AND missing=false),updated_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$5 RETURNING *', [collection.workspace_id, collection.id, revision, mapping ? JSON.stringify(mapping) : null, collection.revision]);
  if (!result.rows[0]) throw materialError('revision');
  await appendWorkspaceEvents(tx, access, [{ projectId: collection.project_id, accessClass: collection.access_class, kind: 'collection.changed', objectId: collection.id, revision, payload: { resolutionId: resolution.id, resolutionKind } }]);
  return result.rows[0];
}
