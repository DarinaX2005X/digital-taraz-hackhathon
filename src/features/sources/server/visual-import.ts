import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema, HashSchema } from '../../../contracts/primitives';
import { SourceAssetLicenseSchema } from '../../../contracts/sources';
import type { SessionPrincipal } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { createSourceService } from './service';
import { createSourceVisualAssetService } from './visual-assets';
import { LocalSourceStorage, sourceHash } from './storage';

const ImportSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema, operationId: IdSchema, name: z.string().trim().min(1).max(240), format: z.enum(['png', 'jpeg', 'webp', 'ttf', 'otf', 'woff']), sha256: HashSchema, license: SourceAssetLicenseSchema, accessClass: z.enum(['internal', 'confidential']) });
/** Portable import must pass the archive's checked bytes and a stable per-asset operation UUID. */
export function createSourceVisualImportAdapter(pool: Pool, storage = new LocalSourceStorage()) {
  const sources = createSourceService(pool, storage), assets = createSourceVisualAssetService(pool, storage);
  return { async import(principal: SessionPrincipal, raw: z.infer<typeof ImportSchema> & { bytes: Uint8Array }) {
    const { bytes: inputBytes, ...rest } = raw, input = validate(ImportSchema, rest), bytes = Buffer.from(inputBytes);
    if (!bytes.length || sourceHash(bytes) !== input.sha256) throw new IdentityError('CONFLICT', 'sources.errors.integrity');
    const initial = await sources.init(principal, input.operationId, { workspaceId: input.workspaceId, projectId: input.projectId, title: input.name, fileName: input.name, expectedRevision: 0, size: bytes.length, format: input.format, accessClass: input.accessClass, options: { encoding: 'utf-8', purpose: 'visual', assetLicense: input.license } });
    if (initial.token) await sources.put(principal, input.workspaceId, initial.upload.id, initial.token, new Blob([new Uint8Array(bytes)]).stream());
    const ready = await sources.finalize(principal, input.workspaceId, initial.upload.id);
    if (ready.upload.status !== 'ready') throw new IdentityError('CONFLICT', 'sources.errors.conflict');
    const asset = await assets.resolve(principal, { workspaceId: input.workspaceId, assetId: ready.upload.id, purpose: 'display' });
    if (asset.sha256 !== input.sha256) throw new IdentityError('CONFLICT', 'sources.errors.integrity');
    return { assetId: asset.id, sourceId: asset.sourceId, sourceVersionId: asset.sourceVersionId, sha256: asset.sha256 };
  } };
}
