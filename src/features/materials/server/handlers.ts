import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '@/contracts/primitives';
import { MaterialSourcePreviewSchema } from '@/contracts/materials';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { withWorkspaceAccess, type SessionPrincipal } from '@/features/identity/server/access';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '@/features/identity/server/http';
import { assertActorHeader, idempotencyKey, queryObject } from '@/features/artifacts/server/http';
import { readPinnedSource, readPinnedSourceChunk } from '@/features/sources/server/pinned-source';
import { createCollectionService } from './collections';
import { createImportService } from './imports';
import { createDatasetService } from './datasets';
import { createMaterialFactReader } from './facts';
import { createCorrectionService } from './corrections';
import { materialError, viewer } from './support';

const integer = (raw: string | undefined) => raw === undefined ? undefined : validate(z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().nonnegative()), raw);
export function createMaterialHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor> }) {
  const collections = createCollectionService(options.pool), imports = createImportService(options.pool), datasets = createDatasetService(options.pool), facts = createMaterialFactReader(options.pool);
  const corrections = createCorrectionService(options.pool);
  return async function handle(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST'].includes(request.method)) throw materialError('notFound', 'NOT_FOUND');
      if (request.method !== 'GET') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      await limit(options.pool, `materials:${actor.user.id}:${request.method}`, request.method === 'GET' ? 600 : 240, 60);
      const url = new URL(request.url), parts = url.pathname.slice('/api/materials'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        if (parts[0] === 'source-preview' && parts.length === 1) {
          const query = queryObject(url, ['workspaceId', 'sourceId', 'sourceVersionId', 'chunk', 'sheet', 'row']);
          return json(await withWorkspaceAccess(options.pool, principal, { workspaceId: validate(IdSchema, query.workspaceId), scope: 'read' }, async (tx, access) => {
            const input = { sourceId: validate(IdSchema, query.sourceId), sourceVersionId: validate(IdSchema, query.sourceVersionId) };
            const pinned = await readPinnedSource(tx, access, input);
            const sheet = validate(z.string().max(240).optional(), query.sheet), row = integer(query.row);
            let ordinal = integer(query.chunk) ?? 0;
            if (query.chunk === undefined && (sheet !== undefined || row !== undefined && row > 0)) {
              const located = (await tx.query<{ ordinal: number }>(`SELECT ordinal FROM source_chunks WHERE upload_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(content->'fragments') f WHERE ($2::text IS NULL OR f->>'sheet'=$2) AND ($3::int IS NULL OR (f->>'row')::int=$3)) ORDER BY ordinal LIMIT 1`, [pinned.uploadId, sheet ?? null, row && row > 0 ? row : null])).rows[0];
              if (!located) throw materialError('schema', 'VALIDATION_FAILED');
              ordinal = located.ordinal;
            }
            const chunk = pinned.chunkCount ? await readPinnedSourceChunk(tx, access, { ...input, ordinal }) : { fragments: [] };
            return MaterialSourcePreviewSchema.parse({ viewer: viewer(access), sourceRef: pinned.sourceRef, title: pinned.title, projectId: pinned.projectId, accessClass: pinned.accessClass, manifest: pinned.manifest, chunk, chunkCount: pinned.chunkCount });
          }));
        }
        if (parts[0] === 'collections' && parts.length === 1) {
          const query = queryObject(url, ['workspaceId', 'projectId', 'query', 'kind', 'from', 'to', 'after', 'limit']);
          return json(await collections.list(principal, { ...query, ...(query.limit !== undefined ? { limit: integer(query.limit) } : {}) }));
        }
        if (parts[0] === 'collections' && parts.length === 2) {
          const query = queryObject(url, ['workspaceId']);
          return json(await collections.read(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[1])));
        }
        if (parts[0] === 'collections' && parts.length === 3 && parts[2] === 'history') {
          const query = queryObject(url, ['workspaceId', 'beforeRevision']);
          return json(await collections.history(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[1]), integer(query.beforeRevision)));
        }
        if (parts[0] === 'imports' && parts.length === 2) {
          const query = queryObject(url, ['workspaceId', 'after', 'change', 'limit']);
          return json(await imports.preview(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[1]), { after: query.after, change: query.change, limit: integer(query.limit) }));
        }
      } else {
        queryObject(url, []);
        const body = await readJson(request);
        if (parts.join('/') === 'collections') return json(await collections.create(principal, idempotencyKey(request), body), 201);
        if (parts.join('/') === 'imports') return json(await imports.begin(principal, idempotencyKey(request), body), 201);
        if (parts.join('/') === 'datasets/query') return json(await datasets.query(principal, body));
        if (parts.join('/') === 'datasets/aggregate') return json(await datasets.aggregate(principal, body));
        if (parts.join('/') === 'facts/read') return json(await facts.read(principal, body));
        if (parts[0] === 'collections' && parts.length === 3) {
          const id = validate(IdSchema, parts[1]);
          if (parts[2] === 'correction-preview') return json(await corrections.preview(principal, id, body));
          if (parts[2] === 'correct') return json(await corrections.apply(principal, idempotencyKey(request), id, body));
          if (parts[2] === 'undo') return json(await corrections.undo(principal, idempotencyKey(request), id, body));
        }
        if (parts[0] === 'imports' && parts.length === 3) {
          const id = validate(IdSchema, parts[1]);
          if (parts[2] === 'advance') return json(await imports.advance(principal, id, body));
          if (parts[2] === 'cancel') return json(await imports.cancel(principal, id, body));
          if (parts[2] === 'resolve') return json(await imports.resolve(principal, idempotencyKey(request), id, body));
          if (parts[2] === 'undo-decision') return json(await imports.undoResolve(principal, idempotencyKey(request), id, body));
          if (parts[2] === 'apply') return json(await imports.apply(principal, idempotencyKey(request), id, body));
        }
      }
      throw materialError('notFound', 'NOT_FOUND');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(materialError('validation', 'VALIDATION_FAILED'));
      if (error && typeof error === 'object' && 'code' in error && ['23505', '23503', '23514'].includes(String(error.code))) return errorResponse(materialError('conflict'));
      if (!(error instanceof IdentityError)) return errorResponse(new IdentityError('UNAVAILABLE', 'materials.errors.unavailable'));
      return errorResponse(error);
    }
  };
}
