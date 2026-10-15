import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { InitSourceUploadSchema } from '../../../contracts/sources';
import type { IdentityActor } from '../../identity/server/handlers';
import type { SessionPrincipal } from '../../identity/server/access';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '../../identity/server/http';
import { assertActorHeader, idempotencyKey, queryObject } from '../../artifacts/server/http';
import { createSourceService } from './service';
import { LocalSourceStorage } from './storage';
import { createSourceDocumentAdapter } from './document-input';

const WorkspaceSchema = z.strictObject({ workspaceId: IdSchema });
const integer = (value: string | undefined, fallback: number, maximum: number) => value === undefined ? fallback : validate(z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().min(0).max(maximum)), value);
export function createSourceHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor>; storage?: LocalSourceStorage }) {
  const service = createSourceService(options.pool, options.storage);
  const documents = createSourceDocumentAdapter(options.pool, options.storage);
  return async function handle(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST', 'PUT'].includes(request.method)) throw new IdentityError('NOT_FOUND', 'sources.errors.notFound');
      if (request.method !== 'GET') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      await limit(options.pool, `source-api:${actor.user.id}:${request.method === 'GET' ? 'read' : 'write'}`, request.method === 'GET' ? 600 : 120, 60);
      const url = new URL(request.url), parts = url.pathname.slice('/api/sources'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        const query = queryObject(url, ['workspaceId', 'projectId', 'limit', 'after', 'uploadId', 'chunk', 'query', 'format', 'from', 'to']);
        const workspaceId = validate(IdSchema, query.workspaceId);
        if (parts.length === 1 && parts[0] === 'library') {
          const values = queryObject(url, ['workspaceId', 'projectId', 'query', 'format', 'from', 'to', 'limit', 'after']);
          return json(await service.listLibrary(principal, { ...values, workspaceId, limit: integer(values.limit, 30, 50) } as import('../../../contracts/sources').SourceLibraryQuery));
        }
        if (parts.length === 2 && parts[0] === 'assets') {
          const asset = await documents.resolveImage(principal, { workspaceId, assetId: validate(IdSchema, parts[1]) });
          return new Response(new Uint8Array(asset.bytes), { headers: { 'Content-Type': asset.mediaType, 'Content-Length': String(asset.bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
        }
        if (!parts.length) return json(await service.list(principal, workspaceId, validate(IdSchema, query.projectId), integer(query.limit, 30, 100), query.after));
        const sourceId = validate(IdSchema, parts[0]);
        if (parts.length === 1) return json(await service.read(principal, workspaceId, sourceId));
        if (parts.length === 2 && parts[1] === 'preview') return json(await service.preview(principal, workspaceId, sourceId, validate(IdSchema, query.uploadId), integer(query.chunk, 0, 3999)));
        if (parts.length === 2 && parts[1] === 'original') {
          const original = await service.download(principal, workspaceId, sourceId, validate(IdSchema, query.uploadId));
          return new Response(new Uint8Array(original.bytes), { headers: { 'Content-Type': original.mediaType, 'Content-Disposition': `attachment; filename="original"; filename*=UTF-8''${encodeURIComponent(original.fileName)}`, 'Content-Length': String(original.bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
        }
      } else if (request.method === 'PUT') {
        const query = queryObject(url, ['workspaceId']);
        if (parts.length === 2 && parts[0] === 'uploads' && request.body) return json(await service.put(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[1]), request.headers.get('x-upload-token') ?? '', request.body, request.signal));
      } else {
        queryObject(url, []);
        const body = await readJson(request);
        if (parts.length === 2 && parts[0] === 'uploads' && parts[1] === 'init') return json(await service.init(principal, idempotencyKey(request), validate(InitSourceUploadSchema, body)), 201);
        if (parts.length === 3 && parts[0] === 'uploads' && ['finalize', 'cancel'].includes(parts[2]!)) {
          const { workspaceId } = validate(WorkspaceSchema, body);
          return json(await service[parts[2] as 'finalize' | 'cancel'](principal, workspaceId, validate(IdSchema, parts[1])));
        }
      }
      throw new IdentityError('NOT_FOUND', 'sources.errors.notFound');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(new IdentityError('VALIDATION_FAILED', 'sources.errors.validation'));
      return errorResponse(error);
    }
  };
}
