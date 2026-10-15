import { z } from 'zod';
import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { IdSchema } from '@/contracts/primitives';
import { SourceListSchema, type SourceLibraryQuery } from '@/contracts/sources';
import { ArtifactMutationResultSchema, SourceFreshnessSchema } from '@/features/artifacts/contracts';
import { BoundFactsSchema, CollectionListSchema, CollectionResultSchema, CorrectionResultSchema, DatasetFacetSchema, DatasetGroupPageSchema, DatasetPageSchema, ImportPreviewSchema, ImportResultSchema, MaterialDecisionContextSchema, MaterialHistorySchema, MaterialSourcePreviewSchema, ResolutionResultSchema, type CollectionListInput, type DatasetBrowseQuery } from '@/contracts/materials';

export class MaterialRequestError extends Error {
  constructor(readonly status: number, readonly messageKey: string) { super(messageKey); }
}
export type MaterialContext = { userId: string; signal?: AbortSignal };
const queryString = (values: object) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
export function createMaterialClient(fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, method: 'GET' | 'POST', schema: z.ZodType<T>, context: MaterialContext, body?: unknown, key?: string) {
    const result = await fetcher(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'X-Tirlik-User-Id': IdSchema.parse(context.userId), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': IdSchema.parse(key) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([AbortSignal.timeout(90_000), ...(context.signal ? [context.signal] : [])]) });
    if (!result.ok) { const error = ErrorEnvelopeSchema.safeParse(await result.json().catch(() => null)); throw new MaterialRequestError(result.status, error.success ? error.data.messageKey : 'materials.errors.network'); }
    const parsed = schema.safeParse(await result.json()); if (!parsed.success) throw new MaterialRequestError(502, 'materials.errors.network');
    return parsed.data;
  }
  const root = '/api/materials';
  return {
    list: (input: Partial<CollectionListInput> & { workspaceId: string }, context: MaterialContext) => request(`${root}/collections?${queryString(input)}`, 'GET', CollectionListSchema, context),
    read: (workspaceId: string, id: string, context: MaterialContext) => request(`${root}/collections/${IdSchema.parse(id)}?${queryString({ workspaceId })}`, 'GET', CollectionResultSchema, context),
    sources: (input: SourceLibraryQuery, context: MaterialContext) => request(`/api/sources/library?${queryString(input)}`, 'GET', SourceListSchema, context),
    source: (input: { workspaceId: string; sourceId: string; sourceVersionId: string; chunk?: number; sheet?: string; row?: number }, context: MaterialContext) => request(`${root}/source-preview?${queryString(input)}`, 'GET', MaterialSourcePreviewSchema, context),
    create: (input: unknown, key: string, context: MaterialContext) => request(`${root}/collections`, 'POST', CollectionResultSchema, context, input, key),
    begin: (input: unknown, key: string, context: MaterialContext) => request(`${root}/imports`, 'POST', ImportResultSchema, context, input, key),
    preview: (workspaceId: string, id: string, options: { after?: string; change?: string }, context: MaterialContext) => request(`${root}/imports/${IdSchema.parse(id)}?${queryString({ workspaceId, ...options })}`, 'GET', ImportPreviewSchema, context),
    importAction: (id: string, action: 'advance' | 'cancel' | 'resolve' | 'undo-decision' | 'apply', input: unknown, key: string, context: MaterialContext) => request(`${root}/imports/${IdSchema.parse(id)}/${action}`, 'POST', ImportResultSchema, context, input, key),
    query: (input: Partial<DatasetBrowseQuery> & { workspaceId: string; collectionId: string }, context: MaterialContext) => request(`${root}/datasets/query`, 'POST', DatasetPageSchema, context, input),
    facet: (input: unknown, context: MaterialContext) => request(`${root}/datasets/facet`, 'POST', DatasetFacetSchema, context, input),
    group: (input: unknown, context: MaterialContext) => request(`${root}/datasets/group`, 'POST', DatasetGroupPageSchema, context, input),
    decisionContext: (input: unknown, context: MaterialContext) => request(`${root}/context/read`, 'POST', MaterialDecisionContextSchema, context, input),
    facts: (input: unknown, context: MaterialContext) => request(`${root}/facts/read`, 'POST', BoundFactsSchema.extend({ sourceFreshness: z.array(SourceFreshnessSchema).max(100) }), context, input),
    history: (workspaceId: string, id: string, beforeRevision: number | undefined, context: MaterialContext) => request(`${root}/collections/${IdSchema.parse(id)}/history?${queryString({ workspaceId, beforeRevision })}`, 'GET', MaterialHistorySchema, context),
    correctionPreview: (id: string, input: unknown, context: MaterialContext) => request(`${root}/collections/${IdSchema.parse(id)}/correction-preview`, 'POST', CorrectionResultSchema, context, input),
    correct: (id: string, input: unknown, key: string, context: MaterialContext) => request(`${root}/collections/${IdSchema.parse(id)}/correct`, 'POST', ResolutionResultSchema, context, input, key),
    undo: (id: string, input: unknown, key: string, context: MaterialContext) => request(`${root}/collections/${IdSchema.parse(id)}/undo`, 'POST', ResolutionResultSchema, context, input, key),
    materialize: (input: unknown, key: string, context: MaterialContext) => request('/api/sheets/materialize', 'POST', ArtifactMutationResultSchema, context, input, key),
  };
}
export const materialClient = createMaterialClient();
