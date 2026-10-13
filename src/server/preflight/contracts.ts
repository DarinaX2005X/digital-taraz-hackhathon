import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ErrorCode } from '@/contracts/errors';

export const HostingProbeInputSchema = z.strictObject({ probeId: z.uuid() });
export const HostingProbeStatusSchema = z.strictObject({
  probeId: z.uuid(),
  runId: z.string().min(1).nullable(),
  state: z.enum(['starting', 'waiting', 'completed', 'failed']),
  hookReady: z.boolean(),
  beforeCount: z.number().int().min(0).max(1),
  afterCount: z.number().int().min(0).max(1),
  blobSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  fileAvailable: z.boolean(),
  deploymentId: z.string().min(1),
  runtimeRegion: z.string().min(1),
  startDeploymentId: z.string().min(1),
  resumeDeploymentId: z.string().min(1).nullable(),
  resumeSubmitted: z.boolean(),
  workflowStatus: z.string().min(1),
});
export type HostingProbeStatus = z.infer<typeof HostingProbeStatusSchema>;

export class PreflightError extends Error {
  constructor(readonly code: ErrorCode, readonly retryable = false) {
    super(code);
  }
}

export function probePath(probeId: string): string {
  HostingProbeInputSchema.parse({ probeId });
  return `preflight/hosting/${probeId}/payload.json`;
}

export function probePayload(probeId: string): Buffer {
  HostingProbeInputSchema.parse({ probeId });
  return Buffer.from(JSON.stringify({
    synthetic: true, probeId, quantity: 3, unitPriceMinor: 125000,
    totalMinor: 375000, currency: 'KZT',
  }), 'utf8');
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export async function readBoundedBody(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  timeoutMs = 5000,
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PreflightError('UNAVAILABLE')), timeoutMs);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximumBytes) throw new PreflightError('PAYLOAD_TOO_LARGE');
      chunks.push(part.value);
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
