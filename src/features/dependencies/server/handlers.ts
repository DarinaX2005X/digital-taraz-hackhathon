import type { Pool } from 'pg';
import { DependencyReadSchema, PrepareChangesSchema, RegisterDependenciesSchema, ReviewChangesSchema } from '../../../contracts/dependencies';
import { IdSchema } from '../../../contracts/primitives';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from '../../artifacts/server/http';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, validate } from '../../identity/server/http';
import { BindDependenciesSchema, createDependencyService } from './service';
import { ChangeSetListInputSchema } from '../../change-review/contracts';

export interface DependencyHandlerOptions { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor> }
export function createDependencyHandlers(options: DependencyHandlerOptions) {
  const service = createDependencyService(options.pool);
  async function handle(request: Request) {
    try {
      const url = new URL(request.url), [root, ...path] = url.pathname.slice('/api/'.length).split('/').filter(Boolean);
      if (!['dependencies', 'changesets'].includes(root ?? '') || !['GET', 'POST'].includes(request.method)) throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
      if (request.method === 'POST') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      await limit(options.pool, `dependency-api:${actor.user.id}:${request.method}`, request.method === 'POST' ? 120 : 600, 60);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      if (request.method === 'GET') {
        if (root === 'changesets' && !path.length) {
          const query = queryObject(url, ['workspaceId', 'projectId', 'after', 'limit']);
          return json(await service.listChangesets(principal, validate(ChangeSetListInputSchema, { ...query, limit: query.limit === undefined ? undefined : Number(query.limit) })));
        }
        const input = validate(DependencyReadSchema, queryObject(url, ['workspaceId', 'projectId']));
        if (root === 'dependencies' && !path.length) return json(await service.read(principal, input));
        if (root === 'changesets' && path.length === 1) return json(await service.changeset(principal, validate(IdSchema, path[0]), input));
      } else {
        queryObject(url, []);
        const operationId = idempotencyKey(request), input = await readArtifactJson(request);
        if (root === 'dependencies' && !path.length) return json(await service.register(principal, operationId, validate(RegisterDependenciesSchema, input)));
        if (root === 'dependencies' && path.length === 1 && path[0] === 'bind') return json(await service.bind(principal, operationId, validate(BindDependenciesSchema, input)));
        if (root === 'changesets' && !path.length) return json(await service.prepare(principal, operationId, validate(PrepareChangesSchema, input)), 201);
        if (root === 'changesets' && path.length === 2 && ['accept', 'reject'].includes(path[1]!)) return json(await service.review(principal, operationId, validate(IdSchema, path[0]), path[1] as 'accept' | 'reject', validate(ReviewChangesSchema, input)));
      }
      throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
    } catch (error) { return artifactErrorResponse(error); }
  }
  return { handle };
}
