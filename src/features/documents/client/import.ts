import type { z } from 'zod';
import { IdSchema } from '@/contracts/primitives';
import { ArtifactMutationResultSchema } from '@/features/artifacts/contracts';
import { DocumentImportPreviewSchema, DocumentImportRequestSchema } from '../contracts';

export class DocumentImportError extends Error {
  constructor(readonly status: number) { super('document-import-failed'); }
}
export function createDocumentImportClient(fetcher: typeof fetch = fetch) {
  async function request<T>(input: z.input<typeof DocumentImportRequestSchema>, key: string, userId: string, schema: z.ZodType<T>, signal?: AbortSignal) {
    const body = DocumentImportRequestSchema.parse(input);
    const response = await fetcher('/api/documents/import', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]), headers: { 'Content-Type': 'application/json', 'X-Tirlik-User-Id': IdSchema.parse(userId), 'Idempotency-Key': IdSchema.parse(key) }, body: JSON.stringify(body) });
    if (!response.ok) throw new DocumentImportError(response.status);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new DocumentImportError(502);
    return parsed.data;
  }
  return {
    preview: (input: Omit<z.input<typeof DocumentImportRequestSchema>, 'action' | 'previewHash'>, key: string, userId: string, signal?: AbortSignal) => request({ ...input, action: 'preview' }, key, userId, DocumentImportPreviewSchema, signal),
    create: (input: Omit<z.input<typeof DocumentImportRequestSchema>, 'action'> & { previewHash: string }, key: string, userId: string, signal?: AbortSignal) => request({ ...input, action: 'create' }, key, userId, ArtifactMutationResultSchema, signal),
  };
}
export const documentImportClient = createDocumentImportClient();
