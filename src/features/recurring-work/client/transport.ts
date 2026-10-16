import { StartWorkOccurrenceResultSchema } from '../../../contracts/business-work';
import { OutcomeListSchema, OutcomeObservationSchema, WorkOccurrenceListSchema, WorkOccurrenceSchema, WorkRuleDetailSchema, WorkRuleListSchema } from '../contracts';

export class RecurringWorkRequestError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
export interface RecurringWorkClientContext { userId: string; signal?: AbortSignal }
async function request<T>(path: string, schema: { parse(value: unknown): T }, context: RecurringWorkClientContext, body?: unknown, key?: string) {
  const controller = new AbortController(), abort = () => controller.abort(); let timedOut = false;
  context.signal?.addEventListener('abort', abort, { once: true }); if (context.signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json', 'X-Tirlik-User-Id': context.userId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (Number(response.headers.get('content-length')) > 1024 * 1024) { void response.body?.cancel(); throw new RecurringWorkRequestError(502, 'RESPONSE_TOO_LARGE'); }
    const text = await boundedText(response); const value: unknown = text ? JSON.parse(text) : {};
    if (!response.ok) throw new RecurringWorkRequestError(response.status, typeof (value as { code?: unknown }).code === 'string' ? (value as { code: string }).code : 'REQUEST_FAILED');
    return schema.parse(value);
  } catch (error) {
    if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof RecurringWorkRequestError) throw error;
    throw new RecurringWorkRequestError(0, timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED');
  } finally { clearTimeout(timer); context.signal?.removeEventListener('abort', abort); }
}
async function boundedText(response: Response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 1024 * 1024) { await reader.cancel(); throw new RecurringWorkRequestError(502, 'RESPONSE_TOO_LARGE'); } text += decoder.decode(part.value, { stream: true }); } return text + decoder.decode(); }
  finally { reader.releaseLock(); }
}
const query = (input: Record<string, unknown>) => new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString();
export const recurringWorkClient = {
  listRules: (input: Record<string, unknown>, context: RecurringWorkClientContext) => request(`/api/work-rules?${query(input)}`, WorkRuleListSchema, context),
  readRule: (id: string, input: Record<string, unknown>, context: RecurringWorkClientContext) => request(`/api/work-rules/${id}?${query(input)}`, WorkRuleDetailSchema, context),
  createRule: (body: unknown, key: string, context: RecurringWorkClientContext) => request('/api/work-rules', WorkRuleDetailSchema, context, body, key),
  updateRule: (id: string, body: unknown, key: string, context: RecurringWorkClientContext) => request(`/api/work-rules/${id}/update`, WorkRuleDetailSchema, context, body, key),
  setRuleState: (id: string, body: unknown, key: string, context: RecurringWorkClientContext) => request(`/api/work-rules/${id}/state`, WorkRuleDetailSchema, context, body, key),
  occurrences: (id: string, input: Record<string, unknown>, context: RecurringWorkClientContext) => request(`/api/work-rules/${id}/occurrences?${query(input)}`, WorkOccurrenceListSchema, context),
  start: (id: string, body: unknown, key: string, context: RecurringWorkClientContext) => request(`/api/work-rules/${id}/occurrences`, StartWorkOccurrenceResultSchema, context, body, key),
  cancel: (occurrenceId: string, body: unknown, key: string, context: RecurringWorkClientContext) => request(`/api/work-rules/occurrences/${occurrenceId}/cancel`, WorkOccurrenceSchema, context, body, key),
  restart: (occurrenceId: string, body: unknown, key: string, context: RecurringWorkClientContext) => request(`/api/work-rules/occurrences/${occurrenceId}/restart`, StartWorkOccurrenceResultSchema, context, body, key),
  listOutcomes: (input: Record<string, unknown>, context: RecurringWorkClientContext) => request(`/api/outcomes?${query(input)}`, OutcomeListSchema, context),
  createOutcome: (body: unknown, key: string, context: RecurringWorkClientContext) => request('/api/outcomes', OutcomeObservationSchema, context, body, key),
};
