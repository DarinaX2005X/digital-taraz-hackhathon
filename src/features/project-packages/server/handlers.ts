import type { Pool } from 'pg';
import { z } from 'zod';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '../../identity/server/http';
import { assertActorHeader, idempotencyKey, queryObject } from '../../artifacts/server/http';
import { CreateProjectPackageSchema, ProjectPackageListInputSchema } from '../contracts';
import type { ReturnTypeOfProjectPackageService } from './types';

export function createProjectPackageHandlers(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor>; service: ReturnTypeOfProjectPackageService }) {
  return async function handle(request: Request) {
    try {
      const url = new URL(request.url), parts = url.pathname.slice('/api/packages'.length).split('/').filter(Boolean);
      if (parts.length || !['GET', 'POST'].includes(request.method)) throw new IdentityError('NOT_FOUND', 'exports.errors.notFound');
      if (request.method === 'POST') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      await limit(options.pool, `package-api:${actor.user.id}:${request.method}`, request.method === 'GET' ? 180 : 30, 60);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      if (request.method === 'GET') return json(await options.service.list(principal, validate(ProjectPackageListInputSchema, queryObject(url, ['workspaceId', 'projectId']))));
      queryObject(url, []);
      return json(await options.service.create(principal, idempotencyKey(request), validate(CreateProjectPackageSchema, await readJson(request))), 201);
    } catch (error) { return errorResponse(error instanceof z.ZodError ? new IdentityError('VALIDATION_FAILED', 'exports.errors.validation') : error); }
  };
}
