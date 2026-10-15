import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { SourceRefSchema } from '../../../contracts/artifacts';
import { IdSchema } from '../../../contracts/primitives';
import { SourceOptionsSchema } from '../../../contracts/sources';
import { withWorkspaceAccess, lockProjectAccess, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { inspectRelationships, readOfficeArchive } from './archive';
import { LocalSourceStorage, sourceHash } from './storage';
import { createSourceService } from './service';

const InputSchema = z.strictObject({ workspaceId: IdSchema, sourceId: IdSchema, uploadId: IdSchema });
type Input = z.infer<typeof InputSchema>;
interface Metadata { source_id: string; project_id: string; access_class: 'internal' | 'confidential'; published_version_id: string; revision: number; format: string; file_name: string; options: unknown }
interface AssetRow { id: string; workspace_id: string; source_id: string; source_version_id: string; upload_id: string; producer_key: string; byte_hash: string; byte_size: number; media_type: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number; storage_key: string; state: string }
const missing = () => new IdentityError('NOT_FOUND', 'sources.errors.notFound');
async function metadata(tx: PoolClient, access: WorkspaceAccess, input: Input, scope: 'read' | 'edit') {
  const row = (await tx.query<Metadata>(`SELECT u.source_id,s.project_id,s.access_class,u.published_version_id,v.revision,u.format,u.file_name,u.options FROM source_uploads u JOIN sources s ON s.workspace_id=u.workspace_id AND s.id=u.source_id JOIN source_versions v ON v.workspace_id=u.workspace_id AND v.source_id=u.source_id AND v.id=u.published_version_id WHERE u.workspace_id=$1 AND u.source_id=$2 AND u.id=$3 AND u.status='ready' AND s.state='ready'`, [input.workspaceId, input.sourceId, input.uploadId])).rows[0];
  if (!row) throw missing();
  await lockProjectAccess(tx, access, { projectId: row.project_id, scope, confidential: row.access_class === 'confidential' });
  if (scope === 'edit' && (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [input.workspaceId, row.project_id])).rows[0]?.status !== 'active') throw new IdentityError('CONFLICT', 'sources.errors.conflict');
  return row;
}

