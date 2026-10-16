import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, validate } from '../../identity/server/http';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from '../../artifacts/server/http';
import { CreateBusinessContextSchema, ListBusinessContextsSchema, SetContextStatusSchema, UpdateBusinessContextSchema, UseBusinessContextSchema } from '../contracts';
import { createBusinessContextService } from './service';

const integer = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive());
export function createBusinessContextHandlers(options: { pool: Pool; origin: string; getActor(headers: Headers): Promise<IdentityActor> }) {
  const service = createBusinessContextService(options.pool);
  return async function handle(request: Request): Promise<Response> {
    try {
      const writing = request.method === 'POST'; if (writing) assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      await limit(options.pool, `business-context:${actor.user.id}:${writing ? 'write' : 'read'}`, writing ? 180 : 900, 60);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      const url = new URL(request.url), parts = url.pathname.slice('/api/business-context'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        const query = queryObject(url, parts.length ? ['workspaceId', 'revision'] : ['workspaceId', 'projectId', 'status', 'query', 'limit']);
        if (!parts.length) return json(await service.list(principal, validate(ListBusinessContextsSchema, { ...query, ...(query.limit ? { limit: validate(integer, query.limit) } : {}) })));
        if (parts.length === 1) return json(await service.read(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[0]), query.revision ? validate(integer, query.revision) : undefined));
      }
      if (writing) {
        queryObject(url, []); const body = await readArtifactJson(request);
        if (!parts.length) return json(await service.create(principal, idempotencyKey(request), validate(CreateBusinessContextSchema, body)), 201);
        if (parts.length === 2 && parts[1] === 'update') return json(await service.update(principal, idempotencyKey(request), validate(IdSchema, parts[0]), validate(UpdateBusinessContextSchema, body)));
        if (parts.length === 2 && parts[1] === 'status') return json(await service.setStatus(principal, idempotencyKey(request), validate(IdSchema, parts[0]), validate(SetContextStatusSchema, body)));
        if (parts.length === 2 && parts[1] === 'use') return json(await service.use(principal, validate(UseBusinessContextSchema, body)));
      }
      throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    } catch (error) { return artifactErrorResponse(error); }
  };
}
