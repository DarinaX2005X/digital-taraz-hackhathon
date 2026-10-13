import { describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema } from '../../../src/contracts/errors';
import { assertOrigin, errorResponse, IdentityError, readJson } from '../../../src/features/identity/server/http';

describe('identity HTTP boundary', () => {
  it('requires the exact configured origin for mutations', () => {
    const origin = 'https://tirlik.example';
    const variants: HeadersInit[] = [{}, { origin: 'https://evil.example' }, { origin, 'sec-fetch-site': 'cross-site' }];
    for (const headers of variants) expect(() => assertOrigin(new Request(origin, { headers }), origin)).toThrow(IdentityError);
    expect(() => assertOrigin(new Request(origin, { headers: { origin } }), origin)).not.toThrow();
  });
  it('bounds streamed bodies even without content length', async () => {
    const response = new Request('https://tirlik.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'x'.repeat(65536) }) });
    await expect(readJson(response)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(readJson(new Request('https://tirlik.example', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('returns canonical errors without technical details', async () => {
    const unknown = errorResponse(new Error('secret database credential'));
    const body = ErrorEnvelopeSchema.parse(await unknown.json());
    expect(unknown.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain('credential');
    const limited = errorResponse(new IdentityError('RATE_LIMITED', 'identity.errors.rateLimited', undefined, 60));
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(limited.headers.get('cache-control')).toBe('no-store');
  });
});
