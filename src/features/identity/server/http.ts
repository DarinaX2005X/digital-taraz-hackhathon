import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ERROR_HTTP_STATUS, type ErrorCode, type ErrorEnvelope } from '../../../contracts/errors';

export class IdentityError extends Error {
  constructor(public code: ErrorCode, public messageKey: string, public fields?: ErrorEnvelope['fieldErrors'], public retryAfter?: number) { super(messageKey); }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function json(body: unknown, status = 200, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set('Cache-Control', 'no-store');
  result.set('Referrer-Policy', 'no-referrer');
  result.set('X-Content-Type-Options', 'nosniff');
  return Response.json(body, { status, headers: result });
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof IdentityError ? error : new IdentityError('UNAVAILABLE', 'identity.errors.unavailable');
  const body: ErrorEnvelope = { code: known.code, messageKey: known.messageKey, retryable: ['RATE_LIMITED', 'UNAVAILABLE', 'PROVIDER_FAILED'].includes(known.code), requestId: randomUUID() };
  if (known.fields) body.fieldErrors = known.fields;
  if (known.code === 'UNAUTHENTICATED') body.recovery = 'sign-in';
  return json(body, ERROR_HTTP_STATUS[known.code], known.retryAfter ? { 'Retry-After': String(known.retryAfter) } : undefined);
}
export function assertOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
}
export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
  if (Number(request.headers.get('content-length')) > 65536) throw new IdentityError('PAYLOAD_TOO_LARGE', 'identity.errors.validationFailed');
  const reader = request.body?.getReader();
  if (!reader) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 65536) { await reader.cancel(); throw new IdentityError('PAYLOAD_TOO_LARGE', 'identity.errors.validationFailed'); }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed'); }
}
export function validate<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) fields[String(issue.path[0] ?? 'form')] = ['identity.errors.validationFailed'];
    throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed', fields);
  }
  return result.data;
}
export async function limit(pool: Pool, key: string, max: number, seconds: number) {
  await pool.query('DELETE FROM identity_rate_limits WHERE key IN (SELECT key FROM identity_rate_limits WHERE expires_at<now() LIMIT 100)');
  const result = await pool.query<{ count: number }>(`INSERT INTO identity_rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN identity_rate_limits.expires_at <= now() THEN 1 ELSE identity_rate_limits.count+1 END,
      expires_at=CASE WHEN identity_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE identity_rate_limits.expires_at END RETURNING count`, [digest(key), seconds]);
  if (!result.rows[0] || result.rows[0].count > max) throw new IdentityError('RATE_LIMITED', 'identity.errors.rateLimited', undefined, seconds);
}
export function cookie(request: Request, name: string): string | undefined {
  const pair = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}
