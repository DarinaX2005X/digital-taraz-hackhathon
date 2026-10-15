import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { workspaceClient, workspaceRequest } from '../../src/features/workspace/client/transport';

afterEach(() => vi.unstubAllGlobals());
describe('private workspace transport', () => {
  it('retains privacy status even when an error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Access revoked', { status: 403 })));
    await expect(workspaceRequest('/api/projects', z.object({ ok: z.boolean() }), { userId: randomUUID() })).rejects.toMatchObject({ status: 403 });
  });
  it('rejects another workspace in a successful list response', async () => {
    const ownerId = randomUUID(), workspaceId = randomUUID();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ projects: [{ id: randomUUID(), workspaceId: randomUUID(), title: 'Private', goal: null, status: 'active', revision: 1, createdBy: ownerId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], authzVersion: 1, cursor: 'cursor', nextAfter: null })));
    await expect(workspaceClient.list({ workspaceId }, { userId: ownerId })).rejects.toMatchObject({ status: 403 });
  });
  it('sends the identical idempotency key and actor on explicit retry', async () => {
    const ownerId = randomUUID(), workspaceId = randomUUID(), key = randomUUID();
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const body = { workspaceId, title: 'Quote', goal: 'Keep manual input', expectedAuthzVersion: 2 };
    await expect(workspaceClient.create(body, key, { userId: ownerId })).rejects.toMatchObject({ status: 503 });
    await expect(workspaceClient.create(body, key, { userId: ownerId })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const requests = fetcher.mock.calls.map(([, options]) => options);
    expect(requests[0].body).toBe(requests[1].body);
    expect(requests[0].headers).toMatchObject({ 'Idempotency-Key': key, 'X-Tirlik-User-Id': ownerId });
    expect(requests[0]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  });
  it('does not publish a successful stale response after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { controller.abort(); return Response.json({ ok: true }); }));
    await expect(workspaceRequest('/api/projects', z.object({ ok: z.boolean() }), { userId: randomUUID(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects oversized list payloads and cancels the body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start() {}, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-length': String(2 * 1024 * 1024) } })));
    await expect(workspaceRequest('/api/projects', z.object({ ok: z.boolean() }), { userId: randomUUID() })).rejects.toMatchObject({ status: 502 });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