/** Document conversion reuses verified originals and the same project policy. */
export function createSourceDocumentAdapter(pool: Pool, storage = new LocalSourceStorage()) {
  const sources = createSourceService(pool, storage);
  async function read(principal: SessionPrincipal, raw: Input) {
    const input = validate(InputSchema, raw);
    const info = await withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' }, (tx, access) => metadata(tx, access, input, 'read'));
    if (info.format !== 'docx') throw new IdentityError('VALIDATION_FAILED', 'sources.errors.format');
    const original = await sources.download(principal, input.workspaceId, input.sourceId, input.uploadId);
    const archive = await readOfficeArchive(original.bytes); inspectRelationships(archive);
    return { bytes: original.bytes, fileName: original.fileName, sourceRef: SourceRefSchema.parse({ sourceId: input.sourceId, sourceVersionId: info.published_version_id, revision: info.revision }), accessClass: info.access_class, projectId: info.project_id };
  }
  async function persistImage(principal: SessionPrincipal, raw: Input & { producerKey: string; bytes: Uint8Array }) {
    const input = validate(InputSchema, { workspaceId: raw.workspaceId, sourceId: raw.sourceId, uploadId: raw.uploadId });
    const producerKey = validate(z.string().min(1).max(512), raw.producerKey), bytes = Buffer.from(raw.bytes);
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new IdentityError('PAYLOAD_TOO_LARGE', 'sources.errors.tooLarge');
    let info;
    try { info = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata(); }
    catch { throw new IdentityError('VALIDATION_FAILED', 'sources.errors.image'); }
    if (!info.width || !info.height || info.width * info.height > 20_000_000 || (info.pages ?? 1) > 1 || !['png', 'jpeg', 'webp'].includes(info.format ?? '')) throw new IdentityError('VALIDATION_FAILED', 'sources.errors.image');
    const width = info.width, height = info.height, mediaType = `image/${info.format}`, byteHash = sourceHash(bytes);
    const asset = await withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'edit' }, async (tx, access) => {
      const source = await metadata(tx, access, input, 'edit');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`source-asset:${source.published_version_id}:${producerKey}`]);
      const previous = (await tx.query<AssetRow>('SELECT * FROM source_assets WHERE workspace_id=$1 AND source_version_id=$2 AND producer_key=$3 FOR UPDATE', [input.workspaceId, source.published_version_id, producerKey])).rows[0];
      if (previous) { if (previous.byte_hash !== byteHash || previous.upload_id !== input.uploadId) throw new IdentityError('CONFLICT', 'sources.errors.conflict'); return previous; }
      const id = randomUUID();
      return (await tx.query<AssetRow>('INSERT INTO source_assets(id,workspace_id,source_id,source_version_id,upload_id,created_by,producer_key,byte_hash,byte_size,media_type,width,height,storage_key,name,license) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *', [id, input.workspaceId, input.sourceId, source.published_version_id, input.uploadId, principal.userId, producerKey, byteHash, bytes.length, mediaType, width, height, `${input.workspaceId}/${id}/original`, producerKey.slice(0, 240), JSON.stringify(SourceOptionsSchema.parse(source.options).assetLicense ?? { permission: 'unknown', canEmbed: false })])).rows[0]!;
    });
    if (asset.state !== 'ready') {
      await storage.write(input.workspaceId, asset.id, new Blob([new Uint8Array(bytes)]).stream(), bytes.length);
      await withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'edit' }, async (tx, access) => {
        await metadata(tx, access, input, 'edit');
        await tx.query("UPDATE source_assets SET state='ready' WHERE workspace_id=$1 AND id=$2 AND state='pending'", [input.workspaceId, asset.id]);
      });
    }
    return { id: asset.id, width, height, mediaType: asset.media_type };
  }
  async function resolveImage(principal: SessionPrincipal, raw: { workspaceId: string; assetId: string }) {
    const input = validate(z.strictObject({ workspaceId: IdSchema, assetId: IdSchema }), raw);
    const asset = await withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' }, async (tx, access) => {
      const row = (await tx.query<AssetRow>("SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 AND state='ready'", [input.workspaceId, input.assetId])).rows[0];
      if (!row) return null;
      const source = await metadata(tx, access, { workspaceId: input.workspaceId, sourceId: row.source_id, uploadId: row.upload_id }, 'read');
      if (source.published_version_id !== row.source_version_id) throw missing();
      return row;
    });
    if (asset) {
      const bytes = await storage.read(asset.storage_key);
      if (sourceHash(bytes) !== asset.byte_hash || bytes.length !== asset.byte_size) throw new IdentityError('CONFLICT', 'sources.errors.integrity');
      await withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' }, async (tx, access) => {
        const source = await metadata(tx, access, { workspaceId: input.workspaceId, sourceId: asset.source_id, uploadId: asset.upload_id }, 'read');
        if (source.published_version_id !== asset.source_version_id) throw missing();
      });
      return { bytes, mediaType: asset.media_type, width: asset.width, height: asset.height };
    }
    // A directly uploaded image keeps its upload ID; it needs no duplicated asset row.
    const upload = (await pool.query<{ source_id: string; format: string }>('SELECT source_id,format FROM source_uploads WHERE workspace_id=$1 AND id=$2', [input.workspaceId, input.assetId])).rows[0];
    if (!upload || !['png', 'jpeg', 'webp'].includes(upload.format)) throw missing();
    const original = await sources.download(principal, input.workspaceId, upload.source_id, input.assetId);
    const image = await sharp(original.bytes, { limitInputPixels: 20_000_000 }).metadata();
    if (!image.width || !image.height || (image.pages ?? 1) > 1) throw missing();
    return { bytes: original.bytes, mediaType: original.mediaType, width: image.width, height: image.height };
  }
  return { read, persistImage, resolveImage };
}
