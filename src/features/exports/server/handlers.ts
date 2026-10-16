import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { assertActorHeader, idempotencyKey, queryObject } from '../../artifacts/server/http';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '../../identity/server/http';
import { createSourceDocumentAdapter } from '../../sources/server/document-input';
import { createSourceVisualAssetService } from '../../sources/server/visual-assets';
import { createDesignSourceAssetResolver } from '../../design-export/server/source-assets';
import { operationsExportAdapter } from '../../operations/server/exports';
import { authorizePlanExportResources, resolvePlanExportResources } from '../../operations/server/service';
import { requirePlan } from '../../operations/domain/model';
import { CreateExportSchema } from '../contracts';
import { createExportService } from './service';
import { documentExportAdapter } from './documents';
import { ExportRegistry } from './registry';
import { LocalExportStorage } from './storage';
import { sheetExportAdapter } from './sheets';
import { designExportAdapter } from './designs';
import type { ExportAssets } from './types';
const ActionSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive() });
function streamBytes(bytes: Uint8Array) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.byteLength) { controller.close(); return; }
    const end = Math.min(bytes.byteLength, offset + 64 * 1024);
    controller.enqueue(bytes.subarray(offset, end)); offset = end;
  } });
}
export function createExportHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor>; registry?: ExportRegistry; storage?: LocalExportStorage; onService?: (service: ReturnType<typeof createExportService>) => void }) {
  const source = createSourceDocumentAdapter(options.pool);
  const visualAssets = createSourceVisualAssetService(options.pool);
  const service = createExportService({ pool: options.pool, registry: options.registry ?? new ExportRegistry([documentExportAdapter, sheetExportAdapter, designExportAdapter, operationsExportAdapter]), storage: options.storage, resolvePlanResources: (tx, access, content) => resolvePlanExportResources(tx, access, requirePlan(content)), authorizePlanResources: authorizePlanExportResources, assets: (principal, workspaceId): ExportAssets => {
    if (principal.kind !== 'session') throw new IdentityError('UNAUTHENTICATED', 'identity.errors.unauthenticated');
    const design = createDesignSourceAssetResolver(options.pool, principal, workspaceId);
    const image = (assetId: string) => source.resolveImage(principal, { workspaceId, assetId });
    const font = async (assetId: string) => {
      const asset = await visualAssets.resolveFont(principal, { workspaceId, assetId, purpose: 'embed' });
      return { bytes: asset.bytes, mediaType: asset.mediaType, sha256: asset.sha256, family: asset.font.family, subfamily: asset.font.subfamily, codePoints: [], noSubsetting: asset.font.noSubsetting, canEmbed: asset.license.permission === 'confirmed' && asset.license.canEmbed };
    };
    return { image, font, design, authorize: async (resource) => {
      if (resource.kind === 'image') { await image(resource.id); return; }
      if (resource.kind === 'font') { await font(resource.id); return; }
      if (resource.kind === 'design-image') { await design.image(resource.id, 'embed'); return; }
      await design.font(resource.id, 'embed');
    } };
  } });
  options.onService?.(service);
  return async function handle(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST', 'DELETE'].includes(request.method)) throw new IdentityError('NOT_FOUND', 'exports.errors.notFound');
      if (request.method !== 'GET') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      await limit(options.pool, `export-api:${actor.user.id}:${request.method === 'GET' ? 'read' : 'write'}`, request.method === 'GET' ? 180 : 30, 60);
      const url = new URL(request.url), parts = url.pathname.slice('/api/exports'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        const query = queryObject(url, parts.length ? ['workspaceId'] : ['workspaceId', 'artifactId']), workspaceId = validate(IdSchema, query.workspaceId);
        if (!parts.length) return json(await service.list(principal, workspaceId, validate(IdSchema, query.artifactId)));
        const id = validate(IdSchema, parts[0]);
        if (parts.length === 1) return json(await service.read(principal, workspaceId, id));
        if ((parts.length === 3 && parts[1] === 'files') || (parts.length === 2 && parts[1] === 'bundle')) {
          const result = parts[1] === 'bundle' ? await service.downloadBundle(principal, workspaceId, id) : await service.download(principal, workspaceId, id, validate(IdSchema, parts[2]));
          return new Response(streamBytes(result.bytes), { headers: { 'Content-Type': result.mediaType, 'Content-Disposition': `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer', ETag: `"${result.sha256}"` } });
        }
      } else {
        queryObject(url, []); const body = await readJson(request);
        if (request.method === 'POST' && !parts.length) { const created = await service.create(principal, idempotencyKey(request), validate(CreateExportSchema, body)); await service.cleanup(10); return json(created, 201); }
        const id = validate(IdSchema, parts[0]), action = validate(ActionSchema, body);
        if (request.method === 'DELETE' && parts.length === 1) return json(await service.remove(principal, action.workspaceId, id, action.expectedAuthzVersion));
        if (request.method === 'POST' && parts.length === 2 && parts[1] === 'render') return json(await service.render(principal, action.workspaceId, id, action.expectedAuthzVersion, request.signal));
        if (request.method === 'POST' && parts.length === 2 && parts[1] === 'cancel') return json(await service.cancel(principal, action.workspaceId, id, action.expectedAuthzVersion));
      }
      throw new IdentityError('NOT_FOUND', 'exports.errors.notFound');
    } catch (error) { return errorResponse(error instanceof z.ZodError ? new IdentityError('VALIDATION_FAILED', 'exports.errors.validation') : error); }
  };
}
