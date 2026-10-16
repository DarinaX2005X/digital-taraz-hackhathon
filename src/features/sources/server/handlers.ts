import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { AcceptSourcePageSchema, InitSourceUploadSchema, StartSourceOcrSchema } from '../../../contracts/sources';
import { LibraryLifecycleMutationRequestSchema } from '../../../contracts/library-lifecycle';
import type { IdentityActor } from '../../identity/server/handlers';
import type { SessionPrincipal } from '../../identity/server/access';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '../../identity/server/http';
import { assertActorHeader, idempotencyKey, queryObject } from '../../artifacts/server/http';
import { createSourceService } from './service';
import { LocalSourceStorage } from './storage';
import type { SourceRecognitionRuntimeLoader } from './review';
import { withWorkspaceAccess } from '../../identity/server/access';
import { authorizedUpload } from './service';
import { createSourceLibraryLifecycleService } from './library-lifecycle';

const WorkspaceSchema = z.strictObject({ workspaceId: IdSchema });
const integer = (value: string | undefined, fallback: number, maximum: number) => value === undefined ? fallback : validate(z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().min(0).max(maximum)), value);
export function createSourceHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor>; storage?: LocalSourceStorage; runtime?: SourceRecognitionRuntimeLoader }) {
  const service = createSourceService(options.pool, options.storage);
  const mutateLifecycle = createSourceLibraryLifecycleService(options.pool);
  async function loadDocuments() { const loaded = await import('./document-input'); return loaded.createSourceDocumentAdapter(options.pool, options.storage); }
  async function loadAssets() { const loaded = await import('./visual-assets'); return loaded.createSourceVisualAssetService(options.pool, options.storage); }
  async function loadRecognition() { const loaded = await import('./review'); return loaded.createSourceRecognitionService(options.pool, options.runtime, options.storage); }
  let documentsPromise: ReturnType<typeof loadDocuments> | undefined;
  let assetsPromise: ReturnType<typeof loadAssets> | undefined;
  let recognitionPromise: ReturnType<typeof loadRecognition> | undefined;
  const documents = () => documentsPromise ??= loadDocuments();
  const assets = () => assetsPromise ??= loadAssets();
  const recognition = () => recognitionPromise ??= loadRecognition();
  return async function handle(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST', 'PUT'].includes(request.method)) throw new IdentityError('NOT_FOUND', 'sources.errors.notFound');
      if (request.method !== 'GET') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      await limit(options.pool, `source-api:${actor.user.id}:${request.method === 'GET' ? 'read' : 'write'}`, request.method === 'GET' ? 600 : 120, 60);
      const url = new URL(request.url), parts = url.pathname.slice('/api/sources'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        const query = queryObject(url, ['workspaceId', 'projectId', 'limit', 'after', 'uploadId', 'chunk', 'query', 'format', 'lifecycleState', 'from', 'to', 'kind', 'pageLimit']);
        const workspaceId = validate(IdSchema, query.workspaceId);
        if (parts.length === 1 && parts[0] === 'library') {
          const values = queryObject(url, ['workspaceId', 'projectId', 'query', 'format', 'lifecycleState', 'from', 'to', 'limit', 'after']);
          return json(await service.listLibrary(principal, { ...values, workspaceId, limit: integer(values.limit, 30, 50) } as import('../../../contracts/sources').SourceLibraryQuery));
        }
        if (parts.length === 1 && parts[0] === 'assets') return json(await (await assets()).list(principal, { workspaceId, projectId: validate(IdSchema, query.projectId), kind: query.kind as 'image' | 'font' | undefined, after: query.after, limit: integer(query.limit, 30, 50) }));
        if (parts.length === 2 && parts[0] === 'assets') {
          let asset;
          try { asset = await (await assets()).resolve(principal, { workspaceId, assetId: validate(IdSchema, parts[1]), purpose: 'display' }); }
          catch (error) { if (!(error instanceof IdentityError) || error.code !== 'NOT_FOUND') throw error; asset = await (await documents()).resolveImage(principal, { workspaceId, assetId: validate(IdSchema, parts[1]) }); }
          return new Response(new Uint8Array(asset.bytes), { headers: { 'Content-Type': asset.mediaType, 'Content-Length': String(asset.bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
        }
        if (parts.length === 3 && parts[0] === 'uploads' && parts[2] === 'review') return json(await (await recognition()).review(principal, workspaceId, validate(IdSchema, parts[1])));
        if (parts.length === 3 && parts[0] === 'uploads' && parts[2] === 'recognition-quote') return json(await (await recognition()).quote(principal, workspaceId, validate(IdSchema, parts[1]), integer(query.pageLimit, 3, 10)));
        if (parts.length === 3 && parts[0] === 'uploads' && parts[2] === 'thumbnail') {
          const uploadId = validate(IdSchema, parts[1]);
          const selected = await withWorkspaceAccess(options.pool, principal, { workspaceId, scope: 'read' }, async (tx, auth) => (await authorizedUpload(tx, auth, uploadId, 'read')).upload);
          if (!['png', 'jpeg', 'webp'].includes(selected.format)) throw new IdentityError('NOT_FOUND', 'sources.errors.notFound');
          const original = await service.download(principal, workspaceId, selected.source_id, uploadId);
          const { default: sharp } = await import('sharp');
          const bytes = await sharp(original.bytes, { limitInputPixels: 20_000_000, animated: false }).rotate().resize({ width: 320, height: 240, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
          await withWorkspaceAccess(options.pool, principal, { workspaceId, scope: 'read' }, async (tx, auth) => { await authorizedUpload(tx, auth, uploadId, 'read'); });
          return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
        }
        if (parts.length === 5 && parts[0] === 'uploads' && parts[2] === 'pages' && parts[4] === 'image') {
          const uploadId = validate(IdSchema, parts[1]), page = integer(parts[3], 0, 100);
          if (page < 1) throw new IdentityError('VALIDATION_FAILED', 'sources.errors.validation');
          const selected = await withWorkspaceAccess(options.pool, principal, { workspaceId, scope: 'read' }, async (tx, auth) => (await authorizedUpload(tx, auth, uploadId, 'read')).upload);
          const original = await service.download(principal, workspaceId, selected.source_id, uploadId);
          const { sourcePageImage } = await import('./page-image');
          const bytes = await sourcePageImage(original.bytes, selected.format, page);
          await withWorkspaceAccess(options.pool, principal, { workspaceId, scope: 'read' }, async (tx, auth) => { await authorizedUpload(tx, auth, uploadId, 'read'); });
          return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
        }
        if (!parts.length) return json(await service.list(principal, workspaceId, validate(IdSchema, query.projectId), integer(query.limit, 30, 100), query.after));
        const sourceId = validate(IdSchema, parts[0]);
        if (parts.length === 1) return json(await service.read(principal, workspaceId, sourceId, query.uploadId));
        if (parts.length === 3 && parts[1] === 'versions') return json(await service.readVersion(principal, workspaceId, sourceId, validate(IdSchema, parts[2])));
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
        if (parts.length === 2 && parts[1] === 'lifecycle') {
          const input = validate(LibraryLifecycleMutationRequestSchema, body);
          if (input.operationId !== idempotencyKey(request) || input.command.objectId !== validate(IdSchema, parts[0])) throw new IdentityError('VALIDATION_FAILED', 'sources.errors.validation');
          return json(await mutateLifecycle(principal, input));
        }
        if (parts.length === 2 && parts[0] === 'uploads' && parts[1] === 'init') return json(await service.init(principal, idempotencyKey(request), validate(InitSourceUploadSchema, body)), 201);
        if (parts.length === 3 && parts[0] === 'uploads' && parts[2] === 'recognize') return json(await (await recognition()).start(principal, validate(IdSchema, parts[1]), idempotencyKey(request), validate(StartSourceOcrSchema, body)), 202);
        if (parts.length === 3 && parts[0] === 'uploads' && parts[2] === 'review') return json(await (await recognition()).accept(principal, validate(IdSchema, parts[1]), validate(AcceptSourcePageSchema, body)));
        if (parts.length === 3 && parts[0] === 'uploads' && ['finalize', 'cancel'].includes(parts[2]!)) {
          const { workspaceId } = validate(WorkspaceSchema, body);
          return json(await service[parts[2] as 'finalize' | 'cancel'](principal, workspaceId, validate(IdSchema, parts[1])));
        }
      }
      throw new IdentityError('NOT_FOUND', 'sources.errors.notFound');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(new IdentityError('VALIDATION_FAILED', 'sources.errors.validation'));
      if (!(error instanceof IdentityError)) console.error('SOURCE_HANDLER_UNEXPECTED', error);
      return errorResponse(error);
    }
  };
}
