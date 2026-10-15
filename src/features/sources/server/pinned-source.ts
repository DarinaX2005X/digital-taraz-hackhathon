import type { PoolClient } from 'pg';
import { z } from 'zod';
import { SourceRefSchema } from '../../../contracts/artifacts';
import { IdSchema } from '../../../contracts/primitives';
import { SourceChunkSchema, SourceManifestSchema } from '../../../contracts/sources';
import { lockProjectAccess, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { sourceHash } from './storage';

const InputSchema = z.strictObject({ sourceId: IdSchema, sourceVersionId: IdSchema });
type Input = z.infer<typeof InputSchema>;
const missing = () => new IdentityError('NOT_FOUND', 'sources.errors.notFound');
const integrity = () => new IdentityError('CONFLICT', 'sources.errors.integrity');

/** Caller holds identity/workspace locks; this reader pins a published version, never the latest upload. */
export async function readPinnedSource(tx: PoolClient, access: WorkspaceAccess, raw: Input) {
  const input = validate(InputSchema, raw);
  const source = (await tx.query<{ project_id: string; access_class: 'internal' | 'confidential' }>('SELECT project_id,access_class FROM sources WHERE workspace_id=$1 AND id=$2', [access.workspace.id, input.sourceId])).rows[0];
  if (!source) throw missing();
  await lockProjectAccess(tx, access, { projectId: source.project_id, scope: 'read', confidential: source.access_class === 'confidential' });
  const row = (await tx.query<{ project_id: string; access_class: 'internal' | 'confidential'; title: string; revision: number; snapshot_hash: string; upload_id: string; byte_hash: string; manifest: unknown }>(`
    SELECT s.project_id,s.access_class,d.title,v.revision,v.snapshot_hash,u.id AS upload_id,u.byte_hash,u.manifest
    FROM source_versions v JOIN sources s ON s.workspace_id=v.workspace_id AND s.id=v.source_id
    JOIN source_details d ON d.workspace_id=s.workspace_id AND d.source_id=s.id
    JOIN source_uploads u ON u.workspace_id=v.workspace_id AND u.source_id=v.source_id AND u.published_version_id=v.id
    WHERE v.workspace_id=$1 AND v.source_id=$2 AND v.id=$3 AND s.state='ready' AND u.status='ready'
    FOR SHARE OF s,v,u,d`, [access.workspace.id, input.sourceId, input.sourceVersionId])).rows[0];
  if (!row) throw missing();
  if (row.access_class !== source.access_class || row.project_id !== source.project_id) throw integrity();
  const parsed = SourceManifestSchema.safeParse(row.manifest);
  if (!parsed.success || !parsed.data.complete || parsed.data.byteHash !== row.byte_hash || sourceHash(JSON.stringify(parsed.data)) !== row.snapshot_hash) throw integrity();
  return { sourceRef: SourceRefSchema.parse({ ...input, revision: row.revision }), projectId: row.project_id, accessClass: row.access_class, title: row.title, uploadId: row.upload_id, manifest: parsed.data, chunkCount: parsed.data.chunkHashes.length };
}

export async function readPinnedSourceChunk(tx: PoolClient, access: WorkspaceAccess, raw: Input & { ordinal: number }) {
  const input = validate(InputSchema.extend({ ordinal: z.number().int().min(0).max(3999) }), raw);
  const pinned = await readPinnedSource(tx, access, { sourceId: input.sourceId, sourceVersionId: input.sourceVersionId });
  if (input.ordinal >= pinned.chunkCount) throw missing();
  const row = (await tx.query<{ hash: string; content: unknown }>('SELECT hash,content FROM source_chunks WHERE upload_id=$1 AND ordinal=$2', [pinned.uploadId, input.ordinal])).rows[0];
  if (!row) throw integrity();
  const chunk = SourceChunkSchema.safeParse(row.content);
  if (!chunk.success || row.hash !== pinned.manifest.chunkHashes[input.ordinal] || sourceHash(JSON.stringify(chunk.data)) !== row.hash) throw integrity();
  return chunk.data;
}
