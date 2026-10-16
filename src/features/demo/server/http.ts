import 'server-only';

import { DemoCapabilityTokenSchema, type DemoExecutionScope } from '@/contracts/demo-execution';
import { IdSchema } from '@/contracts/primitives';
import { ResumeRunSchema, RunCursorSchema } from '@/contracts/runs';
import { idempotencyKey, queryObject, readArtifactJson } from '@/features/artifacts/server/http';
import { getIdentityHandlers } from '@/features/identity/server';
import { assertOrigin, cookie, IdentityError, json, limit, readJson } from '@/features/identity/server/http';
import { dispatchRunQueue } from '@/features/runs/server/dispatcher';
import { runErrorResponse, runQuery } from '@/features/runs/server/http';
import { getRunRuntime } from '@/features/runs/server/runtime';
import { CopyDemoSchema, DemoRunStartedSchema, DemoSessionSchema, DemoStartedSchema, StartDemoRunSchema, StartDemoSchema } from '../contracts';
import { createDemoExecutionScopeService, DemoExecutionError } from './execution-scope';

const COOKIE_PREFIX = 'tirlik-demo-';
let service: ReturnType<typeof createDemoExecutionScopeService> | undefined;

function getService() {
  if (service) return service;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('DEMO_CAPABILITY_SECRET_REQUIRED');
  const runtime = getRunRuntime();
  return service = createDemoExecutionScopeService({ pool: runtime.pool, secret, runtime, wake: dispatchRunQueue });
}

function operationKey(request: Request) { return request.headers.get('idempotency-key') ?? ''; }
function cookieName(sessionId: string) { return `${COOKIE_PREFIX}${IdSchema.parse(sessionId)}`; }
function capability(request: Request, sessionId: string) {
  const value = cookie(request, cookieName(sessionId));
  if (!value) throw new DemoExecutionError('DEMO_NOT_FOUND');
  return DemoCapabilityTokenSchema.parse(value);
}
function publicScope(scope: DemoExecutionScope) {
  return DemoSessionSchema.parse({ sessionId: scope.sessionId, expiresAt: scope.expiresAt, revision: scope.revision, locale: scope.locale, actorId: scope.actorId, workspaceId: scope.workspaceId, projectId: scope.projectId, inputRefs: scope.inputRefs, results: scope.results, runIds: scope.runIds });
}
function pathOf(request: Request) {
  return new URL(request.url).pathname.slice('/api/demo/sessions'.length).split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}
