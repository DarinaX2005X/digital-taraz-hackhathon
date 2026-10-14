import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ERROR_HTTP_STATUS, type ErrorEnvelope } from '../../../contracts/errors';
import { IdSchema } from '../../../contracts/primitives';
import { IdentityError, json, validate } from '../../identity/server/http';
import { assertBoundedJson, ContentValidationError } from '../domain/canonical';
import { ArtifactConflict } from './service-support';

export async function readArtifactJson(request: Request): Promise<unknown> {
  const maximum = 22 * 1024 * 1024;
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
  if (Number(request.headers.get('content-length')) > maximum) throw new IdentityError('PAYLOAD_TOO_LARGE', 'artifacts.errors.tooLarge');
  const reader = request.body?.getReader(); if (!reader) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new IdentityError('PAYLOAD_TOO_LARGE', 'artifacts.errors.tooLarge'); }
      parts.push(next.value);
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
    catch { throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed'); }
    assertBoundedJson(body, { bytes: maximum, depth: 80, values: 2_500_000 });
    return body;
  } finally { reader.releaseLock(); }
}
export function queryObject(url: URL, allowed: readonly string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(output, key)) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
    output[key] = value;
  }
  return output;
}
export function idempotencyKey(request: Request): string { return validate(IdSchema, request.headers.get('idempotency-key')); }
export function assertActorHeader(request: Request, userId: string) {
  const expected = validate(IdSchema, request.headers.get('x-tirlik-user-id'));
  if (expected !== userId) throw new ArtifactConflict(undefined, undefined, 'reload');
}
export function artifactErrorResponse(error: unknown): Response {
  let known: IdentityError;
  if (error instanceof IdentityError) known = error;
  else if (error instanceof ContentValidationError || error instanceof z.ZodError) known = new IdentityError(error instanceof ContentValidationError && error.reason === 'content-too-large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED', 'artifacts.errors.validationFailed');
  else if (error && typeof error === 'object' && 'code' in error && ['23505', '23503', '23514'].includes(String(error.code))) known = new IdentityError('CONFLICT', 'artifacts.errors.conflict');
  else known = new IdentityError('UNAVAILABLE', 'artifacts.errors.unavailable');
  const body: ErrorEnvelope = { code: known.code, messageKey: known.messageKey, retryable: ['UNAVAILABLE', 'RATE_LIMITED'].includes(known.code), requestId: randomUUID() };
  if (known.fields) body.fieldErrors = known.fields;
  if (known.code === 'UNAUTHENTICATED') body.recovery = 'sign-in';
  if (known.code === 'UNAVAILABLE') body.recovery = 'retry';
  if (known instanceof ArtifactConflict) {
    if (known.conflictRefs?.length) body.conflictRefs = known.conflictRefs;
    if (known.currentRevision !== undefined) body.currentRevision = known.currentRevision;
    body.recovery = known.recovery;
  }
  return json(body, ERROR_HTTP_STATUS[known.code], known.retryAfter ? { 'Retry-After': String(known.retryAfter) } : undefined);
}
