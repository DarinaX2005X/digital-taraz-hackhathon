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
import { lockProjectAccess, withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '@/features/identity/server/access';
import { IdentityError, validate } from '@/features/identity/server/http';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { appendWorkspaceEvents, type WorkspaceEventInput } from '@/features/artifacts/server/workspace-events';

type SourceLifecycleRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  access_class: 'internal' | 'confidential';
  state: 'pending' | 'ready' | 'unavailable' | 'trashed';
  current_revision: number;
  metadata_revision: number;
  lifecycle_state: 'active' | 'archived' | 'trashed';
  restore_state: 'active' | 'archived' | null;
  source_state: 'pending' | 'ready' | 'unavailable';
  trashed_at: Date | null;
  updated_at: Date;
};

const failure = (key: string, code: 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION_FAILED' = 'CONFLICT') => new IdentityError(code, `sources.errors.${key}`);

function metadata(row: SourceLifecycleRow): LibraryItemMetadata {
  return {
    kind: 'source', id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, title: row.title,
    lifecycleState: row.lifecycle_state, metadataRevision: row.metadata_revision, contentRevision: row.current_revision,
    trashedAt: row.trashed_at?.toISOString() ?? null, restoreState: row.restore_state, updatedAt: row.updated_at.toISOString(),
  };
}

async function readSource(tx: PoolClient, workspaceId: string, sourceId: string, lock = false) {
  if (lock) await tx.query('SELECT id FROM sources WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspaceId, sourceId]);
  return (await tx.query<SourceLifecycleRow>(`SELECT s.id,s.workspace_id,s.project_id,d.title,s.access_class,s.state,s.current_revision,
    l.metadata_revision,l.lifecycle_state,l.restore_state,l.source_state,l.trashed_at,s.updated_at
    FROM sources s JOIN source_details d ON d.workspace_id=s.workspace_id AND d.source_id=s.id
    JOIN library_source_lifecycle l ON l.workspace_id=s.workspace_id AND l.source_id=s.id
    WHERE s.workspace_id=$1 AND s.id=$2`, [workspaceId, sourceId])).rows[0];
}

async function requireProject(tx: PoolClient, access: WorkspaceAccess, row: SourceLifecycleRow, projectId = row.project_id) {
  await lockProjectAccess(tx, access, { projectId, scope: 'edit', confidential: row.access_class === 'confidential' });
  const project = (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, projectId])).rows[0];
  if (project?.status !== 'active') throw failure('conflict');
}

async function duplicateSource(tx: PoolClient, access: WorkspaceAccess, row: SourceLifecycleRow, destinationProjectId: string, title: string) {
  if (!row.current_revision || row.state !== 'ready') throw failure('conflict');
  const current = (await tx.query<{
    source_version_id: string; snapshot_hash: string; upload_id: string; file_name: string; declared_size: number; media_type: string;
    format: string; options: unknown; original_key: string; byte_hash: string; byte_size: number; manifest: unknown; status: string;
  }>(`SELECT v.id AS source_version_id,v.snapshot_hash,u.id AS upload_id,u.file_name,u.declared_size,u.media_type,u.format,u.options,
      u.original_key,u.byte_hash,u.byte_size,u.manifest,u.status
    FROM source_versions v JOIN source_uploads u ON u.workspace_id=v.workspace_id AND u.source_id=v.source_id AND u.published_version_id=v.id
    WHERE v.workspace_id=$1 AND v.source_id=$2 AND v.id=(SELECT current_version_id FROM sources WHERE workspace_id=$1 AND id=$2)
      AND u.status='ready' AND u.original_key IS NOT NULL AND u.manifest IS NOT NULL`, [row.workspace_id, row.id])).rows[0];
  if (!current) throw failure('conflict');

  const sourceId = randomUUID(), versionId = randomUUID(), uploadId = randomUUID();
  await tx.query(`INSERT INTO sources(id,workspace_id,project_id,access_class,state,current_revision,current_version_id,created_by)
    VALUES($1,$2,$3,$4,'pending',0,NULL,$5)`, [sourceId, row.workspace_id, destinationProjectId, row.access_class, access.userId]);
  await tx.query('INSERT INTO source_details(source_id,workspace_id,title) VALUES($1,$2,$3)', [sourceId, row.workspace_id, title]);
  await tx.query(`INSERT INTO source_versions(id,workspace_id,source_id,revision,snapshot_hash,created_by)
    VALUES($1,$2,$3,1,$4,$5)`, [versionId, row.workspace_id, sourceId, current.snapshot_hash, access.userId]);
  const tokenHash = hashJson({ duplicate: uploadId });
  await tx.query(`INSERT INTO source_uploads(id,workspace_id,source_id,actor_id,operation_id,body_hash,expected_revision,reserved_version_id,published_version_id,
      file_name,declared_size,media_type,format,options,status,token_hash,token_expires_at,original_key,byte_hash,byte_size,manifest,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,0,$7,$7,$8,$9,$10,$11,$12,'ready',$13,now(),$14,$15,$16,$17,now(),now())`,
    [uploadId, row.workspace_id, sourceId, access.userId, randomUUID(), hashJson({ sourceId, origin: row.id }), versionId, current.file_name,
      current.declared_size, current.media_type, current.format, JSON.stringify(current.options), tokenHash, current.original_key, current.byte_hash,
      current.byte_size, JSON.stringify(current.manifest)]);
  await tx.query(`INSERT INTO source_chunks(upload_id,ordinal,hash,content)
    SELECT $1,ordinal,hash,content FROM source_chunks WHERE upload_id=$2`, [uploadId, current.upload_id]);
  await tx.query(`INSERT INTO source_pages(upload_id,page,state,run_id,diagnostics,review_revision,original_content,corrected_content,reviewed_at,reviewed_by,batch_id)
    SELECT $1,page,state,NULL,diagnostics,review_revision,original_content,corrected_content,reviewed_at,reviewed_by,NULL
    FROM source_pages WHERE upload_id=$2`, [uploadId, current.upload_id]);
  await tx.query(`UPDATE sources SET state='ready',current_revision=1,current_version_id=$3,updated_at=now()
    WHERE workspace_id=$1 AND id=$2`, [row.workspace_id, sourceId, versionId]);
  const duplicate = await readSource(tx, row.workspace_id, sourceId);
  if (!duplicate) throw failure('conflict');
  return duplicate;
}

