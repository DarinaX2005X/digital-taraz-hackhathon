import type { Pool } from 'pg';

import { z } from 'zod';
import { IdSchema } from '@/contracts/primitives';
import type { IdentityActor } from '@/features/identity/server/handlers';
import type { SessionPrincipal } from '@/features/identity/server/access';
import { assertOrigin, errorResponse, IdentityError, json, limit, validate } from '@/features/identity/server/http';
import { assertActorHeader, idempotencyKey, queryObject } from '@/features/artifacts/server/http';
import { createOperationsService } from './service';

async function readOperationsJson(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new IdentityError('VALIDATION_FAILED', 'operations.errors.validation');
  const maximum = 1024 * 1024;
  if (Number(request.headers.get('content-length')) > maximum) throw new IdentityError('PAYLOAD_TOO_LARGE', 'operations.errors.tooLarge');
  const reader = request.body?.getReader(); if (!reader) throw new IdentityError('VALIDATION_FAILED', 'operations.errors.validation');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) { await reader.cancel(); throw new IdentityError('PAYLOAD_TOO_LARGE', 'operations.errors.tooLarge'); } chunks.push(part.value); }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new IdentityError('VALIDATION_FAILED', 'operations.errors.validation'); }
  } finally { reader.releaseLock(); }
}

const integer = (raw: string | undefined) => raw === undefined ? undefined : validate(z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().nonnegative()), raw);

export function createOperationsHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor> }) {
  const service = createOperationsService(options.pool);
  return async function handle(request: Request): Promise<Response> {
    try {
      if (!['GET', 'POST'].includes(request.method)) throw new IdentityError('NOT_FOUND', 'operations.errors.notFound');
      if (request.method === 'POST') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      await limit(options.pool, `operations:${actor.user.id}:${request.method}`, request.method === 'GET' ? 600 : 180, 60);
      const url = new URL(request.url), parts = url.pathname.slice('/api/operations'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        if (parts.length === 1 && parts[0] === 'resources') {
          const query = queryObject(url, ['workspaceId', 'query', 'kinds', 'status', 'after', 'limit']);
          return json(await service.list(principal, { ...query, kinds: query.kinds?.split(',').filter(Boolean) ?? [], limit: integer(query.limit) }));
        }
        if (parts.length === 2 && parts[0] === 'resources') {
          const query = queryObject(url, ['workspaceId']);
          return json(await service.read(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[1])));
        }
        if (parts.length === 3 && parts[0] === 'resources' && parts[2] === 'availability') {
          const query = queryObject(url, ['workspaceId', 'beforeRevision']);
          return json(await service.availabilityHistory(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[1]), integer(query.beforeRevision)));
        }
      } else {
        queryObject(url, []); const body = await readOperationsJson(request);
        if (parts.length === 1 && parts[0] === 'plan-proposals') return json(await service.propose(principal, body));
        const operationId = idempotencyKey(request);
        if (parts.length === 1 && parts[0] === 'resources') return json(await service.create(principal, operationId, body as never), 201);
        if (parts.length === 3 && parts[0] === 'resources' && parts[2] === 'update') return json(await service.update(principal, operationId, validate(IdSchema, parts[1]), body as never));
        if (parts.length === 3 && parts[0] === 'resources' && parts[2] === 'availability') return json(await service.createAvailability(principal, operationId, validate(IdSchema, parts[1]), body as never), 201);
      }
      throw new IdentityError('NOT_FOUND', 'operations.errors.notFound');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(new IdentityError('VALIDATION_FAILED', 'operations.errors.validation'));
      if (error && typeof error === 'object' && 'code' in error && ['23505', '23503', '23514'].includes(String(error.code))) return errorResponse(new IdentityError('CONFLICT', 'operations.errors.conflict'));
      return errorResponse(error instanceof IdentityError ? error : new IdentityError('UNAVAILABLE', 'operations.errors.unavailable'));
    }
  };
}

