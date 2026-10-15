import type { Pool, PoolClient } from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { SourceAssetLicenseSchema, SourceFontMetadataSchema, SourceOptionsSchema, SourceVisualAssetListSchema, SourceVisualAssetQuerySchema, SourceVisualAssetSchema, type SourceAssetLicense, type SourceFontMetadata, type SourceVisualAssetQuery } from '../../../contracts/sources';
import { hasScope } from '../../identity/domain/policy';
import { lockProjectAccess, withWorkspaceAccess, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { readPinnedSource } from './pinned-source';
import { inspectSourceFont } from './font';
import type { UploadRow } from './service';
import { LocalSourceStorage, sourceHash } from './storage';

interface AssetRow { id: string; workspace_id: string; source_id: string; source_version_id: string; upload_id: string; name: string; kind: 'image' | 'font'; byte_hash: string; byte_size: number; media_type: string; width: number | null; height: number | null; font_metadata: SourceFontMetadata | null; license: SourceAssetLicense; storage_key: string }
const missing = () => new IdentityError('NOT_FOUND', 'sources.errors.notFound');
const unknownLicense: SourceAssetLicense = { permission: 'unknown', canEmbed: false };
const dto = (row: AssetRow) => SourceVisualAssetSchema.parse({ id: row.id, sourceId: row.source_id, sourceVersionId: row.source_version_id, name: row.name, kind: row.kind, mediaType: row.media_type, sha256: row.byte_hash, byteSize: row.byte_size, width: row.width, height: row.height, font: row.font_metadata ? { family: row.font_metadata.family, subfamily: row.font_metadata.subfamily, postscriptName: row.font_metadata.postscriptName, unitsPerEm: row.font_metadata.unitsPerEm, embedding: row.font_metadata.embedding, noSubsetting: row.font_metadata.noSubsetting, bitmapOnly: row.font_metadata.bitmapOnly } : null, license: row.license });

/** Direct uploads reuse their immutable original bytes and ID in the canonical asset registry. */
export async function prepareOriginalVisualAsset(upload: UploadRow, bytes: Buffer) {
  const image = ['png', 'jpeg', 'webp'].includes(upload.format), font = ['ttf', 'otf', 'woff'].includes(upload.format);
  if (!image && !font) return null;
  const options = SourceOptionsSchema.parse(upload.options);
  const license = SourceAssetLicenseSchema.parse(options.assetLicense ?? unknownLicense);
  const metadata = image ? await sharp(bytes, { limitInputPixels: 20_000_000, animated: false }).metadata() : null;
  const fontMetadata = font ? inspectSourceFont(bytes, upload.format as 'ttf' | 'otf' | 'woff') : null;
  if (image && (!metadata?.width || !metadata.height || (metadata.pages ?? 1) > 1)) throw new IdentityError('VALIDATION_FAILED', 'sources.errors.image');
  return { kind: image ? 'image' as const : 'font' as const, width: metadata?.width ?? null, height: metadata?.height ?? null, fontMetadata, license };
}
export async function registerOriginalVisualAsset(tx: PoolClient, auth: WorkspaceAccess, upload: UploadRow, prepared: Awaited<ReturnType<typeof prepareOriginalVisualAsset>>) {
  if (!prepared) return;
  await tx.query(`INSERT INTO source_assets(id,workspace_id,source_id,source_version_id,upload_id,created_by,producer_key,byte_hash,byte_size,media_type,width,height,storage_key,state,name,kind,font_metadata,license) VALUES($1,$2,$3,$4,$1,$5,'original',$6,$7,$8,$9,$10,$11,'ready',$12,$13,$14,$15) ON CONFLICT(workspace_id,source_version_id,producer_key) DO NOTHING`, [upload.id, auth.workspace.id, upload.source_id, upload.reserved_version_id, auth.userId, upload.byte_hash, upload.byte_size, upload.media_type, prepared.width, prepared.height, upload.original_key, upload.file_name, prepared.kind, prepared.fontMetadata ? JSON.stringify(prepared.fontMetadata) : null, JSON.stringify(prepared.license)]);
}

export function createSourceVisualAssetService(pool: Pool, storage = new LocalSourceStorage()) {
  async function list(principal: SessionPrincipal, raw: SourceVisualAssetQuery) {
    const input = validate(SourceVisualAssetQuerySchema, raw);
    return withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' }, async (tx, access) => {
      const project = await lockProjectAccess(tx, access, { projectId: input.projectId, scope: 'read' });
      const confidential = hasScope({ ...project.membership, projectScopes: project.projectScopes }, 'read-confidential');
      const rows = (await tx.query<AssetRow>(`SELECT a.*,COALESCE(NULLIF(a.name,''),d.title) AS name FROM source_assets a JOIN sources s ON s.workspace_id=a.workspace_id AND s.id=a.source_id JOIN source_uploads u ON u.workspace_id=a.workspace_id AND u.id=a.upload_id AND u.published_version_id=a.source_version_id JOIN source_details d ON d.workspace_id=s.workspace_id AND d.source_id=s.id WHERE a.workspace_id=$1 AND s.project_id=$2 AND s.state='ready' AND u.status='ready' AND a.state='ready' AND ($3::boolean OR s.access_class<>'confidential') AND ($4::text IS NULL OR a.kind=$4) AND ($5::uuid IS NULL OR a.id>$5) ORDER BY a.id LIMIT $6`, [input.workspaceId, input.projectId, confidential, input.kind ?? null, input.after ?? null, input.limit + 1])).rows;
      const page = rows.slice(0, input.limit);
      return SourceVisualAssetListSchema.parse({ items: page.map(dto), nextCursor: rows.length > input.limit ? page.at(-1)!.id : null });
    });
  }
  async function resolve(principal: SessionPrincipal, raw: { workspaceId: string; assetId: string; purpose: 'display' | 'embed' }) {
    const input = validate(z.strictObject({ workspaceId: IdSchema, assetId: IdSchema, purpose: z.enum(['display', 'embed']) }), raw);
    const read = () => withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' }, async (tx, access) => {
      const row = (await tx.query<AssetRow>(`SELECT a.*,COALESCE(NULLIF(a.name,''),d.title) AS name FROM source_assets a JOIN source_details d ON d.workspace_id=a.workspace_id AND d.source_id=a.source_id WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='ready'`, [input.workspaceId, input.assetId])).rows[0];
      if (!row) throw missing();
      const source = await readPinnedSource(tx, access, { sourceId: row.source_id, sourceVersionId: row.source_version_id });
      if (source.uploadId !== row.upload_id) throw missing();
      const license = SourceAssetLicenseSchema.parse(row.license), font = row.font_metadata && SourceFontMetadataSchema.parse(row.font_metadata);
      if (input.purpose === 'embed' && (!license.canEmbed || license.permission !== 'confirmed' || font && (font.embedding === 'restricted' || font.bitmapOnly))) throw new IdentityError('FORBIDDEN', 'sources.errors.license');
      return row;
    });
    const row = await read(), bytes = await storage.read(row.storage_key);
    if (bytes.length !== row.byte_size || sourceHash(bytes) !== row.byte_hash) throw new IdentityError('CONFLICT', 'sources.errors.integrity');
    await read();
    return { ...dto(row), bytes, font: row.font_metadata && SourceFontMetadataSchema.parse(row.font_metadata) };
  }
  async function resolveFont(principal: SessionPrincipal, input: { workspaceId: string; assetId: string; purpose: 'display' | 'embed' }) {
    const asset = await resolve(principal, input);
    if (asset.kind !== 'font' || !asset.font) throw missing();
    return { ...asset, font: asset.font };
  }
  return { list, resolve, resolveFont };
}
