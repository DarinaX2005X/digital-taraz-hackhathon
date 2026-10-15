import { z } from 'zod';
import { ErrorEnvelopeSchema, type ErrorCode } from '../../../contracts/errors';
import { IdSchema } from '../../../contracts/primitives';
import { CancelRunSchema, CreateRunSchema, ResumeRunSchema, RunEventsPageSchema, RunListPageSchema, RunSchema, type CreateRun } from '../../../contracts/runs';

export class RunClientError extends Error {
  constructor(readonly code: ErrorCode | 'NETWORK' | 'INVALID_RESPONSE', readonly status: number, readonly messageKey?: string) { super(code); }
}
export interface RunRequestOptions { userId: string; signal?: AbortSignal }

export async function assertRunResponse(response: Response) {
  if (response.ok) return;
  const error = ErrorEnvelopeSchema.safeParse(await response.json().catch(() => null));
  throw new RunClientError(error.success ? error.data.code : response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE', response.status, error.success ? error.data.messageKey : undefined);
}

export function createRunClient(fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, schema: z.ZodType<T>, options: RunRequestOptions, body?: unknown, key?: string) {
    IdSchema.parse(options.userId);
    const timeout = AbortSignal.timeout(20_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      const response = await fetcher(path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
        headers: { Accept: 'application/json', 'X-Tirlik-User-Id': options.userId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await assertRunResponse(response);
      const parsed = schema.safeParse(await response.json().catch(() => null));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!parsed.success) throw new RunClientError('INVALID_RESPONSE', response.status);
      return parsed.data;
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof RunClientError) throw error;
      throw new RunClientError('NETWORK', 0);
    }
  }
  return {
    list(workspaceId: string, options: RunRequestOptions, before?: string, projectId?: string) {
      const query = new URLSearchParams({ workspaceId: IdSchema.parse(workspaceId) });
      if (before) query.set('before', before);
      if (projectId) query.set('projectId', IdSchema.parse(projectId));
      return request(`/api/runs?${query}`, RunListPageSchema, options);
    },
    read: (runId: string, options: RunRequestOptions) => request(`/api/runs/${IdSchema.parse(runId)}`, RunSchema, options),
    events: (runId: string, after: number, options: RunRequestOptions) => request(`/api/runs/${IdSchema.parse(runId)}/events?after=${after}`, RunEventsPageSchema, options),
    create: (input: CreateRun, key: string, options: RunRequestOptions) => request('/api/runs', RunSchema, options, CreateRunSchema.parse(input), key),
    cancel: (runId: string, expectedEpoch: number, key: string, options: RunRequestOptions) => request(`/api/runs/${IdSchema.parse(runId)}/cancel`, RunSchema, options, CancelRunSchema.parse({ expectedEpoch }), key),
    resume: (runId: string, expectedEpoch: number, key: string, options: RunRequestOptions, stepId?: string) => request(`/api/runs/${IdSchema.parse(runId)}/resume`, RunSchema, options, ResumeRunSchema.parse({ expectedEpoch, ...(stepId ? { stepId } : {}) }), key),
  };
}
export const runClient = createRunClient();
