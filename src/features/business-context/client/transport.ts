import { BusinessContextDetailSchema, BusinessContextListSchema, UsedBusinessContextSchema } from '../contracts';

export class BusinessContextRequestError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
export interface BusinessContextClientContext { userId: string; signal?: AbortSignal }
async function request<T>(path: string, schema: { parse(value: unknown): T }, context: BusinessContextClientContext, body?: unknown, key?: string) {
  const controller = new AbortController(), abort = () => controller.abort(); let timedOut = false;
  context.signal?.addEventListener('abort', abort, { once: true }); if (context.signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json', 'X-Tirlik-User-Id': context.userId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (Number(response.headers.get('content-length')) > 1024 * 1024) { void response.body?.cancel(); throw new BusinessContextRequestError(502, 'RESPONSE_TOO_LARGE'); }
    const text = await boundedText(response); const value: unknown = text ? JSON.parse(text) : {};
    if (!response.ok) throw new BusinessContextRequestError(response.status, typeof (value as { code?: unknown }).code === 'string' ? (value as { code: string }).code : 'REQUEST_FAILED');
    return schema.parse(value);
  } catch (error) {
    if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof BusinessContextRequestError) throw error;
    throw new BusinessContextRequestError(0, timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED');
  } finally { clearTimeout(timer); context.signal?.removeEventListener('abort', abort); }
}
async function boundedText(response: Response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 1024 * 1024) { await reader.cancel(); throw new BusinessContextRequestError(502, 'RESPONSE_TOO_LARGE'); } text += decoder.decode(part.value, { stream: true }); } return text + decoder.decode(); }
  finally { reader.releaseLock(); }
}
const query = (input: Record<string, unknown>) => new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
export const businessContextClient = {
  list: (input: Record<string, unknown>, context: BusinessContextClientContext) => request(`/api/business-context?${query(input)}`, BusinessContextListSchema, context),
  read: (id: string, input: Record<string, unknown>, context: BusinessContextClientContext) => request(`/api/business-context/${id}?${query(input)}`, BusinessContextDetailSchema, context),
  create: (body: unknown, key: string, context: BusinessContextClientContext) => request('/api/business-context', BusinessContextDetailSchema, context, body, key),
  update: (id: string, body: unknown, key: string, context: BusinessContextClientContext) => request(`/api/business-context/${id}/update`, BusinessContextDetailSchema, context, body, key),
  status: (id: string, body: unknown, key: string, context: BusinessContextClientContext) => request(`/api/business-context/${id}/status`, BusinessContextDetailSchema, context, body, key),
  use: (id: string, body: unknown, context: BusinessContextClientContext) => request(`/api/business-context/${id}/use`, UsedBusinessContextSchema, context, body),
};
