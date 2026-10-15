import { z } from 'zod';
import { LocaleSchema } from '@/contracts/primitives';
import { ArtifactContentSchema } from '@/features/artifacts/domain/content-models';
import { assertBoundedJson } from '@/features/artifacts/domain/canonical';
import { validateArtifactContent } from '@/features/artifacts/domain/semantic-validation';
import { artifactErrorResponse } from '@/features/artifacts/server/http';
import { assertOrigin, IdentityError } from '@/features/identity/server/http';
import { ExportOptionsSchema } from '@/features/exports/contracts';
import { renderDocx } from '@/features/exports/server/documents/docx';

const InputSchema = z.strictObject({ locale: LocaleSchema, content: ArtifactContentSchema, title: z.string().trim().min(1).max(160) });
let active = 0, windowStart = 0, requests = 0;
/** A bounded public sample export. It never reads private assets or persists account objects. */
export async function exportDemoDocument(request: Request): Promise<Response> {
  let reserved = false;
  try {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new IdentityError('UNAVAILABLE', 'artifacts.errors.unavailable');
    assertOrigin(request, origin);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); requests = 0; }
    if (active >= 2 || requests >= 30) throw new IdentityError('RATE_LIMITED', 'artifacts.errors.unavailable');
    requests++; active++; reserved = true;
    const reader = request.body?.getReader(); if (!reader) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
    let bytes = 0, text = ''; const decoder = new TextDecoder();
    try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 256 * 1024) { await reader.cancel(); throw new IdentityError('PAYLOAD_TOO_LARGE', 'artifacts.errors.tooLarge'); } text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed'); }
    assertBoundedJson(raw, { bytes: 256 * 1024, depth: 30, values: 15000 });
    const body = InputSchema.parse(raw), content = validateArtifactContent(body.content);
    if (content.kind !== 'document') throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
    const artifactId = typeof content.document.attrs?.id === 'string' ? content.document.attrs.id : undefined;
    if (!artifactId) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
    const nodes = [content.document]; let count = 0;
    while (nodes.length) { const node = nodes.pop()!; if (++count > 300 || node.type === 'image') throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed'); nodes.push(...node.content ?? []); }
    const result = await renderDocx({ artifactId, content, title: body.title, format: 'docx', locale: body.locale, options: ExportOptionsSchema.parse({}), privateFieldsPolicy: 'exclude-internal', revision: 0, createdAt: new Date().toISOString(), historicalDraft: false, assets: { image: async () => { throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound'); } }, signal: request.signal });
    return new Response(new Uint8Array(result.bytes), { headers: { 'Content-Type': result.mediaType, 'Content-Disposition': 'attachment; filename="tirlik-workshop-offer.docx"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return artifactErrorResponse(error); }
  finally { if (reserved) active--; }
}
