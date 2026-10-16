import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { InitSourceUploadSchema, SourceChunkSchema, SourceListSchema, SourceManifestSchema, SourceOptionsSchema, type InitSourceUpload, type SourceFormat, type SourceManifest } from '../../../contracts/sources';
import { hasScope } from '../../identity/domain/policy';
import { withWorkspaceAccess, lockProjectAccess, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { createPendingSource, publishSourceVersion } from './source-heads';
import type { SourceChunkEmission } from './parser';
import { LocalSourceStorage, sourceHash } from './storage';
import { listSourceLibrary } from './library';
import type { SourceLibraryQuery } from '../../../contracts/sources';
import { readPinnedSource } from './pinned-source';
import { SOURCE_MEDIA, validateSourceMagic } from './source-format';

export interface UploadRow {
  id: string; workspace_id: string; source_id: string; actor_id: string; operation_id: string; body_hash: string;
  expected_revision: number; reserved_version_id: string; published_version_id: string | null;
  file_name: string; declared_size: number; media_type: string; format: SourceFormat; options: unknown;
  status: 'pending' | 'uploading' | 'uploaded' | 'processing' | 'ready' | 'partial' | 'failed' | 'cancelled';
  token_hash: string; token_expires_at: Date; lease_until: Date | null; original_key: string | null;
  byte_hash: string | null; byte_size: number | null; manifest: SourceManifest | null; error_code: string | null;
  created_at: Date; updated_at: Date;
}
interface SourceRow { id: string; workspace_id: string; project_id: string; title: string; state: string; current_revision: number; current_version_id: string | null; access_class: 'internal' | 'confidential'; metadata_revision: number; lifecycle_state: 'active' | 'archived' | 'trashed'; trashed_at: Date | null; created_at: Date; updated_at: Date }
const fail = (key: string, code: 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION_FAILED' = 'CONFLICT') => new IdentityError(code, `sources.errors.${key}`);
const uploadDto = (row: UploadRow) => ({ id: row.id, sourceId: row.source_id, versionId: row.published_version_id, status: row.status, format: row.format, fileName: row.file_name, byteSize: row.byte_size ?? row.declared_size, byteHash: row.byte_hash, manifest: row.manifest, errorCode: row.error_code, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const summaryDto = (source: SourceRow, upload: UploadRow) => ({ id: source.id, workspaceId: source.workspace_id, projectId: source.project_id, title: source.title, accessClass: source.access_class, revision: source.current_revision, currentVersionId: source.current_version_id, metadataRevision: source.metadata_revision, lifecycleState: source.lifecycle_state, trashedAt: source.trashed_at?.toISOString() ?? null, status: upload.status, format: upload.format, fileName: upload.file_name, byteSize: upload.byte_size ?? upload.declared_size, createdAt: source.created_at.toISOString(), updatedAt: source.updated_at.toISOString() });
const sourceColumns = 's.id,s.workspace_id,s.project_id,d.title,s.state,s.current_revision,s.current_version_id,s.access_class,l.metadata_revision,l.lifecycle_state,l.trashed_at,s.created_at,s.updated_at';
export const SOURCE_CHUNK_WRITE_BATCH = 4;

export async function authorizedSource(tx: PoolClient, access: WorkspaceAccess, sourceId: string, scope: 'read' | 'edit') {
  const source = (await tx.query<SourceRow>(`SELECT ${sourceColumns} FROM sources s JOIN source_details d ON d.source_id=s.id AND d.workspace_id=s.workspace_id JOIN library_source_lifecycle l ON l.workspace_id=s.workspace_id AND l.source_id=s.id WHERE s.workspace_id=$1 AND s.id=$2`, [access.workspace.id, sourceId])).rows[0];
  if (!source || source.lifecycle_state === 'trashed') throw fail('notFound', 'NOT_FOUND');
  await lockProjectAccess(tx, access, { projectId: source.project_id, scope, confidential: source.access_class === 'confidential' });
  if (scope === 'edit') {
    const project = (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [access.workspace.id, source.project_id])).rows[0];
    if (project?.status !== 'active' || source.lifecycle_state !== 'active') throw fail('conflict');
  }
  return source;
}
export async function authorizedUpload(tx: PoolClient, access: WorkspaceAccess, uploadId: string, scope: 'read' | 'edit', lock = false) {
  const upload = (await tx.query<UploadRow>(`SELECT * FROM source_uploads WHERE workspace_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [access.workspace.id, uploadId])).rows[0];
  if (!upload) throw fail('notFound', 'NOT_FOUND');
  const source = await authorizedSource(tx, access, upload.source_id, scope);
  if (scope === 'edit' && upload.actor_id !== access.userId) throw fail('notFound', 'NOT_FOUND');
  return { upload, source };
}

export function createSourceService(pool: Pool, storage = new LocalSourceStorage()) {
  const access = <T>(principal: SessionPrincipal, workspaceId: string, scope: 'read' | 'edit', effect: (tx: PoolClient, access: WorkspaceAccess) => Promise<T>) => {
    validate(IdSchema, workspaceId);
    return withWorkspaceAccess(pool, principal, { workspaceId, scope }, effect);
  };
  async function init(principal: SessionPrincipal, operationId: string, input: InitSourceUpload) {
    const body = validate(InitSourceUploadSchema, input), key = validate(IdSchema, operationId);
    if (['ttf', 'otf', 'woff'].includes(body.format) && body.size > 5 * 1024 * 1024) throw fail('font', 'VALIDATION_FAILED');
    if (/[\x00-\x1f]/.test(body.fileName)) throw fail('fileName', 'VALIDATION_FAILED');
    const bodyHash = sourceHash(JSON.stringify(body));
    return access(principal, body.workspaceId, 'edit', async (tx, auth) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`source-init:${body.workspaceId}:${principal.userId}:${key}`]);
      const previous = (await tx.query<UploadRow>('SELECT * FROM source_uploads WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3 FOR UPDATE', [body.workspaceId, principal.userId, key])).rows[0];
      if (previous && previous.body_hash !== bodyHash) throw fail('conflict');
      const sourceId = previous?.source_id ?? body.sourceId ?? randomUUID();
      if (body.sourceId || previous) {
        const source = await authorizedSource(tx, auth, sourceId, 'edit');
        if (source.project_id !== body.projectId || source.access_class !== body.accessClass) throw fail('conflict');
        if (!previous && source.current_revision !== body.expectedRevision) throw fail('conflict');
      } else {
        if (body.expectedRevision !== 0) throw fail('conflict');
        await createPendingSource(tx, auth, { sourceId, projectId: body.projectId, accessClass: body.accessClass });
        await tx.query('INSERT INTO source_details(source_id,workspace_id,title) VALUES($1,$2,$3)', [sourceId, body.workspaceId, body.title]);
      }
      if (previous && (previous.original_key || previous.status === 'cancelled' || previous.lease_until && previous.lease_until > new Date())) return { upload: uploadDto(previous), token: null };
      const localToken = randomBytes(32).toString('base64url'), expiry = new Date(Date.now() + 15 * 60_000);
      if (previous) {
        // A process may have stopped after linking verified-size bytes but before
        // recording the key. Such bytes are not an immutable original yet and
        // must not make the same idempotent upload impossible to retry.
        await storage.remove(`${body.workspaceId}/${previous.id}/original`);
        const token = await storage.uploadToken(body.workspaceId, previous.id, localToken, expiry);
        await tx.query("UPDATE source_uploads SET token_hash=$3,token_expires_at=$4,status='pending',lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2", [body.workspaceId, previous.id, sourceHash(token), expiry]);
        previous.status = 'pending'; return { upload: uploadDto(previous), token };
      }
      const uploadId = randomUUID(), token = await storage.uploadToken(body.workspaceId, uploadId, localToken, expiry);
      const row = (await tx.query<UploadRow>(`INSERT INTO source_uploads(id,workspace_id,source_id,actor_id,operation_id,body_hash,expected_revision,reserved_version_id,file_name,declared_size,media_type,format,options,token_hash,token_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [uploadId, body.workspaceId, sourceId, principal.userId, key, bodyHash, body.expectedRevision, randomUUID(), body.fileName, body.size, SOURCE_MEDIA[body.format], body.format, JSON.stringify(body.options), sourceHash(token), expiry])).rows[0]!;
      return { upload: uploadDto(row), token };
    });
  }

  async function put(principal: SessionPrincipal, workspaceId: string, uploadId: string, token: string, stream: ReadableStream<Uint8Array> | null, signal?: AbortSignal) {
    validate(IdSchema, uploadId);
    const lease = new Date(Date.now() + 5 * 60_000);
    let writtenKey: string | undefined;
    const claimed = await access(principal, workspaceId, 'edit', async (tx, auth) => {
      const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
      if (upload.status !== 'pending' || upload.token_expires_at <= new Date() || !token || !timingSafeEqual(Buffer.from(upload.token_hash, 'hex'), Buffer.from(sourceHash(token), 'hex'))) throw fail('uploadExpired');
      await tx.query("UPDATE source_uploads SET status='uploading',lease_until=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2", [workspaceId, uploadId, lease]);
      return upload;
    });
    try {
      // Vercel can expose a zero-byte ReadableStream for a bodyless request. A
      // signed R2 token means the bytes were uploaded directly, so reconciliation
      // must read that immutable object instead of attempting a second PUT.
      const uploadStream = token.startsWith('r2.v1.') ? null : stream;
      const original = await storage.write(workspaceId, uploadId, uploadStream, claimed.declared_size, signal);
      writtenKey = original.key;
      const bytes = await storage.read(original.key); validateSourceMagic(bytes, claimed.format);
      return await access(principal, workspaceId, 'edit', async (tx, auth) => {
        const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
        if (upload.status !== 'uploading' || upload.lease_until?.getTime() !== lease.getTime() || lease <= new Date()) throw fail('conflict');
        const row = (await tx.query<UploadRow>("UPDATE source_uploads SET status='uploaded',lease_until=NULL,original_key=$3,byte_hash=$4,byte_size=$5,updated_at=now(),error_code=NULL WHERE workspace_id=$1 AND id=$2 RETURNING *", [workspaceId, uploadId, original.key, original.hash, original.size])).rows[0]!;
        return { upload: uploadDto(row) };
      });
    } catch (error) {
      await pool.query("UPDATE source_uploads SET status='failed',lease_until=NULL,error_code=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='uploading' AND lease_until=$3", [workspaceId, uploadId, lease, error instanceof IdentityError ? error.messageKey : 'sources.errors.upload']);
      if (writtenKey) {
        const persisted = (await pool.query<{ original_key: string | null }>('SELECT original_key FROM source_uploads WHERE workspace_id=$1 AND id=$2', [workspaceId, uploadId])).rows[0];
        if (!persisted?.original_key) await storage.remove(writtenKey);
      }
      throw error;
    }
  }

  async function finalize(principal: SessionPrincipal, workspaceId: string, uploadId: string) {
    validate(IdSchema, uploadId);
    let lease = new Date(Date.now() + 2 * 60_000);
    const claimed = await access(principal, workspaceId, 'edit', async (tx, auth) => {
      const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
      if (upload.status === 'ready' || upload.status === 'partial') return { upload, work: false };
      if (!upload.original_key || upload.status === 'cancelled' || upload.lease_until && upload.lease_until > new Date()) throw fail('processing');
      await tx.query("UPDATE source_uploads SET status='processing',lease_until=$3,error_code=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2", [workspaceId, uploadId, lease]);
      return { upload, work: true };
    });
    if (!claimed.work) return { upload: uploadDto(claimed.upload) };
    try {
      const bytes = await storage.read(claimed.upload.original_key!);
      if (sourceHash(bytes) !== claimed.upload.byte_hash || bytes.length !== claimed.upload.byte_size) throw fail('integrity');
      await access(principal, workspaceId, 'edit', async (tx, auth) => {
        const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
        if (upload.status !== 'processing' || upload.lease_until?.getTime() !== lease.getTime() || lease <= new Date()) throw fail('conflict');
        await tx.query('DELETE FROM source_chunks WHERE upload_id=$1', [uploadId]);
      });
      const staged: SourceChunkEmission[] = [];
      const flush = async () => {
        if (!staged.length) return;
        const batch = staged.splice(0, SOURCE_CHUNK_WRITE_BATCH), nextLease = new Date(Date.now() + 2 * 60_000);
        await access(principal, workspaceId, 'edit', async (tx, auth) => {
          const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
          if (upload.status !== 'processing' || upload.lease_until?.getTime() !== lease.getTime() || lease <= new Date()) throw fail('conflict');
          await tx.query('INSERT INTO source_chunks(upload_id,ordinal,hash,content) SELECT $1,ordinal,hash,content FROM jsonb_to_recordset($2::jsonb) AS x(ordinal integer,hash text,content jsonb)', [uploadId, JSON.stringify(batch.map(({ ordinal, hash, content }) => ({ ordinal, hash, content })))]);
          await tx.query('UPDATE source_uploads SET lease_until=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [workspaceId, uploadId, nextLease]);
        });
        lease = nextLease;
      };
      const { extractSourceToSink } = await import('./parser');
      const extracted = await extractSourceToSink(bytes, claimed.upload.format, SourceOptionsSchema.parse(claimed.upload.options), async (chunk) => {
        staged.push(chunk);
        if (staged.length === SOURCE_CHUNK_WRITE_BATCH) await flush();
      });
      await flush();
      const visualAssets = extracted.manifest.complete ? await import('./visual-assets') : null;
      const visualAsset = visualAssets ? await visualAssets.prepareOriginalVisualAsset(claimed.upload, bytes) : null;
      return await access(principal, workspaceId, 'edit', async (tx, auth) => {
        const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
        if (upload.status !== 'processing' || upload.lease_until?.getTime() !== lease.getTime() || lease <= new Date()) throw fail('conflict');
        const persisted = (await tx.query<{ ordinal: number; hash: string }>('SELECT ordinal,hash FROM source_chunks WHERE upload_id=$1 ORDER BY ordinal', [uploadId])).rows;
        if (persisted.length !== extracted.manifest.chunkHashes.length || persisted.some((row, ordinal) => row.ordinal !== ordinal || row.hash !== extracted.manifest.chunkHashes[ordinal])) throw fail('integrity');
        await tx.query('DELETE FROM source_pages WHERE upload_id=$1', [uploadId]);
        if (extracted.pages.length) await tx.query('INSERT INTO source_pages(upload_id,page,state) SELECT $1,page,state FROM jsonb_to_recordset($2::jsonb) AS x(page integer,state text)', [uploadId, JSON.stringify(extracted.pages)]);
        if (extracted.manifest.complete) {
          await publishSourceVersion(tx, auth, { sourceId: upload.source_id, versionId: upload.reserved_version_id, expectedRevision: upload.expected_revision, snapshotHash: extracted.snapshotHash });
          await visualAssets!.registerOriginalVisualAsset(tx, auth, upload, visualAsset);
        }
        const row = (await tx.query<UploadRow>("UPDATE source_uploads SET status=$3,manifest=$4,published_version_id=$5,lease_until=NULL,error_code=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *", [workspaceId, uploadId, extracted.manifest.complete ? 'ready' : 'partial', JSON.stringify(extracted.manifest), extracted.manifest.complete ? upload.reserved_version_id : null])).rows[0]!;
        return { upload: uploadDto(row) };
      });
    } catch (error) {
      await pool.query(`WITH failed AS (
        UPDATE source_uploads SET status='failed',lease_until=NULL,error_code=$4,updated_at=now()
        WHERE workspace_id=$1 AND id=$2 AND status='processing' AND lease_until=$3 RETURNING id
      ) DELETE FROM source_chunks c USING failed WHERE c.upload_id=failed.id`, [workspaceId, uploadId, lease, error instanceof IdentityError ? error.messageKey : 'sources.errors.parse']);
      throw error;
    }
  }
  async function cancel(principal: SessionPrincipal, workspaceId: string, uploadId: string) {
    validate(IdSchema, uploadId);
    return access(principal, workspaceId, 'edit', async (tx, auth) => {
      const { upload } = await authorizedUpload(tx, auth, uploadId, 'edit', true);
      if (upload.status === 'ready') throw fail('conflict');
      const row = (await tx.query<UploadRow>("UPDATE source_uploads SET status='cancelled',lease_until=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *", [workspaceId, uploadId])).rows[0]!;
      return { upload: uploadDto(row) };
    });
  }
  async function list(principal: SessionPrincipal, workspaceId: string, projectId: string, limit = 30, after?: string) {
    validate(IdSchema, projectId); validate(z.number().int().min(1).max(100), limit);
    if (after) validate(IdSchema, after);
    return access(principal, workspaceId, 'read', async (tx, auth) => {
      const project = await lockProjectAccess(tx, auth, { projectId, scope: 'read' });
      const confidential = hasScope({ ...project.membership, projectScopes: project.projectScopes }, 'read-confidential');
      const rows = (await tx.query<SourceRow & { upload: UploadRow }>(`SELECT ${sourceColumns},row_to_json(u) AS upload FROM sources s JOIN source_details d ON d.workspace_id=s.workspace_id AND d.source_id=s.id JOIN library_source_lifecycle l ON l.workspace_id=s.workspace_id AND l.source_id=s.id JOIN LATERAL (SELECT * FROM source_uploads WHERE workspace_id=s.workspace_id AND source_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) u ON true WHERE s.workspace_id=$1 AND s.project_id=$2 AND l.lifecycle_state='active' AND ($3::boolean OR s.access_class<>'confidential') AND ($4::uuid IS NULL OR s.id>$4) ORDER BY s.id LIMIT $5`, [workspaceId, projectId, confidential, after ?? null, limit + 1])).rows;
      const page = rows.slice(0, limit);
      return SourceListSchema.parse({ sources: page.map((row) => summaryDto(row, { ...row.upload, created_at: new Date(row.upload.created_at), updated_at: new Date(row.upload.updated_at) })), nextCursor: rows.length > limit ? page.at(-1)!.id : null });
    });
  }
  async function read(principal: SessionPrincipal, workspaceId: string, sourceId: string, selectedUploadId?: string) {
    validate(IdSchema, sourceId); if (selectedUploadId) validate(IdSchema, selectedUploadId);
    return access(principal, workspaceId, 'read', async (tx, auth) => {
      const source = await authorizedSource(tx, auth, sourceId, 'read');
      const uploads = (await tx.query<UploadRow>('SELECT * FROM source_uploads WHERE workspace_id=$1 AND source_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100', [workspaceId, sourceId])).rows;
      if (!uploads[0]) throw fail('notFound', 'NOT_FOUND');
      if (selectedUploadId && !uploads.some((upload) => upload.id === selectedUploadId)) {
        const pinned = (await tx.query<UploadRow>('SELECT * FROM source_uploads WHERE workspace_id=$1 AND source_id=$2 AND id=$3', [workspaceId, sourceId, selectedUploadId])).rows[0];
        if (!pinned) throw fail('notFound', 'NOT_FOUND');
        if (uploads.length === 100) uploads.pop(); uploads.push(pinned);
      }
      const editable = await canEdit(tx, auth, source);
      return { source: summaryDto(source, uploads[0]), uploads: uploads.map(uploadDto), canEdit: editable, editableUploadIds: editable ? uploads.filter((upload) => upload.actor_id === auth.userId).map((upload) => upload.id) : [] };
    });
  }
  async function preview(principal: SessionPrincipal, workspaceId: string, sourceId: string, uploadId: string, ordinal = 0) {
    validate(IdSchema, sourceId); validate(IdSchema, uploadId); validate(z.number().int().min(0).max(3999), ordinal);
    return access(principal, workspaceId, 'read', async (tx, auth) => {
      const { upload } = await authorizedUpload(tx, auth, uploadId, 'read');
      if (upload.source_id !== sourceId) throw fail('notFound', 'NOT_FOUND');
      const manifest = upload.manifest && SourceManifestSchema.parse(upload.manifest);
      const row = (await tx.query<{ hash: string; content: unknown }>('SELECT hash,content FROM source_chunks WHERE upload_id=$1 AND ordinal=$2', [uploadId, ordinal])).rows[0];
      const chunk = row ? SourceChunkSchema.parse(row.content) : { fragments: [] };
      if (row && (!manifest || sourceHash(JSON.stringify(chunk)) !== row.hash || manifest.chunkHashes[ordinal] !== row.hash)) throw fail('integrity');
      return { upload: uploadDto(upload), chunk, ordinal, chunkCount: manifest?.chunkHashes.length ?? 0 };
    });
  }
  async function download(principal: SessionPrincipal, workspaceId: string, sourceId: string, uploadId: string) {
    validate(IdSchema, sourceId); validate(IdSchema, uploadId);
    const selected = await access(principal, workspaceId, 'read', async (tx, auth) => {
      const { upload } = await authorizedUpload(tx, auth, uploadId, 'read');
      if (upload.source_id !== sourceId || !upload.original_key) throw fail('notFound', 'NOT_FOUND');
      return upload;
    });
    const bytes = await storage.read(selected.original_key!);
    if (sourceHash(bytes) !== selected.byte_hash || bytes.length !== selected.byte_size) throw fail('integrity');
    // Recheck after filesystem I/O so a revoked session cannot receive buffered bytes.
    await access(principal, workspaceId, 'read', async (tx, auth) => { await authorizedUpload(tx, auth, uploadId, 'read'); });
    return { bytes, fileName: selected.file_name, mediaType: selected.media_type, sha256: selected.byte_hash! };
  }
  const listLibrary = (principal: SessionPrincipal, input: SourceLibraryQuery) => listSourceLibrary(pool, principal, input);
  const readVersion = (principal: SessionPrincipal, workspaceId: string, sourceId: string, sourceVersionId: string) => access(principal, workspaceId, 'read', (tx, auth) => readPinnedSource(tx, auth, { sourceId, sourceVersionId }));
  return { init, put, finalize, cancel, list, listLibrary, read, readVersion, preview, download };
}

async function canEdit(tx: PoolClient, auth: WorkspaceAccess, source: SourceRow) {
  try { await lockProjectAccess(tx, auth, { projectId: source.project_id, scope: 'edit', confidential: source.access_class === 'confidential' }); return (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [auth.workspace.id, source.project_id])).rows[0]?.status === 'active'; }
  catch (error) { if (error instanceof IdentityError && ['FORBIDDEN', 'NOT_FOUND'].includes(error.code)) return false; throw error; }
}