function demoErrorResponse(error: unknown) {
  if (!(error instanceof DemoExecutionError)) return runErrorResponse(error);
  const status = { DEMO_NOT_FOUND: 404, DEMO_EXPIRED: 410, DEMO_FORBIDDEN: 403, DEMO_CONFLICT: 409, DEMO_LIMIT: 429 }[error.code];
  return json({ code: error.code, message: error.code }, status, error.code === 'DEMO_LIMIT' ? { 'Retry-After': '3600' } : undefined);
}
function numberQuery(value: string | undefined) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new IdentityError('VALIDATION_FAILED', 'runs.errors.validation');
  return number;
}
function download(result: { bytes: Uint8Array; mediaType: string; fileName: string; sha256: string }) {
  return new Response(new Uint8Array(result.bytes), { headers: {
    'Content-Type': result.mediaType, 'Content-Length': String(result.bytes.length),
    'Content-Disposition': `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
    'Referrer-Policy': 'no-referrer', ETag: `"${result.sha256}"`,
  } });
}

export async function handleDemoRequest(request: Request): Promise<Response> {
  try {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new IdentityError('UNAVAILABLE', 'identity.errors.unavailable');
    const url = new URL(request.url), path = pathOf(request), runtime = getRunRuntime(), execution = getService();
    if (request.method === 'GET') {
      if (path.length === 1) {
        runQuery(url, []);
        const sessionId = IdSchema.parse(path[0]);
        return json(publicScope(await execution.read(sessionId, capability(request, sessionId))));
      }
      if (path.length === 3 && path[1] === 'runs') {
        runQuery(url, []);
        const sessionId = IdSchema.parse(path[0]), runId = IdSchema.parse(path[2]);
        return json(await execution.readRun(sessionId, capability(request, sessionId), runId));
      }
      if (path.length === 4 && path[1] === 'runs' && path[3] === 'events') {
        const query = runQuery(url, ['after']);
        const after = RunCursorSchema.parse(query.after === undefined ? 0 : Number(query.after));
        const sessionId = IdSchema.parse(path[0]), runId = IdSchema.parse(path[2]);
        return json(await execution.events(sessionId, capability(request, sessionId), runId, after));
      }
      if (path.length >= 2) {
        const sessionId = IdSchema.parse(path[0]), token = capability(request, sessionId);
        if (path[1] === 'operations' && path.length === 3 && path[2] === 'resources') {
          const query = queryObject(url, ['workspaceId', 'query', 'kinds', 'status', 'after', 'limit']);
          await limit(runtime.pool, `demo-operations:${sessionId}:GET`, 180, 60);
          return json(await execution.listResources(sessionId, token, {
            ...query,
            kinds: query.kinds?.split(',').filter(Boolean) ?? [],
            limit: numberQuery(query.limit),
          }));
        }
        if (path[1] === 'operations' && path.length === 4 && path[2] === 'resources') {
          const query = queryObject(url, ['workspaceId']);
          await limit(runtime.pool, `demo-operations:${sessionId}:GET`, 180, 60);
          return json(await execution.readResource(sessionId, token, query.workspaceId ?? '', IdSchema.parse(path[3])));
        }
        if (path[1] === 'operations' && path.length === 5 && path[2] === 'resources' && path[4] === 'availability') {
          const query = queryObject(url, ['workspaceId', 'beforeRevision']);
          await limit(runtime.pool, `demo-operations:${sessionId}:GET`, 180, 60);
          return json(await execution.resourceAvailabilityHistory(sessionId, token, query.workspaceId ?? '', IdSchema.parse(path[3]), numberQuery(query.beforeRevision)));
        }
        if (path[1] === 'artifacts' && path.length === 3) {
          queryObject(url, ['workspaceId']);
          return json(await execution.artifactSnapshot(sessionId, token, IdSchema.parse(path[2])));
        }
        if (path[1] === 'artifacts' && path.length === 4 && path[3] === 'history') {
          queryObject(url, ['workspaceId']);
          return json(await execution.artifactHistory(sessionId, token, IdSchema.parse(path[2])));
        }
        if (path[1] === 'artifacts' && path.length === 4 && path[3] === 'versions') {
          const query = queryObject(url, ['workspaceId', 'beforeRevision', 'limit']);
          return json(await execution.artifactVersions(sessionId, token, IdSchema.parse(path[2]), numberQuery(query.beforeRevision), numberQuery(query.limit)));
        }
        if (path[1] === 'artifacts' && path.length === 5 && path[3] === 'versions') {
          queryObject(url, ['workspaceId']);
          return json(await execution.artifactVersion(sessionId, token, IdSchema.parse(path[2]), numberQuery(path[4])!));
        }
        if (path[1] === 'workspace-events' && path.length === 2) {
          const query = queryObject(url, ['workspaceId', 'cursor', 'limit']);
          return json(await execution.workspaceEvents(sessionId, token, { workspaceId: query.workspaceId, cursor: query.cursor, limit: numberQuery(query.limit) }));
        }
        if (path[1] === 'exports' && path.length === 3) {
          queryObject(url, ['workspaceId']);
          return json(await execution.readExport(sessionId, token, IdSchema.parse(path[2])));
        }
        if (path[1] === 'exports' && path.length === 5 && path[3] === 'files') {
          queryObject(url, ['workspaceId']);
          return download(await execution.downloadExport(sessionId, token, IdSchema.parse(path[2]), IdSchema.parse(path[4])));
        }
        if (path[1] === 'exports' && path.length === 4 && path[3] === 'bundle') {
          queryObject(url, ['workspaceId']);
          return download(await execution.downloadExportBundle(sessionId, token, IdSchema.parse(path[2])));
        }
      }
      throw new DemoExecutionError('DEMO_NOT_FOUND');
    }
    if (request.method !== 'POST') throw new DemoExecutionError('DEMO_NOT_FOUND');
    assertOrigin(request, origin); runQuery(url, []);
    if (path.length === 0) {
      await limit(runtime.pool, 'demo-start:global', 30, 3600);
      const input = StartDemoSchema.parse(await readJson(request));
      const created = await execution.create(input.locale, operationKey(request));
      const body = DemoStartedSchema.parse({ sessionId: created.scope.sessionId, expiresAt: created.scope.expiresAt, revision: created.scope.revision, locale: created.scope.locale, actorId: created.scope.actorId, workspaceId: created.scope.workspaceId, projectId: created.scope.projectId, inputRefs: created.scope.inputRefs });
      const response = json(body, 201);
      const secure = new URL(origin).protocol === 'https:' ? ' Secure;' : '';
      response.headers.append('Set-Cookie', `${cookieName(body.sessionId)}=${created.capabilityToken}; Max-Age=86400; Path=/api/demo/sessions/${body.sessionId}; HttpOnly; SameSite=Lax;${secure}`);
      return response;
    }
    const sessionId = IdSchema.parse(path[0]), token = capability(request, sessionId);
    if (path[1] === 'operations') {
      await limit(runtime.pool, `demo-operations:${sessionId}:POST`, 60, 60);
      if (path.length === 3 && path[2] === 'plan-proposals') {
        return json(await execution.proposePlan(sessionId, token, await readArtifactJson(request)));
      }
      if (path.length === 3 && path[2] === 'resources') {
        return json(await execution.createResource(sessionId, token, await readArtifactJson(request), idempotencyKey(request)), 201);
      }
      if (path.length === 5 && path[2] === 'resources' && path[4] === 'update') {
        return json(await execution.updateResource(sessionId, token, IdSchema.parse(path[3]), await readArtifactJson(request), idempotencyKey(request)));
      }
      if (path.length === 5 && path[2] === 'resources' && path[4] === 'availability') {
        return json(await execution.createResourceAvailability(sessionId, token, IdSchema.parse(path[3]), await readArtifactJson(request), idempotencyKey(request)), 201);
      }
    }
    if (path.length === 3 && path[1] === 'artifacts' && path[2] === 'access') {
      return json(await execution.artifactAccess(sessionId, token, await readArtifactJson(request)));
    }
    if (path.length === 3 && path[1] === 'artifacts' && path[2] === 'commands') {
      return json(await execution.applyArtifactCommand(sessionId, token, await readArtifactJson(request)));
    }
    if (path.length === 4 && path[1] === 'artifacts' && path[2] === 'history' && ['undo', 'redo'].includes(path[3]!)) {
      return json(await execution.artifactHistoryAction(sessionId, token, path[3] as 'undo' | 'redo', await readArtifactJson(request)));
    }
    if (path.length === 4 && path[1] === 'artifacts' && path[3] === 'branches') {
      return json(await execution.branchArtifact(sessionId, token, IdSchema.parse(path[2]), await readArtifactJson(request), idempotencyKey(request)), 201);
    }
    if (path.length === 2 && path[1] === 'exports') {
      return json(await execution.createExport(sessionId, token, await readArtifactJson(request), idempotencyKey(request)), 201);
    }
    if (path.length === 4 && path[1] === 'exports' && path[3] === 'render') {
      await readArtifactJson(request);
      return json(await execution.renderExport(sessionId, token, IdSchema.parse(path[2]), request.signal));
    }
    if (path.length === 2 && path[1] === 'runs') {
      await execution.read(sessionId, token);
      await limit(runtime.pool, `demo-run:${sessionId}`, 6, 3600);
      const started = await execution.createRun(sessionId, token, StartDemoRunSchema.parse(await readJson(request)), operationKey(request));
      return json(DemoRunStartedSchema.parse({ runId: started.id, cursor: started.cursor }), 202);
    }
    if (path.length === 4 && path[1] === 'runs' && path[3] === 'resume') {
      const runId = IdSchema.parse(path[2]);
      return json(await execution.resumeRun(sessionId, token, runId, ResumeRunSchema.parse(await readJson(request)), operationKey(request)), 202);
    }
    if (path.length === 2 && path[1] === 'copy') {
      const actor = await getIdentityHandlers().getActor(request.headers);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      return json(await execution.copy(sessionId, token, principal, CopyDemoSchema.parse(await readJson(request)), operationKey(request)), 201);
    }
    throw new DemoExecutionError('DEMO_NOT_FOUND');
  } catch (error) { return demoErrorResponse(error); }
}

export function resetDemoHttpForTests() { service = undefined; }
