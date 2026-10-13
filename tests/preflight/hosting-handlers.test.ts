import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { PreflightError, readBoundedBody } from '@/server/preflight/contracts';
import { createHostingHandlers } from '@/server/preflight/handlers';
import type { HostingOperations } from '@/server/preflight/service';

const probeId = '10000000-0000-4000-8000-000000000001';
const token = 'synthetic-test-token-with-at-least-32-characters';
const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test', PREFLIGHT_HOSTING_ENABLED: '1', PREFLIGHT_HOSTING_TOKEN: token, VERCEL_ENV: 'preview', VERCEL_DEPLOYMENT_ID: 'dpl_test' };
function operations() {
  return {
    start: vi.fn().mockResolvedValue({ runId: 'wrun_test' }),
    resume: vi.fn().mockResolvedValue({ runId: 'wrun_test' }),
    status: vi.fn().mockResolvedValue({ probeId }),
    file: vi.fn().mockResolvedValue(Buffer.from('{"synthetic":true}')),
    remove: vi.fn().mockResolvedValue(undefined),
  } satisfies HostingOperations;
}
function request(method = 'POST', headers: Record<string, string> = {}, body = JSON.stringify({ probeId })) {
  return new Request(`https://preview.example/api/preflight/hosting?probeId=${probeId}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': probeId, ...headers },
    ...(method === 'GET' ? {} : { body }),
  });
}

describe('preview-only hosting probe handlers', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['POST', 'GET', 'RESUME', 'FILE', 'DELETE'] as const)('keeps %s disabled outside an enabled preview', async (method) => {
    const ops = operations();
    for (const env of [{ NODE_ENV: 'test' as const }, { ...environment, VERCEL_ENV: 'production' }, { ...environment, PREFLIGHT_HOSTING_ENABLED: '0' }]) {
      const response = await createHostingHandlers(ops, () => env)[method](request(method === 'GET' || method === 'FILE' ? 'GET' : 'POST'));
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store, private');
      expect(ErrorEnvelopeSchema.parse(await response.json()).code).toBe('NOT_FOUND');
    }
    for (const operation of Object.values(ops)) expect(operation).not.toHaveBeenCalled();
  });

  it('authenticates before reading or executing and rejects cross-origin calls', async () => {
    const ops = operations();
    const handlers = createHostingHandlers(ops, () => environment);
    for (const authorization of ['', 'Bearer wrong', `Bearer ${'x'.repeat(10000)}`]) {
      expect((await handlers.POST(request('POST', { authorization }))).status).toBe(401);
    }
    expect((await handlers.POST(request('POST', { origin: 'https://attacker.example' }))).status).toBe(403);
    expect(ops.start).not.toHaveBeenCalled();
  });

  it('requires a strictly validated UUID and matching idempotency key', async () => {
    const ops = operations();
    const handlers = createHostingHandlers(ops, () => environment);
    expect((await handlers.POST(request('POST', { 'idempotency-key': '' }))).status).toBe(422);
    expect((await handlers.POST(request('POST', {}, JSON.stringify({ probeId, arbitraryPayload: 'refused' })))).status).toBe(422);
    expect((await handlers.POST(request('POST', {}, '{invalid'))).status).toBe(422);
    expect((await handlers.POST(request('POST', { 'content-type': 'text/plain' }))).status).toBe(422);
    expect((await handlers.POST(request('POST', { 'content-length': '2048' }))).status).toBe(413);
    expect((await handlers.POST(request('POST', {}, ' '.repeat(1025)))).status).toBe(413);
    expect(ops.start).not.toHaveBeenCalled();
    const response = await handlers.POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ probeId, runId: 'wrun_test', deploymentId: 'dpl_test' });
    expect(ops.start).toHaveBeenCalledExactlyOnceWith(probeId, 'dpl_test');
  });

  it('rejects duplicate and unexpected query parameters', async () => {
    const ops = operations();
    const handlers = createHostingHandlers(ops, () => environment);
    for (const query of [`probeId=${probeId}&probeId=${probeId}`, `probeId=${probeId}&url=https://example.test`, 'probeId=bad']) {
      const response = await handlers.GET(new Request(`https://preview.example/api/preflight/hosting?${query}`, { headers: { authorization: `Bearer ${token}` } }));
      expect(response.status).toBe(422);
    }
    expect(ops.status).not.toHaveBeenCalled();
  });

  it('returns a private attachment and retains the database admission receipt on cleanup', async () => {
    const ops = operations();
    const handlers = createHostingHandlers(ops, () => environment);
    const file = await handlers.FILE(request('GET'));
    expect(file.headers.get('cache-control')).toBe('no-store, private');
    expect(file.headers.get('content-disposition')).toContain('attachment;');
    expect(await file.text()).toBe('{"synthetic":true}');
    const deleted = await handlers.DELETE(request('DELETE'));
    expect(await deleted.json()).toEqual({ probeId, deleted: true, receiptRetained: true });
    expect(ops.remove).toHaveBeenCalledExactlyOnceWith(probeId);
  });

  it('does not expose raw provider, connection, or secret-bearing errors', async () => {
    const ops = operations();
    ops.start.mockRejectedValue(new Error('postgres://sensitive.invalid SECRET_TOKEN'));
    const response = await createHostingHandlers(ops, () => environment).POST(request());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toMatch(/postgres|SECRET_TOKEN|sensitive/);
    expect(ErrorEnvelopeSchema.parse(JSON.parse(text)).retryable).toBe(false);
  });

  it('enforces the read deadline even when the underlying cancellation never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const pending = readBoundedBody(new ReadableStream({ cancel }), 1024, 20);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels an oversized chunked stream without awaiting cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1025)); }, cancel });
    await expect(readBoundedBody(stream, 1024)).rejects.toEqual(new PreflightError('PAYLOAD_TOO_LARGE'));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
