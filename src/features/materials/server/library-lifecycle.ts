import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  LibraryLifecycleMutationRequestSchema,
  LibraryLifecycleResultSchema,
  libraryLifecycleOperation,
  type LibraryItemMetadata,
  type LibraryLifecycleMutationRequest,
  type LibraryLifecycleResult,
} from '@/contracts/library-lifecycle';
import type { MaterialCollection } from '@/contracts/materials';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { appendWorkspaceEvents, type WorkspaceEventInput } from '@/features/artifacts/server/workspace-events';
import { lockProjectAccess, withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '@/features/identity/server/access';
import { IdentityError, validate } from '@/features/identity/server/http';

type CollectionLifecycleRow = {
  id: string; workspace_id: string; project_id: string; title: string; kind: MaterialCollection['kind'];
  access_class: 'internal' | 'confidential'; revision: number; mapping: unknown; record_count: number;
  metadata_revision: number; lifecycle_state: 'active' | 'archived' | 'trashed'; restore_state: 'active' | 'archived' | null;
  trashed_at: Date | null; updated_at: Date;
};

const failure = (key: string, code: 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION_FAILED' = 'CONFLICT') => new IdentityError(code, `materials.errors.${key}`);

function metadata(row: CollectionLifecycleRow): LibraryItemMetadata {
  return {
    kind: 'collection', id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, title: row.title,
    lifecycleState: row.lifecycle_state, metadataRevision: row.metadata_revision, contentRevision: row.revision,
    trashedAt: row.trashed_at?.toISOString() ?? null, restoreState: row.restore_state, updatedAt: row.updated_at.toISOString(),
  };
}

async function readCollection(tx: PoolClient, workspaceId: string, collectionId: string, lock = false) {
  if (lock) await tx.query('SELECT id FROM material_collections WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspaceId, collectionId]);
  return (await tx.query<CollectionLifecycleRow>(`SELECT c.*,l.metadata_revision,l.lifecycle_state,l.restore_state,l.trashed_at
    FROM material_collections c JOIN library_collection_lifecycle l ON l.workspace_id=c.workspace_id AND l.collection_id=c.id
    WHERE c.workspace_id=$1 AND c.id=$2`, [workspaceId, collectionId])).rows[0];
}

async function requireProject(tx: PoolClient, access: WorkspaceAccess, row: CollectionLifecycleRow, projectId = row.project_id) {
  await lockProjectAccess(tx, access, { projectId, scope: 'edit', confidential: row.access_class === 'confidential' });
  const project = (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, projectId])).rows[0];
  if (project?.status !== 'active') throw failure('archived');
}

async function duplicateCollection(tx: PoolClient, access: WorkspaceAccess, row: CollectionLifecycleRow, destinationProjectId: string, title: string) {
  const collectionId = randomUUID(), revision = row.revision === 0 ? 0 : 1;
  await tx.query(`INSERT INTO material_collections(id,workspace_id,project_id,title,kind,access_class,revision,mapping,record_count,created_by,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [collectionId, row.workspace_id, destinationProjectId, title, row.kind, row.access_class, revision, row.mapping === null ? null : JSON.stringify(row.mapping), row.record_count, access.userId]);
  if (revision > 0) {
    const mappingVersionId = row.mapping === null ? null : randomUUID();
    if (mappingVersionId) await tx.query(`INSERT INTO material_mapping_versions(id,workspace_id,collection_id,revision,mapping,created_by)
      VALUES($1,$2,$3,1,$4,$5)`, [mappingVersionId, row.workspace_id, collectionId, JSON.stringify(row.mapping), access.userId]);
    const resolutionId = randomUUID();
    await tx.query(`INSERT INTO material_resolutions(id,workspace_id,collection_id,revision,kind,mapping_version_id,reason,actor_id)
      VALUES($1,$2,$3,1,'import',$4,$5,$6)`, [resolutionId, row.workspace_id, collectionId, mappingVersionId, 'Duplicated current snapshot', access.userId]);
    const records = (await tx.query<{ identity_hash: string; identity_key: string; missing: boolean; label: string; cells: unknown; row_hash: string }>(
      'SELECT identity_hash,identity_key,missing,label,cells,row_hash FROM material_records WHERE collection_id=$1 ORDER BY id', [row.id])).rows;
    for (const record of records) {
      const recordId = randomUUID();
      await tx.query(`INSERT INTO material_records(id,collection_id,identity_hash,identity_key,current_revision,missing,label,cells,row_hash)
        VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)`, [recordId, collectionId, record.identity_hash, record.identity_key, record.missing, record.label, JSON.stringify(record.cells), record.row_hash]);
      await tx.query(`INSERT INTO material_record_versions(id,collection_id,record_id,revision,resolution_id,missing,label,cells,row_hash)
        VALUES($1,$2,$3,1,$4,$5,$6,$7,$8)`, [randomUUID(), collectionId, recordId, resolutionId, record.missing, record.label, JSON.stringify(record.cells), record.row_hash]);
    }
  }
  const duplicate = await readCollection(tx, row.workspace_id, collectionId);
  if (!duplicate) throw failure('conflict');
  return duplicate;
}

export function createCollectionLibraryLifecycleService(pool: Pool) {
  return async function mutate(principal: IdentityPrincipal, raw: LibraryLifecycleMutationRequest): Promise<LibraryLifecycleResult> {
    const request = validate(LibraryLifecycleMutationRequestSchema, raw);
    const { command } = request;
    if (command.objectKind !== 'collection') throw failure('validation', 'VALIDATION_FAILED');
    const bodyHash = hashJson(request);
    return withWorkspaceAccess(pool, principal, { workspaceId: command.workspaceId, scope: 'edit', expectedAuthzVersion: command.expectedAuthzVersion }, async (tx, access) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collection-lifecycle:${command.workspaceId}:${access.userId}:${request.operationId}`]);
      const replay = (await tx.query<{ body_hash: string; result: LibraryLifecycleResult }>(`SELECT body_hash,result FROM library_lifecycle_operations
        WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3`, [command.workspaceId, access.userId, request.operationId])).rows[0];
      if (replay) {
        if (replay.body_hash !== bodyHash) throw failure('conflict');
        return LibraryLifecycleResultSchema.parse(replay.result);
      }
      const row = await readCollection(tx, command.workspaceId, command.objectId, true);
      if (!row) throw failure('notFound', 'NOT_FOUND');
      await requireProject(tx, access, row);
      if (row.metadata_revision !== command.expectedMetadataRevision) throw failure('revision');
      const previous = metadata(row);
      let changed = true;
      let next: CollectionLifecycleRow;

      if (command.action === 'rename') {
        if (row.lifecycle_state === 'trashed') throw failure('conflict');
        changed = row.title !== command.title;
        if (changed) await tx.query('UPDATE material_collections SET title=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.id, command.title]);
      } else if (command.action === 'move') {
        if (row.lifecycle_state === 'trashed') throw failure('conflict');
        await requireProject(tx, access, row, command.destinationProjectId);
        changed = row.project_id !== command.destinationProjectId;
        if (changed) await tx.query('UPDATE material_collections SET project_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.id, command.destinationProjectId]);
      } else if (command.action === 'duplicate') {
        if (row.lifecycle_state === 'trashed') throw failure('conflict');
        await requireProject(tx, access, row, command.destinationProjectId);
        next = await duplicateCollection(tx, access, row, command.destinationProjectId, command.title);
      } else if (command.action === 'trash') {
        changed = row.lifecycle_state !== 'trashed';
        if (changed) {
          await tx.query(`UPDATE library_collection_lifecycle SET metadata_revision=metadata_revision+1,lifecycle_state='trashed',restore_state=lifecycle_state,
            trashed_at=now(),updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND collection_id=$2`, [row.workspace_id, row.id, access.userId]);
          await tx.query('UPDATE material_collections SET updated_at=now() WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.id]);
        }
      } else {
        changed = row.lifecycle_state === 'trashed';
        if (changed) {
          await tx.query(`UPDATE library_collection_lifecycle SET metadata_revision=metadata_revision+1,lifecycle_state=restore_state,restore_state=NULL,
            trashed_at=NULL,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND collection_id=$2`, [row.workspace_id, row.id, access.userId]);
          await tx.query('UPDATE material_collections SET updated_at=now() WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.id]);
        }
      }
      if (command.action !== 'duplicate') {
        if (changed && command.action !== 'trash' && command.action !== 'restore') await tx.query(`UPDATE library_collection_lifecycle
          SET metadata_revision=metadata_revision+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND collection_id=$2`, [row.workspace_id, row.id, access.userId]);
        next = (await readCollection(tx, row.workspace_id, row.id))!;
      }
      const committedAt = new Date(), expiresAt = new Date(committedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const result = LibraryLifecycleResultSchema.parse({
        item: metadata(next!), previous, changed,
        receipt: { operationId: request.operationId, operation: libraryLifecycleOperation('collection', command.action), bodyHash, committedAt: committedAt.toISOString(), expiresAt: expiresAt.toISOString() },
      });
      await tx.query(`INSERT INTO library_lifecycle_operations(workspace_id,actor_id,operation_id,object_kind,collection_id,operation,body_hash,result,created_at,expires_at)
        VALUES($1,$2,$3,'collection',$4,$5,$6,$7,$8,$9)`, [command.workspaceId, access.userId, request.operationId, row.id, result.receipt.operation, bodyHash, JSON.stringify(result), committedAt, expiresAt]);
      const event: WorkspaceEventInput = { projectId: result.item.projectId, accessClass: row.access_class, kind: 'collection.changed', objectId: result.item.id, revision: result.item.metadataRevision, payload: {} };
      await appendWorkspaceEvents(tx, access, command.action === 'move' && row.project_id !== result.item.projectId ? [{ ...event, projectId: row.project_id }, event] : [event]);
      return result;
    });
  };
}
