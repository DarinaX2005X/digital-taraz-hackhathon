import { z } from 'zod';
import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { IdSchema } from '@/contracts/primitives';
import { InitSourceUploadSchema, SourceDetailSchema, SourceInitResultSchema, SourcePreviewSchema, SourceUploadResultSchema, type InitSourceUpload, type SourceFormat } from '@/contracts/sources';

export class SourceRequestError extends Error {
  constructor(readonly status: number, readonly messageKey: string) { super(messageKey); }
}
export type SourceRequestContext = { userId: string; signal?: AbortSignal };
const invalid = () => new SourceRequestError(422, 'sources.errors.validation');
export function sourceFileFormat(name: string): SourceFormat | undefined {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return ({ txt: 'text', md: 'text', csv: 'csv', tsv: 'tsv', xlsx: 'xlsx', docx: 'docx', pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' } as Record<string, SourceFormat>)[extension ?? ''];
}
export function createSourceClient(fetcher: typeof fetch = fetch) {
  async function response(url: string, init: RequestInit, context: SourceRequestContext) {
    if (!IdSchema.safeParse(context.userId).success) throw invalid();
    const headers = new Headers(init.headers); headers.set('X-Tirlik-User-Id', context.userId);
    const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(context.signal ? [context.signal] : [])]);
    const result = await fetcher(url, { ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal });
    if (!result.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(await result.json().catch(() => null));
      throw new SourceRequestError(result.status, parsed.success ? parsed.data.messageKey : 'sources.errors.network');
    }
    return result;
  }
  async function request<T>(url: string, method: 'GET' | 'POST', schema: z.ZodType<T>, context: SourceRequestContext, body?: unknown, operationId?: string) {
    const result = await response(url, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(operationId ? { 'Idempotency-Key': operationId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, context);
    const parsed = schema.safeParse(await result.json()); if (!parsed.success) throw new SourceRequestError(502, 'sources.errors.network');
    return parsed.data;
  }
  const query = (workspaceId: string) => `workspaceId=${IdSchema.parse(workspaceId)}`;
  return {
    init: (body: InitSourceUpload, operationId: string, context: SourceRequestContext) => request('/api/sources/uploads/init', 'POST', SourceInitResultSchema, context, InitSourceUploadSchema.parse(body), IdSchema.parse(operationId)),
    async put(workspaceId: string, uploadId: string, token: string, bytes: Blob, context: SourceRequestContext) {
      const result = await response(`/api/sources/uploads/${IdSchema.parse(uploadId)}?${query(workspaceId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Token': token }, body: bytes }, context);
      return SourceUploadResultSchema.parse(await result.json());
    },
    finalize: (workspaceId: string, uploadId: string, context: SourceRequestContext) => request(`/api/sources/uploads/${IdSchema.parse(uploadId)}/finalize`, 'POST', SourceUploadResultSchema, context, { workspaceId: IdSchema.parse(workspaceId) }),
    cancel: (workspaceId: string, uploadId: string, context: SourceRequestContext) => request(`/api/sources/uploads/${IdSchema.parse(uploadId)}/cancel`, 'POST', SourceUploadResultSchema, context, { workspaceId: IdSchema.parse(workspaceId) }),
    read: (workspaceId: string, sourceId: string, context: SourceRequestContext) => request(`/api/sources/${IdSchema.parse(sourceId)}?${query(workspaceId)}`, 'GET', SourceDetailSchema, context),
    preview: (workspaceId: string, sourceId: string, uploadId: string, chunk: number, context: SourceRequestContext) => request(`/api/sources/${IdSchema.parse(sourceId)}/preview?${query(workspaceId)}&uploadId=${IdSchema.parse(uploadId)}&chunk=${chunk}`, 'GET', SourcePreviewSchema, context),
    async download(workspaceId: string, sourceId: string, uploadId: string, context: SourceRequestContext) {
      const result = await response(`/api/sources/${IdSchema.parse(sourceId)}/original?${query(workspaceId)}&uploadId=${IdSchema.parse(uploadId)}`, { method: 'GET' }, context);
      return result.blob();
    },
    async image(workspaceId: string, assetId: string, context: SourceRequestContext) {
      const result = await response(`/api/sources/assets/${IdSchema.parse(assetId)}?${query(workspaceId)}`, { method: 'GET' }, context);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.headers.get('content-type') ?? '')) throw invalid();
      return result.blob();
    },
  };
}
export const sourceClient = createSourceClient();
