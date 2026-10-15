import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ERROR_HTTP_STATUS, type ErrorEnvelope } from '../../../contracts/errors';
import { IdentityError, json } from '../../identity/server/http';
import { RunError } from '../domain/errors';

export function runError(error: unknown): ErrorEnvelope {
  if (error instanceof RunError) return { code: error.code, messageKey: error.message, retryable: error.retryable, requestId: randomUUID() };
  const known = error instanceof IdentityError ? error : error instanceof z.ZodError
    ? new IdentityError('VALIDATION_FAILED', 'runs.errors.validation')
    : new IdentityError('UNAVAILABLE', 'runs.errors.unavailable');
  return {
    code: known.code, messageKey: known.messageKey, retryable: ['RATE_LIMITED', 'UNAVAILABLE'].includes(known.code), requestId: randomUUID(),
    ...(known.code === 'UNAUTHENTICATED' ? { recovery: 'sign-in' as const } : {}),
  };
}
export function runErrorResponse(error: unknown) {
  const envelope = runError(error);
  return json(envelope, ERROR_HTTP_STATUS[envelope.code], error instanceof IdentityError && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : undefined);
}
export function runQuery(url: URL, allowed: readonly string[]) {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new IdentityError('VALIDATION_FAILED', 'runs.errors.validation');
    result[key] = value;
  }
  return result;
}
