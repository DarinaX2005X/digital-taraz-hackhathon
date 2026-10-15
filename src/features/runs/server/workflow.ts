import { executeRunStep } from './workflow-steps';
import type { Claim } from './service';

export async function executeRunWorkflow(claim: Claim) {
  'use workflow';
  // One final turn closes a run whose fortieth tool did not set a terminal state.
  for (let turn = 0; turn <= 40; turn++) {
    if (await executeRunStep(claim) === 'stopped') return;
  }
}
