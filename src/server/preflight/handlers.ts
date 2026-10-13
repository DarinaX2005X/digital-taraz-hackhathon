import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ERROR_HTTP_STATUS, ErrorEnvelopeSchema, type ErrorCode } from '@/contracts/errors';
import { HostingProbeInputSchema, PreflightError, readBoundedBody } from './contracts';
import { hostingOperations, type HostingOperations } from './service';

const noCache = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
const messageKeys: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'common.errors.unauthenticated', FORBIDDEN: 'common.errors.forbidden',
  NOT_FOUND: 'common.errors.notFound', CONFLICT: 'common.errors.conflict',
  PAYLOAD_TOO_LARGE: 'common.errors.payloadTooLarge', VALIDATION_FAILED: 'common.errors.validationFailed',
  RATE_LIMITED: 'common.errors.rateLimited', PROVIDER_FAILED: 'common.errors.providerFailed',
  UNAVAILABLE: 'common.errors.unavailable', INTERNAL_ERROR: 'common.errors.unexpected',
};

function authorize(request: Request, env: NodeJS.ProcessEnv): string {
  if (env.PREFLIGHT_HOSTING_ENABLED !== '1' || env.VERCEL_ENV !== 'preview') throw new PreflightError('NOT_FOUND');
  const token = env.PREFLIGHT_HOSTING_TOKEN;
  if (!token || token.length < 32 || token.length > 256) throw new PreflightError('UNAVAILABLE');
  const authorization = request.headers.get('authorization') ?? '';
  const supplied = authorization.startsWith('Bearer ') && authorization.length <= 263 ? authorization.slice(7) : '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(supplied), digest(token))) throw new PreflightError('UNAUTHENTICATED');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new PreflightError('FORBIDDEN');
  return env.VERCEL_DEPLOYMENT_ID || 'local';
}

async function readInput(request: Request): Promise<string> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new PreflightError('VALIDATION_FAILED');
  }
  const advertised = request.headers.get('content-length');
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > 1024)) throw new PreflightError('PAYLOAD_TOO_LARGE');
  const bytes = await readBoundedBody(request.body, 1024);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PreflightError('VALIDATION_FAILED');
  }
  const parsed = HostingProbeInputSchema.safeParse(value);
  if (!parsed.success) throw new PreflightError('VALIDATION_FAILED');
  if (request.headers.get('idempotency-key') !== parsed.data.probeId) throw new PreflightError('VALIDATION_FAILED');
  return parsed.data.probeId;
}

function queryId(request: Request): string {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== 'probeId') || params.getAll('probeId').length !== 1) {
    throw new PreflightError('VALIDATION_FAILED');
  }
  const parsed = HostingProbeInputSchema.safeParse({ probeId: params.get('probeId') });
  if (!parsed.success) throw new PreflightError('VALIDATION_FAILED');
  return parsed.data.probeId;
}

export function createHostingHandlers(operations: HostingOperations, environment = () => process.env) {
  async function handle(request: Request, operation: (deploymentId: string) => Promise<Response>): Promise<Response> {
    try {
      return await operation(authorize(request, environment()));
    } catch (error) {
      const failure = error instanceof PreflightError ? error : new PreflightError('UNAVAILABLE');
      return Response.json(ErrorEnvelopeSchema.parse({
        code: failure.code, messageKey: messageKeys[failure.code], retryable: failure.retryable,
        requestId: randomUUID(),
      }), { status: ERROR_HTTP_STATUS[failure.code], headers: noCache });
    }
  }
  return {
    POST: (request: Request) => handle(request, async (deploymentId) => {
      const probeId = await readInput(request);
      return Response.json({ probeId, ...await operations.start(probeId, deploymentId), deploymentId }, { status: 202, headers: noCache });
    }),
    GET: (request: Request) => handle(request, async (deploymentId) => {
      return Response.json(await operations.status(queryId(request), deploymentId), { headers: noCache });
    }),
    RESUME: (request: Request) => handle(request, async (deploymentId) => {
      const probeId = await readInput(request);
      return Response.json({ probeId, ...await operations.resume(probeId, deploymentId), deploymentId }, { status: 202, headers: noCache });
    }),
    FILE: (request: Request) => handle(request, async () => {
      const bytes = await operations.file(queryId(request));
      return new Response(new Uint8Array(bytes), { headers: {
        ...noCache, 'Content-Type': 'application/json', 'Content-Length': String(bytes.length),
        'Content-Disposition': 'attachment; filename="synthetic-hosting-probe.json"',
      } });
    }),
    DELETE: (request: Request) => handle(request, async () => {
      const probeId = await readInput(request);
      await operations.remove(probeId);
      return Response.json({ probeId, deleted: true, receiptRetained: true }, { headers: noCache });
    }),
  };
}

const handlers = createHostingHandlers(hostingOperations);
export const handleHostingPOST = handlers.POST;
export const handleHostingGET = handlers.GET;
export const handleHostingResumePOST = handlers.RESUME;
export const handleHostingFileGET = handlers.FILE;
export const handleHostingDELETE = handlers.DELETE;