export function createSourceLibraryLifecycleService(pool: Pool) {
  return async function mutate(principal: IdentityPrincipal, raw: LibraryLifecycleMutationRequest): Promise<LibraryLifecycleResult> {
    const request = validate(LibraryLifecycleMutationRequestSchema, raw);
    const { command } = request;
    if (command.objectKind !== 'source') throw failure('validation', 'VALIDATION_FAILED');
    const bodyHash = hashJson(request);
    return withWorkspaceAccess(pool, principal, { workspaceId: command.workspaceId, scope: 'edit', expectedAuthzVersion: command.expectedAuthzVersion }, async (tx, access) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`source-lifecycle:${command.workspaceId}:${access.userId}:${request.operationId}`]);
      const replay = (await tx.query<{ body_hash: string; result: LibraryLifecycleResult }>(`SELECT body_hash,result FROM library_lifecycle_operations
        WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3`, [command.workspaceId, access.userId, request.operationId])).rows[0];
      if (replay) {
        if (replay.body_hash !== bodyHash) throw failure('conflict');
        return LibraryLifecycleResultSchema.parse(replay.result);
      }

      const row = await readSource(tx, command.workspaceId, command.objectId, true);
      if (!row) throw failure('notFound', 'NOT_FOUND');
      await requireProject(tx, access, row);
      if (row.metadata_revision !== command.expectedMetadataRevision) throw failure('conflict');
      const previous = metadata(row);
      let changed = true;
      let next: SourceLifecycleRow;

      if (command.action === 'rename') {
        if (row.lifecycle_state === 'trashed') throw failure('conflict');
        changed = row.title !== command.title;
        if (changed) {
          await tx.query('UPDATE source_details SET title=$3 WHERE workspace_id=$1 AND source_id=$2', [row.workspace_id, row.id, command.title]);
          await tx.query('UPDATE sources SET updated_at=now() WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.id]);
        }
      } else if (command.action === 'move') {
        if (row.lifecycle_state === 'trashed') throw failure('conflict');
        await requireProject(tx, access, row, command.destinationProjectId);
        changed = row.project_id !== command.destinationProjectId;
        if (changed) await tx.query('UPDATE sources SET project_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.id, command.destinationProjectId]);
      } else if (command.action === 'duplicate') {
        if (row.lifecycle_state === 'trashed') throw failure('conflict');
        await requireProject(tx, access, row, command.destinationProjectId);
        next = await duplicateSource(tx, access, row, command.destinationProjectId, command.title);
      } else if (command.action === 'trash') {
        changed = row.lifecycle_state !== 'trashed';
        if (changed) {
          await tx.query(`UPDATE library_source_lifecycle SET metadata_revision=metadata_revision+1,lifecycle_state='trashed',restore_state=lifecycle_state,
            trashed_at=now(),updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND source_id=$2`, [row.workspace_id, row.id, access.userId]);
          await tx.query("UPDATE sources SET state='trashed',updated_at=now() WHERE workspace_id=$1 AND id=$2", [row.workspace_id, row.id]);
        }
      } else {
        changed = row.lifecycle_state === 'trashed';
        if (changed) {
          await tx.query('UPDATE sources SET state=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.id, row.source_state]);
          await tx.query(`UPDATE library_source_lifecycle SET metadata_revision=metadata_revision+1,lifecycle_state=restore_state,restore_state=NULL,
            trashed_at=NULL,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND source_id=$2`, [row.workspace_id, row.id, access.userId]);
        }
      }

      if (command.action !== 'duplicate') {
        if (changed && command.action !== 'trash' && command.action !== 'restore') {
          await tx.query(`UPDATE library_source_lifecycle SET metadata_revision=metadata_revision+1,updated_by=$3,updated_at=now()
            WHERE workspace_id=$1 AND source_id=$2`, [row.workspace_id, row.id, access.userId]);
        }
        next = (await readSource(tx, row.workspace_id, row.id))!;
      }
      const committedAt = new Date(), expiresAt = new Date(committedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const result = LibraryLifecycleResultSchema.parse({
        item: metadata(next!), previous, changed,
        receipt: { operationId: request.operationId, operation: libraryLifecycleOperation('source', command.action), bodyHash, committedAt: committedAt.toISOString(), expiresAt: expiresAt.toISOString() },
      });
      await tx.query(`INSERT INTO library_lifecycle_operations(workspace_id,actor_id,operation_id,object_kind,source_id,operation,body_hash,result,created_at,expires_at)
        VALUES($1,$2,$3,'source',$4,$5,$6,$7,$8,$9)`, [command.workspaceId, access.userId, request.operationId, row.id, result.receipt.operation, bodyHash, JSON.stringify(result), committedAt, expiresAt]);
      const event: WorkspaceEventInput = { projectId: result.item.projectId, accessClass: row.access_class, kind: 'source.changed', objectId: result.item.id, revision: result.item.metadataRevision, payload: {} };
      await appendWorkspaceEvents(tx, access, command.action === 'move' && row.project_id !== result.item.projectId ? [{ ...event, projectId: row.project_id }, event] : [event]);
      return result;
    });
  };
}
