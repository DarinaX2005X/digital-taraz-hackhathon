import { del, get, put } from '@vercel/blob';
import { PreflightError, probePath, probePayload, readBoundedBody, sha256 } from './contracts';

export async function readProbeFile(probeId: string): Promise<Buffer> {
  const result = await get(probePath(probeId), {
    access: 'private', useCache: false, abortSignal: AbortSignal.timeout(15000),
  });
  if (!result || result.statusCode !== 200) throw new PreflightError('NOT_FOUND');
  const bytes = await readBoundedBody(result.stream, 1024);
  if (sha256(bytes) !== sha256(probePayload(probeId))) throw new PreflightError('CONFLICT');
  return bytes;
}

export async function ensureProbeFile(probeId: string): Promise<{ pathname: string; hash: string }> {
  const pathname = probePath(probeId);
  const payload = probePayload(probeId);
  try {
    await put(pathname, payload, {
      access: 'private', addRandomSuffix: false, allowOverwrite: false,
      contentType: 'application/json', cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(15000),
    });
  } catch {
    // A lost write receipt may already have created this immutable, exact payload.
    await readProbeFile(probeId);
  }
  const bytes = await readProbeFile(probeId);
  return { pathname, hash: sha256(bytes) };
}

export async function deleteProbeFile(probeId: string): Promise<void> {
  await del(probePath(probeId), { abortSignal: AbortSignal.timeout(15000) });
}
