import { ErrorEnvelopeSchema, type ErrorCode } from '@/contracts/errors';
import { IdSchema } from '@/contracts/primitives';
import {
  FinanceRecalculateRequestSchema,
  FinanceRecalculateResultSchema,
  type FinanceRecalculateRequest,
} from '../contracts';

export class FinanceRecalculationError extends Error {
  constructor(readonly code: ErrorCode | 'NETWORK' | 'INVALID_RESPONSE', readonly status: number, readonly messageKey?: string) {
    super(code);
  }
}

export interface FinanceRecalculationOptions { userId: string; signal?: AbortSignal }

export function createFinanceRecalculationClient(fetcher: typeof fetch = fetch) {
  return async function recalculate(input: FinanceRecalculateRequest, operationId: string, options: FinanceRecalculationOptions) {
    const body = FinanceRecalculateRequestSchema.parse(input);
    const userId = IdSchema.parse(options.userId), key = IdSchema.parse(operationId);
    const timeout = AbortSignal.timeout(30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      const response = await fetcher('/api/finance/recalculate', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Tirlik-User-Id': userId, 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        const error = ErrorEnvelopeSchema.safeParse(raw);
        throw new FinanceRecalculationError(error.success ? error.data.code : response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE', response.status, error.success ? error.data.messageKey : undefined);
      }
      const result = FinanceRecalculateResultSchema.safeParse(raw);
      if (!result.success) throw new FinanceRecalculationError('INVALID_RESPONSE', response.status);
      return result.data;
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof FinanceRecalculationError) throw error;
      throw new FinanceRecalculationError('NETWORK', 0);
    }
  };
}

export const financeRecalculationClient = createFinanceRecalculationClient();
