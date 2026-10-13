import { FatalError } from 'workflow';
import { ensureProbeFile, readProbeFile } from './blob';
import { HostingProbeInputSchema, PreflightError, sha256 } from './contracts';
import { associateRun, readProbe, recordAfter, recordBefore } from './store';

export async function saveBeforeMarker(probeId: string, runId: string): Promise<void> {
  'use step';
  try {
    HostingProbeInputSchema.parse({ probeId });
    if (!(await readProbe(probeId))) throw new FatalError('PREFLIGHT_PROBE_NOT_FOUND');
    await associateRun(probeId, runId);
    const blob = await ensureProbeFile(probeId);
    await recordBefore(probeId, runId, blob.pathname, blob.hash);
  } catch (error) {
    if (error instanceof FatalError) throw error;
    if (error instanceof PreflightError && error.code === 'CONFLICT') throw new FatalError('PREFLIGHT_CONTENT_CONFLICT');
    throw new Error('PREFLIGHT_BEFORE_UNAVAILABLE');
  }
}
saveBeforeMarker.maxRetries = 1;

export async function saveAfterMarker(probeId: string, resumeDeploymentId: string): Promise<{ probeId: string; sha256: string }> {
  'use step';
  try {
    HostingProbeInputSchema.parse({ probeId });
    const row = await readProbe(probeId);
    if (!row || row.before_count !== 1 || row.resume_deployment_id !== resumeDeploymentId) {
      throw new FatalError('PREFLIGHT_RESUME_CONFLICT');
    }
    const hash = sha256(await readProbeFile(probeId));
    await recordAfter(probeId, resumeDeploymentId, hash);
    return { probeId, sha256: hash };
  } catch (error) {
    if (error instanceof FatalError) throw error;
    if (error instanceof PreflightError && error.code === 'CONFLICT') throw new FatalError('PREFLIGHT_CONTENT_CONFLICT');
    throw new Error('PREFLIGHT_AFTER_UNAVAILABLE');
  }
}
saveAfterMarker.maxRetries = 1;
