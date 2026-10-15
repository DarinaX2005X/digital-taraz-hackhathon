import { ErrorEnvelopeSchema } from '../../../contracts/errors';
import { IdSchema } from '../../../contracts/primitives';
import { RunEventSchema, type RunEvent } from '../../../contracts/runs';
import { assertRunResponse, RunClientError, type RunRequestOptions } from './transport';

export async function consumeRunEvents(response: Response, runId: string, after: number, onEvent: (event: RunEvent) => void, signal?: AbortSignal) {
  await assertRunResponse(response);
  if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new RunClientError('INVALID_RESPONSE', 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', cursor = after, settled = false;
  try {
    while (!signal?.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (signal?.aborted) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 262_144) throw new RunClientError('INVALID_RESPONSE', 200);
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary || boundary.index === undefined) break;
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let eventName = '', id = '', data = '';
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('id:')) id = line.slice(3).trim();
          else if (line.startsWith('data:')) data += `${line.slice(5).trimStart()}\n`;
        }
        if (eventName === 'failure') {
          const envelope = ErrorEnvelopeSchema.safeParse(JSON.parse(data));
          if (!envelope.success) throw new RunClientError('INVALID_RESPONSE', 200);
          const status = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 }[envelope.data.code as 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'] ?? 503;
          throw new RunClientError(envelope.data.code, status, envelope.data.messageKey);
        }
        if (eventName === 'settled') { settled = true; continue; }
        if (eventName !== 'run') continue;
        const event = RunEventSchema.parse(JSON.parse(data));
        if (event.runId !== runId || id !== String(event.sequence)) throw new RunClientError('INVALID_RESPONSE', 200);
        if (event.sequence <= cursor) continue;
        if (event.sequence !== cursor + 1) throw new RunClientError('CONFLICT', 409);
        cursor = event.sequence;
        onEvent(event);
      }
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return { cursor, settled };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function openRunEvents(runId: string, after: number, onEvent: (event: RunEvent) => void, options: RunRequestOptions, fetcher: typeof fetch = fetch) {
  IdSchema.parse(runId); IdSchema.parse(options.userId);
  const timeout = AbortSignal.timeout(35_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await fetcher(`/api/runs/${runId}/events?after=${after}`, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
      headers: { Accept: 'text/event-stream', 'X-Tirlik-User-Id': options.userId },
    });
    return await consumeRunEvents(response, runId, after, onEvent, signal);
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof RunClientError) throw error;
    throw new RunClientError('NETWORK', 0);
  }
}
