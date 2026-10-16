import { z } from 'zod';
import { ChangeSetSchema, PrepareChangesSchema, ReviewChangesSchema } from '@/contracts/dependencies';
import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { IdSchema } from '@/contracts/primitives';
import { CommandReceiptSchema, type ArtifactViewer } from '@/features/artifacts/contracts';
import { ChangeSetListResultSchema } from './contracts';
export const ReviewReceiptSchema = z.strictObject({ changeset: ChangeSetSchema, receipt: CommandReceiptSchema.optional() });
export const PendingReviewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('prepare'), id: IdSchema, body: PrepareChangesSchema }),
  z.strictObject({ kind: z.enum(['accept', 'reject']), id: IdSchema, changesetId: IdSchema, body: ReviewChangesSchema }),
]);
export type PendingReview = z.infer<typeof PendingReviewSchema>;
export class ReviewError extends Error { constructor(readonly status: number, readonly uncertain: boolean) { super('linked-change-request-failed'); } }
async function boundedJson(response: Response, uncertain: boolean) {
  const maximum = 24 * 1024 * 1024;
  if (Number(response.headers.get('Content-Length')) > maximum) { await response.body?.cancel(); throw new ReviewError(response.status, uncertain); }
  const reader = response.body?.getReader();
  if (!reader) throw new ReviewError(response.status, uncertain);
  let bytes = 0, body = ''; const decoder = new TextDecoder();
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > maximum) { await reader.cancel(); throw new ReviewError(response.status, uncertain); } body += decoder.decode(part.value, { stream: true }); } return JSON.parse(body + decoder.decode()) as unknown; }
  finally { reader.releaseLock(); }
}
export function createChangeReviewClient(viewer: ArtifactViewer, projectId: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, pending?: PendingReview, signal?: AbortSignal) {
    let response: Response;
    try { response = await fetcher(path, { method: pending ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal, headers: { Accept: 'application/json', 'X-Tirlik-User-Id': viewer.userId, ...(pending ? { 'Content-Type': 'application/json', 'Idempotency-Key': pending.id } : {}) }, ...(pending ? { body: JSON.stringify(pending.body) } : {}) }); }
    catch { throw new ReviewError(0, Boolean(pending)); }
    let body: unknown;
    try { body = await boundedJson(response, Boolean(pending)); } catch { throw new ReviewError(response.status, Boolean(pending)); }
    if (!response.ok) { ErrorEnvelopeSchema.safeParse(body); throw new ReviewError(response.status, response.status >= 500); }
    const result = pending && pending.kind !== 'prepare' ? ReviewReceiptSchema.parse(body) : { changeset: ChangeSetSchema.parse(body) };
    if (result.changeset.workspaceId !== viewer.workspaceId || result.changeset.projectId !== projectId || (pending?.kind !== 'prepare' && pending && result.changeset.id !== pending.changesetId) || (result.receipt && (result.receipt.commandGroupId !== pending?.id || result.receipt.historyGroup.actorId !== viewer.userId))) throw new ReviewError(0, Boolean(pending));
    return result;
  }
  return {
    list: async (after?: string, signal?: AbortSignal) => {
      const query = new URLSearchParams({ workspaceId: viewer.workspaceId, projectId, limit: '20', ...(after ? { after } : {}) });
      let response: Response;
      try { response = await fetcher(`/api/changesets?${query}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal, headers: { Accept: 'application/json', 'X-Tirlik-User-Id': viewer.userId } }); }
      catch { throw new ReviewError(0, false); }
      let body: unknown;
      try { body = await boundedJson(response, false); } catch { throw new ReviewError(response.status, false); }
      if (!response.ok) throw new ReviewError(response.status, false);
      const result = ChangeSetListResultSchema.parse(body);
      if (result.authzVersion < viewer.authzVersion || result.changesets.some((item) => item.workspaceId !== viewer.workspaceId || item.projectId !== projectId)) throw new ReviewError(0, false);
      return result;
    },
    read: (id: string, signal?: AbortSignal) => request(`/api/changesets/${IdSchema.parse(id)}?${new URLSearchParams({ workspaceId: viewer.workspaceId, projectId })}`, undefined, signal),
    submit: (input: PendingReview, signal?: AbortSignal) => {
      const value = PendingReviewSchema.parse(input);
      if (value.body.workspaceId !== viewer.workspaceId || value.body.projectId !== projectId || value.body.expectedAuthzVersion !== viewer.authzVersion) throw new ReviewError(409, false);
      return request(value.kind === 'prepare' ? '/api/changesets' : `/api/changesets/${value.changesetId}/${value.kind}`, value, signal);
    },
  };
}
