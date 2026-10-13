import { getHookByToken, getRun, resumeHook, start } from 'workflow/api';
import { deleteProbeFile, readProbeFile } from './blob';
import { HostingProbeStatusSchema, PreflightError, type HostingProbeStatus } from './contracts';
import { admitProbe, associateRun, claimResume, markProbeCleaned, readProbe } from './store';
import { hostingProbeWorkflow } from './workflow';

export interface HostingOperations {
  start(probeId: string, deploymentId: string): Promise<{ runId: string }>;
  status(probeId: string, deploymentId: string): Promise<HostingProbeStatus>;
  resume(probeId: string, deploymentId: string): Promise<{ runId: string }>;
  file(probeId: string): Promise<Buffer>;
  remove(probeId: string): Promise<void>;
}

const hookToken = (probeId: string) => `tirlik:preflight:${probeId}`;

export const hostingOperations: HostingOperations = {
  async start(probeId, deploymentId) {
    const admitted = await admitProbe(probeId, deploymentId);
    if (!admitted.created) {
      if (!admitted.row.workflow_run_id) throw new PreflightError('UNAVAILABLE');
      return { runId: admitted.row.workflow_run_id };
    }
    // Keep the admission row after any unknown start outcome; never dispatch twice.
    const run = await start(hostingProbeWorkflow, [probeId], { region: 'fra1' });
    await associateRun(probeId, run.runId);
    return { runId: run.runId };
  },
  async status(probeId, deploymentId) {
    const row = await readProbe(probeId);
    if (!row) throw new PreflightError('NOT_FOUND');
    let workflowStatus = 'not-associated';
    let hookReady = false;
    if (row.workflow_run_id) {
      try {
        workflowStatus = await getRun(row.workflow_run_id).status;
      } catch {
        workflowStatus = 'unavailable-or-expired';
      }
      if (row.state === 'waiting' && !row.resume_deployment_id) {
        try {
          const hook = await getHookByToken(hookToken(probeId));
          hookReady = hook.runId === row.workflow_run_id;
        } catch {
          hookReady = false;
        }
      }
    }
    return HostingProbeStatusSchema.parse({
      probeId, runId: row.workflow_run_id, state: row.state, hookReady,
      beforeCount: row.before_count, afterCount: row.after_count, blobSha256: row.blob_sha256,
      fileAvailable: Boolean(row.blob_path),
      deploymentId, runtimeRegion: process.env.VERCEL_REGION || 'local', startDeploymentId: row.start_deployment_id,
      resumeDeploymentId: row.resume_deployment_id, resumeSubmitted: Boolean(row.resume_deployment_id),
      workflowStatus,
    });
  },
  async resume(probeId, deploymentId) {
    const row = await readProbe(probeId);
    if (!row) throw new PreflightError('NOT_FOUND');
    if (!row.workflow_run_id || row.before_count !== 1) throw new PreflightError('CONFLICT');
    if (row.resume_deployment_id || row.state === 'completed') return { runId: row.workflow_run_id };
    if (row.state !== 'waiting') throw new PreflightError('CONFLICT');
    const hook = await getHookByToken(hookToken(probeId));
    if (hook.runId !== row.workflow_run_id) throw new PreflightError('CONFLICT');
    if (await claimResume(probeId, deploymentId)) {
      // Claim survives a lost response. Status reconciliation, not a blind repeat, follows.
      await resumeHook(hookToken(probeId), { resumeDeploymentId: deploymentId });
    }
    return { runId: row.workflow_run_id };
  },
  async file(probeId) {
    const row = await readProbe(probeId);
    if (!row) throw new PreflightError('NOT_FOUND');
    if (row.before_count !== 1) throw new PreflightError('CONFLICT');
    if (!row.blob_path) throw new PreflightError('NOT_FOUND');
    return readProbeFile(probeId);
  },
  async remove(probeId) {
    const row = await readProbe(probeId);
    if (!row) return;
    if (!row.workflow_run_id) throw new PreflightError('CONFLICT');
    const status = await getRun(row.workflow_run_id).status;
    if (!['completed', 'failed', 'cancelled'].includes(status)) throw new PreflightError('CONFLICT');
    await deleteProbeFile(probeId);
    // Retain the tiny synthetic receipt, including admission time, after file cleanup.
    await markProbeCleaned(probeId, status !== 'completed');
  },
};
