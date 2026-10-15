import type { Run, RunResultRef } from '../../../contracts/runs';
import type { RunCopy } from '../locales';
import { RunClientError } from './transport';

export const activeRun = (run: Run) => run.state === 'queued' || run.state === 'running';
export const observableRun = (run: Pick<Run, 'state'> & { steps: readonly { retryable: boolean }[] }) => ['queued', 'running', 'waiting_input', 'review_ready'].includes(run.state) || (run.state === 'failed' && run.steps.some((step) => step.retryable));
export const lostAccess = (error: unknown) => error instanceof RunClientError && [401, 403, 404].includes(error.status);
export function runErrorText(error: unknown, text: RunCopy) {
  if (!(error instanceof RunClientError)) return text.errors.unavailable;
  if (error.messageKey === 'runs.errors.accountChanged') return text.errors.accountChanged;
  switch (error.code) {
    case 'UNAUTHENTICATED': return text.errors.unauthenticated;
    case 'FORBIDDEN': return text.errors.forbidden;
    case 'NOT_FOUND': return text.errors.notFound;
    case 'CONFLICT': return text.errors.conflict;
    case 'RATE_LIMITED': return text.errors.rateLimited;
    case 'NETWORK': return text.errors.network;
    case 'INVALID_RESPONSE': return text.errors.invalid;
    default: return text.errors.unavailable;
  }
}
export function resultLink(run: Run, result: RunResultRef): string | null {
  if (result.kind === 'artifact' && run.projectId) return `/app/projects/${run.projectId}/artifacts/${result.id}/history?workspace=${run.workspaceId}`;
  if (result.kind === 'source') return `/app/materials/sources/${result.id}?workspaceId=${run.workspaceId}`;
  // Export owners supply their mounted destination when that capability registers.
  return null;
}
export function runResults(run: Run) {
  const seen = new Set<string>();
  return run.steps.flatMap((step) => step.resultRefs).filter((result) => {
    const key = `${result.kind}:${result.id}:${result.revision ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
