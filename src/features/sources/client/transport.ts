import { z } from 'zod';
import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { IdSchema } from '@/contracts/primitives';
import { InitSourceUploadSchema, SourceDetailSchema, SourceInitResultSchema, SourcePreviewSchema, SourceUploadResultSchema, SourceVersionSchema, SourceVisualAssetListSchema, SourceVisualAssetQuerySchema, SourceReviewSchema, SourceOcrQuoteSchema, type InitSourceUpload, type SourceFormat, type SourceVisualAssetQuery, type SourcePageContent } from '@/contracts/sources';
import { RunSchema } from '@/contracts/runs';
import { LibraryLifecycleMutationRequestSchema, LibraryLifecycleResultSchema, type LibraryLifecycleMutationRequest } from '@/contracts/library-lifecycle';

export class SourceRequestError extends Error {
  constructor(readonly status: number, readonly messageKey: string) { super(messageKey); }
}
export type SourceRequestContext = { userId: string; signal?: AbortSignal };
const invalid = () => new SourceRequestError(422, 'sources.errors.validation');
export function sourceFileFormat(name: string): SourceFormat | undefined {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return ({ txt: 'text', md: 'text', csv: 'csv', tsv: 'tsv', xlsx: 'xlsx', docx: 'docx', pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', ttf: 'ttf', otf: 'otf', woff: 'woff' } as Record<string, SourceFormat>)[extension ?? ''];
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
    read: (workspaceId: string, sourceId: string, context: SourceRequestContext, selectedUploadId?: string) => request(`/api/sources/${IdSchema.parse(sourceId)}?${query(workspaceId)}${selectedUploadId ? `&uploadId=${IdSchema.parse(selectedUploadId)}` : ''}`, 'GET', SourceDetailSchema, context),
    lifecycle: (input: LibraryLifecycleMutationRequest, context: SourceRequestContext) => { const body = LibraryLifecycleMutationRequestSchema.parse(input); return request(`/api/sources/${body.command.objectId}/lifecycle`, 'POST', LibraryLifecycleResultSchema, context, body, body.operationId); },
    readVersion: (workspaceId: string, sourceId: string, sourceVersionId: string, context: SourceRequestContext) => request(`/api/sources/${IdSchema.parse(sourceId)}/versions/${IdSchema.parse(sourceVersionId)}?${query(workspaceId)}`, 'GET', SourceVersionSchema, context),
    listAssets: (input: SourceVisualAssetQuery, context: SourceRequestContext) => { const parsed = SourceVisualAssetQuerySchema.parse(input); return request(`/api/sources/assets?${new URLSearchParams(Object.entries(parsed).map(([key, value]) => [key, String(value)]))}`, 'GET', SourceVisualAssetListSchema, context); },
    review: (workspaceId: string, uploadId: string, context: SourceRequestContext) => request(`/api/sources/uploads/${IdSchema.parse(uploadId)}/review?${query(workspaceId)}`, 'GET', SourceReviewSchema, context),
    recognitionQuote: (workspaceId: string, uploadId: string, pageLimit: number, context: SourceRequestContext) => request(`/api/sources/uploads/${IdSchema.parse(uploadId)}/recognition-quote?${query(workspaceId)}&pageLimit=${pageLimit}`, 'GET', SourceOcrQuoteSchema, context),
    recognize: (workspaceId: string, uploadId: string, locale: 'ru' | 'kk' | 'en', pageLimit: number, quote: { pages: number[]; maximumUsd: string }, operationId: string, context: SourceRequestContext) => request(`/api/sources/uploads/${IdSchema.parse(uploadId)}/recognize`, 'POST', RunSchema, context, { workspaceId, locale, pageLimit, expectedPages: quote.pages, maximumUsd: quote.maximumUsd }, operationId),
    acceptPage: (workspaceId: string, uploadId: string, page: number, expectedRevision: number, content: SourcePageContent, context: SourceRequestContext) => request(`/api/sources/uploads/${IdSchema.parse(uploadId)}/review`, 'POST', SourceReviewSchema, context, { workspaceId, page, expectedRevision, content }),
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
    async font(workspaceId: string, assetId: string, context: SourceRequestContext) {
      const result = await response(`/api/sources/assets/${IdSchema.parse(assetId)}?${query(workspaceId)}`, { method: 'GET' }, context);
      if (!['font/ttf', 'font/otf', 'font/woff'].includes(result.headers.get('content-type') ?? '')) throw invalid();
      return result.blob();
    },
    async pageImage(workspaceId: string, uploadId: string, page: number, context: SourceRequestContext) {
      const result = await response(`/api/sources/uploads/${IdSchema.parse(uploadId)}/pages/${page}/image?${query(workspaceId)}`, { method: 'GET' }, context);
      if (result.headers.get('content-type') !== 'image/png') throw invalid();
      return result.blob();
    },
    async thumbnail(workspaceId: string, uploadId: string, context: SourceRequestContext) {
      const result = await response(`/api/sources/uploads/${IdSchema.parse(uploadId)}/thumbnail?${query(workspaceId)}`, { method: 'GET' }, context);
      if (result.headers.get('content-type') !== 'image/webp') throw invalid();
      return result.blob();
    },
  };
}
export const sourceClient = createSourceClient();
