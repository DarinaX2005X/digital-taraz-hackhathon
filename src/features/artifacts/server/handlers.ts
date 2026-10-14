import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema, RevisionSchema } from '../../../contracts/primitives';
import type { IdentityActor } from '../../identity/server/handlers';
import type { SessionPrincipal } from '../../identity/server/access';
import { assertOrigin, IdentityError, json, limit, validate } from '../../identity/server/http';
import { createProjectCore } from '../../workspace/server/project-core';
import { ArtifactCommandRequestSchema, ArtifactHistoryActionSchema, ArtifactListInputSchema } from '../contracts';
import { createWorkspaceEventFeed } from './event-feed';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from './http';
import { createArtifactService } from './service';

export interface ArtifactHandlerOptions { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor> }
const PageNumberSchema = z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(RevisionSchema);
function pageNumber(raw: string | undefined): number | undefined { return raw === undefined ? undefined : validate(PageNumberSchema, raw); }

export function createArtifactHandlers(options: ArtifactHandlerOptions) {
  const service = createArtifactService(options.pool), projects = createProjectCore(options.pool), events = createWorkspaceEventFeed(options.pool);
  async function authorize(request: Request): Promise<SessionPrincipal> {
    if (request.method === 'POST') assertOrigin(request, options.origin);
    const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
    await limit(options.pool, `artifact-api:${actor.user.id}:${request.method === 'POST' ? 'write' : 'read'}`, request.method === 'POST' ? 240 : 1200, 60);
    return { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
  }
  async function artifacts(request: Request): Promise<Response> {
    try {
      const principal = await authorize(request), url = new URL(request.url), path = url.pathname.slice('/api/artifacts'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        if (!path.length) {
          const query = queryObject(url, ['workspaceId', 'projectId', 'status', 'kind', 'query', 'after', 'limit']);
          return json(await service.list(principal, validate(ArtifactListInputSchema, { ...query, limit: pageNumber(query.limit) })));
        }
        const query = queryObject(url, ['workspaceId', 'beforeRevision', 'limit']);
        const workspaceId = validate(IdSchema, query.workspaceId);
        if (path.length === 1) return json(await service.read(principal, { workspaceId, artifactId: validate(IdSchema, path[0]) }));
        if (path.length === 2 && path[1] === 'history') return json(await service.history(principal, { workspaceId, artifactId: validate(IdSchema, path[0]) }));
        if (path.length === 2 && path[1] === 'versions') return json(await service.versions(principal, { workspaceId, artifactId: validate(IdSchema, path[0]), beforeRevision: pageNumber(query.beforeRevision), limit: pageNumber(query.limit) }));
        if (path.length === 3 && path[1] === 'versions') return json(await service.version(principal, { workspaceId, artifactId: validate(IdSchema, path[0]), revision: validate(PageNumberSchema, path[2]) }));
      } else if (request.method === 'POST') {
        queryObject(url, []);
        const body = await readArtifactJson(request);
        if (path.length === 1 && path[0] === 'access') return json(await service.access(principal, body as Parameters<typeof service.access>[1]));
        const key = idempotencyKey(request);
        if (path.length === 0) return json(await service.create(principal, key, body as Parameters<typeof service.create>[2]), 201);
        if (path.length === 1 && path[0] === 'commands') {
          const input = validate(ArtifactCommandRequestSchema, body);
          if (input.group.commandGroupId !== key) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
          return json(await service.apply(principal, input));
        }
        if (path.length === 2 && path[0] === 'history' && ['undo', 'redo'].includes(path[1]!)) {
          const input = validate(ArtifactHistoryActionSchema, body);
          if (input.commandGroupId !== key) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
          return json(await service[path[1] as 'undo' | 'redo'](principal, input));
        }
        if (path.length === 2) {
          const id = validate(IdSchema, path[0]);
          switch (path[1]) {
            case 'rename': return json(await service.rename(principal, key, id, body as Parameters<typeof service.rename>[3]));
            case 'move': return json(await service.move(principal, key, id, body as Parameters<typeof service.move>[3]));
            case 'archive': return json(await service.archive(principal, key, id, body as Parameters<typeof service.archive>[3]));
            case 'trash': return json(await service.trash(principal, key, id, body as Parameters<typeof service.trash>[3]));
            case 'restore': return json(await service.restore(principal, key, id, body as Parameters<typeof service.restore>[3]));
            case 'duplicate': return json(await service.duplicate(principal, key, id, body as Parameters<typeof service.duplicate>[3]), 201);
            case 'branches': return json(await service.branch(principal, key, id, body as Parameters<typeof service.branch>[3]), 201);
            case 'restore-version': return json(await service.restoreVersion(principal, key, id, body as Parameters<typeof service.restoreVersion>[3]));
            case 'purge': return json(await service.purge(principal, key, id, body as Parameters<typeof service.purge>[3]));
          }
        }
      }
      throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
    } catch (error) { return artifactErrorResponse(error); }
  }
  async function projectHandler(request: Request): Promise<Response> {
    try {
      const principal = await authorize(request), url = new URL(request.url), path = url.pathname.slice('/api/projects'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        const query = queryObject(url, ['workspaceId', 'status', 'query', 'after', 'limit']);
        if (!path.length) return json(await projects.list(principal, { ...query, workspaceId: validate(IdSchema, query.workspaceId), status: query.status as 'active' | 'archived' | 'trashed' | undefined, limit: pageNumber(query.limit) }));
        if (path.length === 1) return json(await projects.read(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, path[0])));
      }
      if (request.method === 'POST' && !path.length) { queryObject(url, []); return json(await projects.create(principal, idempotencyKey(request), await readArtifactJson(request) as Parameters<typeof projects.create>[2]), 201); }
      throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
    } catch (error) { return artifactErrorResponse(error); }
  }
  async function eventHandler(request: Request): Promise<Response> {
    try {
      const principal = await authorize(request), url = new URL(request.url);
      if (request.method !== 'GET' || url.pathname !== '/api/workspace-events') throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
      const query = queryObject(url, ['workspaceId', 'cursor', 'limit']);
      return json(await events(principal, { workspaceId: validate(IdSchema, query.workspaceId), cursor: query.cursor, limit: pageNumber(query.limit) }));
    } catch (error) { return artifactErrorResponse(error); }
  }
  return { artifacts, projects: projectHandler, events: eventHandler };
}
