import { FatalError } from 'workflow';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { getRunRuntime } from './runtime';
import type { Claim } from './service';

export async function executeRunStep(claim: Claim): Promise<'continue' | 'stopped'> {
  'use step';
  try {
    z.strictObject({ runId: IdSchema, epoch: z.number().int().positive(), leaseOwner: IdSchema }).parse(claim);
    return await getRunRuntime().service.executeStep(claim);
  } catch {
    // Database recovery owns retries and fencing; the SDK must not retry a charged step.
    throw new FatalError('RUN_STEP_UNAVAILABLE');
  }
}
executeRunStep.maxRetries = 0;
