import type { Run, RunResultRef } from '@/contracts/runs';

export type SessionResultHrefResolver = (run: Pick<Run, 'id' | 'workspaceId' | 'projectId'>, result: RunResultRef) => string | null;

export type AssistantSessionState =
  | 'empty'
  | 'entered'
  | 'planning'
  | 'waiting_input'
  | 'partial'
  | 'review_ready'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'revoked';

export function sessionResults(run: Pick<Run, 'steps' | 'progress'>): RunResultRef[] {
  const seen = new Set<string>();
  return [...run.steps.flatMap((step) => step.resultRefs), ...(run.progress.branches ?? []).flatMap((branch) => branch.resultRefs), ...run.progress.results].filter((result) => {
    const key = `${result.kind}:${result.id}:${result.revision ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function assistantSessionState(run: Run | null | undefined, hasEnteredGoal = false): AssistantSessionState {
  if (!run) return hasEnteredGoal ? 'entered' : 'empty';
  const hasResult = sessionResults(run).length > 0;
  if (run.state === 'queued' || run.state === 'running') return hasResult ? 'partial' : 'planning';
  if (run.state === 'waiting_input') return 'waiting_input';
  if (run.state === 'review_ready') return hasResult ? 'review_ready' : 'partial';
  if (run.state === 'completed') return hasResult ? 'completed' : 'partial';
  if (run.state === 'failed') return hasResult ? 'partial' : 'failed';
  return hasResult ? 'partial' : 'interrupted';
}

export function sessionResultHref(run: Pick<Run, 'id' | 'workspaceId' | 'projectId'>, result: RunResultRef, resolve?: SessionResultHrefResolver): string | null {
  if (resolve) return resolve(run, result);
  if (result.kind === 'artifact' && run.projectId) {
    const query = new URLSearchParams({ run: run.id });
    return `/app/projects/${run.projectId}/artifacts/${result.id}?${query}`;
  }
  if (result.kind === 'source') return `/app/materials/sources/${result.id}?${new URLSearchParams({ workspaceId: run.workspaceId, from: 'project', run: run.id })}`;
  return null;
}

export function sessionArtifactResultHrefs(run: Pick<Run, 'id' | 'workspaceId' | 'projectId' | 'steps' | 'progress'>, artifactIds: readonly string[], resolve?: SessionResultHrefResolver) {
  const available = new Map(sessionResults(run).filter((result) => result.kind === 'artifact').map((result) => [result.id, result]));
  const titles = new Map(run.progress.results.filter((result) => result.kind === 'artifact').map((result) => [result.id, result.title]));
  return Object.fromEntries([...new Set(artifactIds)].flatMap((artifactId) => {
    const result = available.get(artifactId);
    const href = result && sessionResultHref(run, result, resolve);
    return href ? [[artifactId, { href, ...(titles.get(artifactId) ? { title: titles.get(artifactId) } : {}) }]] : [];
  }));
}
