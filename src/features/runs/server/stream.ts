import type { IdentityPrincipal } from '../../identity/server/access';
import { RUN_LIMITS } from '../domain/limits';
import type { RunEventsPage } from '../../../contracts/runs';
import { runError } from './http';
import type { RunService } from './service';

export function runEventStream(options: {
  request: Request; principal: IdentityPrincipal; service: Pick<RunService, 'events'>; first: RunEventsPage;
  durationMs?: number; pollMs?: number;
}) {
  const encoder = new TextEncoder();
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  options.request.signal.addEventListener('abort', abort, { once: true });
  if (options.request.signal.aborted) abort();
  const timer = setTimeout(abort, Math.min(options.durationMs ?? RUN_LIMITS.streamMs, RUN_LIMITS.streamMs));
  let ended = false;
  const cleanup = () => { clearTimeout(timer); options.request.signal.removeEventListener('abort', abort); lifetime.abort(); };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (value: string) => { if (!ended && !lifetime.signal.aborted) controller.enqueue(encoder.encode(value)); };
      let page = options.first;
      try {
        write('retry: 2000\n\n');
        while (!lifetime.signal.aborted) {
          for (const event of page.events) write(`id: ${event.sequence}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`);
          if (page.terminal && !page.hasMore) { write(`event: settled\ndata: ${JSON.stringify({ cursor: page.cursor })}\n\n`); break; }
          if (!page.hasMore) {
            write(': keep-alive\n\n');
            await new Promise<void>((resolve) => {
              const onAbort = () => { clearTimeout(wait); resolve(); };
              const wait = setTimeout(() => { lifetime.signal.removeEventListener('abort', onAbort); resolve(); }, options.pollMs ?? 1500);
              lifetime.signal.addEventListener('abort', onAbort, { once: true });
              if (lifetime.signal.aborted) onAbort();
            });
          }
          if (lifetime.signal.aborted) break;
          // Authz and the session are rechecked for every batch, including idle streams.
          page = await options.service.events(options.principal, page.runId, page.cursor);
        }
      } catch (error) {
        write(`event: failure\ndata: ${JSON.stringify(runError(error))}\n\n`);
      } finally {
        cleanup();
        if (!ended) { ended = true; controller.close(); }
      }
    },
    cancel() { ended = true; cleanup(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}
