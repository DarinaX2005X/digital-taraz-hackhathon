import { createHook, FatalError, getWorkflowMetadata } from 'workflow';
import { saveAfterMarker, saveBeforeMarker } from './steps';

export async function hostingProbeWorkflow(probeId: string) {
  'use workflow';
  const hook = createHook<{ resumeDeploymentId: string }>({ token: `tirlik:preflight:${probeId}` });
  try {
    const conflict = await hook.getConflict();
    if (conflict) throw new FatalError('PREFLIGHT_HOOK_CONFLICT');
    await saveBeforeMarker(probeId, getWorkflowMetadata().workflowRunId);
    const signal = await hook;
    return await saveAfterMarker(probeId, signal.resumeDeploymentId);
  } finally {
    hook.dispose();
  }
}
