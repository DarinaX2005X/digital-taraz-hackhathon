import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from '../../artifacts/server/http';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, validate } from '../../identity/server/http';
import { createCollaborationService } from './service';
import { createProjectAccessService } from './project-access';
import { CreateCommentSchema, CreateDecisionSchema, ReadCollaborationSchema, ReadProjectAccessSchema, ResolveCommentSchema, SetProjectAccessSchema } from '../contracts';

const revision = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
export function createCollaborationHandlers(options: { pool: Pool; origin: string; getActor(headers: Headers): Promise<IdentityActor> }) {
  const collaboration = createCollaborationService(options.pool), projectAccess = createProjectAccessService(options.pool);
  return async function handle(request: Request, root: 'comments' | 'collaboration'): Promise<Response> {
    try {
      const writing = request.method === 'POST'; if (writing) assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      await limit(options.pool, `collaboration:${actor.user.id}:${writing ? 'write' : 'read'}`, writing ? 240 : 1_200, 60);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      const url = new URL(request.url), prefix = `/api/${root}`, parts = url.pathname.slice(prefix.length).split('/').filter(Boolean);
      if (root === 'comments') {
        if (request.method === 'GET' && parts.length === 1) {
          const query = queryObject(url, ['workspaceId', 'projectId', 'revision']);
          return json(await collaboration.thread(principal, validate(ReadCollaborationSchema, { workspaceId: query.workspaceId, projectId: query.projectId, artifactId: parts[0], artifactRevision: validate(revision, query.revision) })));
        }
        if (writing) {
          queryObject(url, []); const body = await readArtifactJson(request), key = idempotencyKey(request);
          if (!parts.length) return json(await collaboration.comment(principal, key, validate(CreateCommentSchema, body)), 201);
          if (parts.length === 2 && parts[1] === 'resolve') return json(await collaboration.resolve(principal, key, validate(IdSchema, parts[0]), validate(ResolveCommentSchema, body)));
        }
      }
      if (root === 'collaboration') {
        if (request.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'access') {
          const query = queryObject(url, ['workspaceId']); return json(await projectAccess.list(principal, validate(ReadProjectAccessSchema, { workspaceId: query.workspaceId, projectId: parts[1] })));
        }
        if (writing) {
          queryObject(url, []); const body = await readArtifactJson(request), key = idempotencyKey(request);
          if (parts.length === 1 && parts[0] === 'decisions') return json(await collaboration.decide(principal, key, validate(CreateDecisionSchema, body)), 201);
          if (parts.length === 3 && parts[0] === 'projects' && parts[2] === 'access') return json(await projectAccess.set(principal, key, validate(SetProjectAccessSchema, body)));
        }
      }
      throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    } catch (error) { return artifactErrorResponse(error); }
  };
}
