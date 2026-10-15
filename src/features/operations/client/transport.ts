import { z } from 'zod';

import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { IdSchema } from '@/contracts/primitives';
import {
  AvailabilityHistorySchema,
  AvailabilityVersionResultSchema,
  WorkResourceListSchema,
  WorkResourceResultSchema,
  type WorkResource,
} from '../contracts';

export class OperationsRequestError extends Error {
  constructor(readonly status: number, readonly messageKey: string) { super(messageKey); }
}
export interface OperationsContext { userId: string; signal?: AbortSignal }
const queryString = (values: object) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)])).toString();

export function createOperationsClient(fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, method: 'GET' | 'POST', schema: z.ZodType<T>, context: OperationsContext, body?: unknown, operationId?: string) {
    const response = await fetcher(path, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'X-Tirlik-User-Id': IdSchema.parse(context.userId), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(operationId ? { 'Idempotency-Key': IdSchema.parse(operationId) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([AbortSignal.timeout(90_000), ...(context.signal ? [context.signal] : [])]),
    });
    if (!response.ok) { const error = ErrorEnvelopeSchema.safeParse(await response.json().catch(() => null)); throw new OperationsRequestError(response.status, error.success ? error.data.messageKey : 'operations.errors.network'); }
    const parsed = schema.safeParse(await response.json()); if (!parsed.success) throw new OperationsRequestError(502, 'operations.errors.invalidResponse');
    return parsed.data;
  }
  const root = '/api/operations';
  return {
    list: (input: { workspaceId: string; query?: string; kinds?: WorkResource['kind'][]; status?: WorkResource['status']; after?: string; limit?: number }, context: OperationsContext) => request(`${root}/resources?${queryString(input)}`, 'GET', WorkResourceListSchema, context),
    read: (workspaceId: string, id: string, context: OperationsContext) => request(`${root}/resources/${IdSchema.parse(id)}?${queryString({ workspaceId })}`, 'GET', WorkResourceResultSchema, context),
    create: (input: unknown, operationId: string, context: OperationsContext) => request(`${root}/resources`, 'POST', WorkResourceResultSchema, context, input, operationId),
    update: (id: string, input: unknown, operationId: string, context: OperationsContext) => request(`${root}/resources/${IdSchema.parse(id)}/update`, 'POST', WorkResourceResultSchema, context, input, operationId),
    createAvailability: (id: string, input: unknown, operationId: string, context: OperationsContext) => request(`${root}/resources/${IdSchema.parse(id)}/availability`, 'POST', AvailabilityVersionResultSchema, context, input, operationId),
    availabilityHistory: (workspaceId: string, id: string, beforeRevision: number | undefined, context: OperationsContext) => request(`${root}/resources/${IdSchema.parse(id)}/availability?${queryString({ workspaceId, beforeRevision })}`, 'GET', AvailabilityHistorySchema, context),
  };
}

export const operationsClient = createOperationsClient();

