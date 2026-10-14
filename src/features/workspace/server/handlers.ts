import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '@/contracts/primitives';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, validate } from '@/features/identity/server/http';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from '@/features/artifacts/server/http';
import { ProjectListInputSchema } from '../contracts';
import { createProjectCore } from './project-core';

export function createWorkspaceHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor> }) {
  const service = createProjectCore(options.pool);
  return async function projects(request: Request): Promise<Response> {
    try {
      const writing = request.method === 'POST';
      if (writing) assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers);
      assertActorHeader(request, actor.user.id);
      await limit(options.pool, `project-api:${actor.user.id}:${writing ? 'write' : 'read'}`, writing ? 240 : 1200, 60);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      const url = new URL(request.url);
      const path = url.pathname.slice('/api/projects'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        const query = queryObject(url, ['workspaceId', 'status', 'query', 'after', 'limit']);
        if (!path.length) {
          const size = query.limit === undefined ? undefined : validate(z.string().regex(/^[1-9]\d?$/).transform(Number), query.limit);
          return json(await service.list(principal, validate(ProjectListInputSchema, { ...query, limit: size })));
        }
        if (path.length === 1) return json(await service.read(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, path[0])));
      }
      if (writing) {
        queryObject(url, []);
        const key = idempotencyKey(request), body = await readArtifactJson(request);
        if (!path.length) return json(await service.create(principal, key, body as Parameters<typeof service.create>[2]), 201);
        if (path.length === 2 && ['update', 'archive', 'restore'].includes(path[1]!)) return json(await service.mutate(principal, key, validate(IdSchema, path[0]), path[1] as 'update' | 'archive' | 'restore', body));
      }
      throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    } catch (error) { return artifactErrorResponse(error); }
  };
}
