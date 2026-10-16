import { ProjectGrantResultSchema } from '../../workspace/contracts';
import { ArtifactVersionCommentSchema, ArtifactVersionDecisionSchema, CollaborationThreadSchema, ProjectAccessListSchema } from '../contracts';

export class CollaborationRequestError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
export interface CollaborationClientContext { userId: string; signal?: AbortSignal }
async function request<T>(path: string, schema: { parse(value: unknown): T }, context: CollaborationClientContext, body?: unknown, key?: string) {
  const controller = new AbortController(), abort = () => controller.abort(); let timedOut = false;
  context.signal?.addEventListener('abort', abort, { once: true }); if (context.signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json', 'X-Tirlik-User-Id': context.userId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (Number(response.headers.get('content-length')) > 1024 * 1024) { void response.body?.cancel(); throw new CollaborationRequestError(502, 'RESPONSE_TOO_LARGE'); }
    const text = await boundedText(response); const value: unknown = text ? JSON.parse(text) : {};
    if (!response.ok) throw new CollaborationRequestError(response.status, typeof (value as { code?: unknown }).code === 'string' ? (value as { code: string }).code : 'REQUEST_FAILED');
    return schema.parse(value);
  } catch (error) {
    if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof CollaborationRequestError) throw error;
    throw new CollaborationRequestError(0, timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED');
  } finally { clearTimeout(timer); context.signal?.removeEventListener('abort', abort); }
}
async function boundedText(response: Response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 1024 * 1024) { await reader.cancel(); throw new CollaborationRequestError(502, 'RESPONSE_TOO_LARGE'); } text += decoder.decode(part.value, { stream: true }); } return text + decoder.decode(); }
  finally { reader.releaseLock(); }
}
const query = (input: Record<string, unknown>) => new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)])).toString();
export const collaborationClient = {
  thread: (artifactId: string, input: Record<string, unknown>, context: CollaborationClientContext) => request(`/api/comments/${artifactId}?${query(input)}`, CollaborationThreadSchema, context),
  comment: (body: unknown, key: string, context: CollaborationClientContext) => request('/api/comments', ArtifactVersionCommentSchema, context, body, key),
  resolve: (commentId: string, body: unknown, key: string, context: CollaborationClientContext) => request(`/api/comments/${commentId}/resolve`, ArtifactVersionCommentSchema, context, body, key),
  decide: (body: unknown, key: string, context: CollaborationClientContext) => request('/api/collaboration/decisions', ArtifactVersionDecisionSchema, context, body, key),
  projectAccess: (workspaceId: string, projectId: string, context: CollaborationClientContext) => request(`/api/collaboration/projects/${projectId}/access?${query({ workspaceId })}`, ProjectAccessListSchema, context),
  setProjectAccess: (projectId: string, body: unknown, key: string, context: CollaborationClientContext) => request(`/api/collaboration/projects/${projectId}/access`, ProjectGrantResultSchema, context, body, key),
};
