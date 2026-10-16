import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSourceClient, SourceRequestError } from '../../src/features/sources/client/transport';

const upload = (id: string, sourceId: string) => ({
  id, sourceId, versionId: null, status: 'uploaded' as const, format: 'pdf' as const,
  fileName: 'large.pdf', byteSize: 6_400_000, byteHash: 'a'.repeat(64), manifest: null, errorCode: null,
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:01.000Z',
});
const r2Token = (url: string) => `r2.v1.${Buffer.from(JSON.stringify({ url })).toString('base64url')}`;

describe('source client upload transport', () => {
  it('uploads R2 bytes directly then commits through the authenticated app route without resending the body', async () => {
    const workspaceId = randomUUID(), uploadId = randomUUID(), sourceId = randomUUID(), userId = randomUUID();
    const target = `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/tirlik-files/${workspaceId}/${uploadId}/original?X-Amz-Signature=${'b'.repeat(64)}`;
    const token = r2Token(target), calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = input.toString(); calls.push({ url, init });
      if (url.startsWith('https://')) return new Response(null, { status: 200, headers: { ETag: '"synthetic"' } });
      return Response.json({ upload: upload(uploadId, sourceId) });
    });
    const result = await createSourceClient(fetcher).put(workspaceId, uploadId, token, new Blob([new Uint8Array(6_400_000)]), { userId });
    expect(result.upload.id).toBe(uploadId);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(target);
    expect(new Headers(calls[0]!.init?.headers)).toMatchObject(expect.any(Headers));
    expect(new Headers(calls[0]!.init?.headers).get('content-type')).toBe('application/octet-stream');
    expect(new Headers(calls[0]!.init?.headers).get('if-none-match')).toBe('*');
    expect(calls[0]!.init?.credentials).toBe('omit');
    expect(calls[1]!.url).toBe(`/api/sources/uploads/${uploadId}?workspaceId=${workspaceId}`);
    expect(calls[1]!.init?.body).toBeUndefined();
    expect(new Headers(calls[1]!.init?.headers).get('x-upload-token')).toBe(token);
    expect(new Headers(calls[1]!.init?.headers).get('x-tirlik-user-id')).toBe(userId);
  });

  it('reconciles an uncertain direct PUT through the server commit and keeps local uploads on the app route', async () => {
    const workspaceId = randomUUID(), uploadId = randomUUID(), sourceId = randomUUID(), userId = randomUUID();
    const target = `https://${'b'.repeat(32)}.r2.cloudflarestorage.com/tirlik-files/${workspaceId}/${uploadId}/original?X-Amz-Signature=${'c'.repeat(64)}`;
    let call = 0;
    const directFetcher = vi.fn<typeof fetch>(async () => {
      if (call++ === 0) throw new TypeError('Synthetic CORS uncertainty');
      return Response.json({ upload: upload(uploadId, sourceId) });
    });
    await expect(createSourceClient(directFetcher).put(workspaceId, uploadId, r2Token(target), new Blob(['safe']), { userId })).resolves.toMatchObject({ upload: { id: uploadId } });
    const localCalls: RequestInit[] = [];
    const localFetcher = vi.fn<typeof fetch>(async (_input, init) => { localCalls.push(init ?? {}); return Response.json({ upload: upload(uploadId, sourceId) }); });
    await createSourceClient(localFetcher).put(workspaceId, uploadId, 'local-token', new Blob(['safe']), { userId });
    expect(localCalls).toHaveLength(1);
    expect(localCalls[0]!.body).toBeInstanceOf(Blob);
    expect(new Headers(localCalls[0]!.headers).get('content-type')).toBe('application/octet-stream');
  });

  it('rejects a prefixed token that tries to send bytes to an arbitrary host', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSourceClient(fetcher).put(randomUUID(), randomUUID(), r2Token('https://example.com/object?X-Amz-Signature=fake'), new Blob(['unsafe']), { userId: randomUUID() })).rejects.toBeInstanceOf(SourceRequestError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
