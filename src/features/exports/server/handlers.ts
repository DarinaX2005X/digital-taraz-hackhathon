import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { assertActorHeader, idempotencyKey, queryObject } from '../../artifacts/server/http';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '../../identity/server/http';
import { createSourceDocumentAdapter } from '../../sources/server/document-input';
import { CreateExportSchema } from '../contracts';
import { createExportService } from './service';
import { documentExportAdapter } from './documents';
import { ExportRegistry } from './registry';
import { LocalExportStorage } from './storage';
import { sheetExportAdapter } from './sheets';
const ActionSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive() });
export function createExportHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor>; registry?: ExportRegistry; storage?: LocalExportStorage }) {
  const source = createSourceDocumentAdapter(options.pool);
  const service = createExportService({ pool: options.pool, registry: options.registry ?? new ExportRegistry([documentExportAdapter, sheetExportAdapter]), storage: options.storage, assets: (principal, workspaceId) => ({ image: async (assetId) => { if (principal.kind !== 'session') throw new IdentityError('UNAUTHENTICATED', 'identity.errors.unauthenticated'); return source.resolveImage(principal, { workspaceId, assetId }); } }) });
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
        if (parts.length === 3 && parts[1] === 'files') {
          const result = await service.download(principal, workspaceId, id, validate(IdSchema, parts[2]));
          return new Response(new Uint8Array(result.bytes), { headers: { 'Content-Type': result.mediaType, 'Content-Length': String(result.bytes.length), 'Content-Disposition': `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer', ETag: `"${result.sha256}"` } });
        }
      } else {
        queryObject(url, []); const body = await readJson(request);
        if (request.method === 'POST' && !parts.length) return json(await service.create(principal, idempotencyKey(request), validate(CreateExportSchema, body)), 201);
        const id = validate(IdSchema, parts[0]), action = validate(ActionSchema, body);
        if (request.method === 'DELETE' && parts.length === 1) return json(await service.remove(principal, action.workspaceId, id, action.expectedAuthzVersion));
        if (request.method === 'POST' && parts.length === 2 && parts[1] === 'render') return json(await service.render(principal, action.workspaceId, id, action.expectedAuthzVersion, request.signal));
        if (request.method === 'POST' && parts.length === 2 && parts[1] === 'cancel') return json(await service.cancel(principal, action.workspaceId, id, action.expectedAuthzVersion));
      }
      throw new IdentityError('NOT_FOUND', 'exports.errors.notFound');
    } catch (error) { return errorResponse(error instanceof z.ZodError ? new IdentityError('VALIDATION_FAILED', 'exports.errors.validation') : error); }
  };
}
