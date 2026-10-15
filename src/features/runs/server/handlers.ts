import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { CancelRunSchema, CreateRunSchema, ResumeRunSchema, RunListCursorSchema } from '../../../contracts/runs';
import type { SessionPrincipal } from '../../identity/server/access';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, readJson } from '../../identity/server/http';
import type { RunRegistry } from './registry';
import type { RunService } from './service';
import { requestKey } from './data';
import { runErrorResponse, runQuery } from './http';
import { runEventStream } from './stream';

export interface RunHandlerOptions {
  pool: Pool; origin: string; service: RunService; registry: RunRegistry;
  getActor: (headers: Headers) => Promise<IdentityActor>; wake: () => Promise<unknown>;
}
const cursorSchema = z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

export function createRunHandlers(options: RunHandlerOptions) {
  return async function handle(request: Request): Promise<Response> {
    try {
      if (request.method === 'POST') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers);
      if (IdSchema.parse(request.headers.get('x-tirlik-user-id')) !== actor.user.id) throw new IdentityError('CONFLICT', 'runs.errors.accountChanged');
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      const url = new URL(request.url);
      const path = url.pathname.slice('/api/runs'.length).split('/').filter(Boolean);
      if (request.method === 'GET') {
        await limit(options.pool, `runs-read:${actor.user.id}`, 240, 60);
        if (path.length === 0) {
          const query = runQuery(url, ['workspaceId', 'projectId', 'before']);
          return json(await options.service.list(principal, IdSchema.parse(query.workspaceId), query.before === undefined ? undefined : RunListCursorSchema.parse(query.before), query.projectId === undefined ? undefined : IdSchema.parse(query.projectId)));
        }
        if (path.length === 1 && path[0] === 'capabilities') { runQuery(url, []); return json({ capabilities: options.registry.list() }); }
        const runId = IdSchema.parse(path[0]);
        if (path.length === 1) { runQuery(url, []); return json(await options.service.read(principal, runId)); }
        if (path.length === 2 && path[1] === 'events') {
          const query = runQuery(url, ['after']);
          const header = request.headers.get('last-event-id');
          if (header !== null && query.after !== undefined && header !== query.after) throw new IdentityError('VALIDATION_FAILED', 'runs.errors.validation');
          const after = cursorSchema.parse(query.after ?? header ?? '0');
          const first = await options.service.events(principal, runId, after);
          return request.headers.get('accept')?.includes('text/event-stream')
            ? runEventStream({ request, principal, service: options.service, first }) : json(first);
        }
      }
      if (request.method === 'POST') {
        await limit(options.pool, `runs-write:${actor.user.id}`, 30, 60);
        runQuery(url, []);
        const key = request.headers.get('idempotency-key') ?? '';
        requestKey(key);
        const body = await readJson(request);
        if (path.length === 0) {
          const run = await options.service.create(principal, CreateRunSchema.parse(body), key);
          await options.wake().catch(() => undefined);
          return json(run, 202);
        }
        if (path.length === 2 && (path[1] === 'cancel' || path[1] === 'resume')) {
          const runId = IdSchema.parse(path[0]);
          const run = path[1] === 'cancel'
            ? await options.service.cancel(principal, runId, CancelRunSchema.parse(body), key)
            : await options.service.resume(principal, runId, ResumeRunSchema.parse(body), key);
          if (path[1] === 'resume') await options.wake().catch(() => undefined);
          return json(run);
        }
      }
      throw new IdentityError('NOT_FOUND', 'runs.errors.notFound');
    } catch (error) { return runErrorResponse(error); }
  };
}
