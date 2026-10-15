import type { ErrorCode } from '../../../contracts/errors';
import type { RunFailure } from '../../../contracts/runs';

const retryable = new Set<RunFailure>(['provider', 'unavailable', 'configuration']);
const limitFailures = new Set<RunFailure>(['run_budget', 'workspace_budget', 'deployment_budget', 'authorization_budget', 'request_limit', 'step_limit', 'branch_limit']);
export class RunError extends Error {
  readonly retryable: boolean;
  readonly code: ErrorCode;
  constructor(readonly failure: RunFailure, code?: ErrorCode) {
    super(`runs.errors.${failure.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())}`);
    this.retryable = retryable.has(failure);
    this.code = code ?? (limitFailures.has(failure) ? 'RATE_LIMITED' : failure === 'conflict' || failure === 'lease_lost' ? 'CONFLICT' : failure === 'access_changed' ? 'FORBIDDEN' : failure === 'invalid_result' ? 'PROVIDER_FAILED' : 'UNAVAILABLE');
  }
}
