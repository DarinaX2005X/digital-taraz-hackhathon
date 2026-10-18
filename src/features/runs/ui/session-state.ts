import type { Run, RunResultRef } from '@/contracts/runs';

export type SessionResultHrefResolver = (run: Pick<Run, 'id' | 'workspaceId' | 'projectId'>, result: RunResultRef) => string | null;

export interface SessionConversationTurn {
  key: string;
  role: 'user' | 'assistant';
  kind: 'goal' | 'question' | 'answer';
  content: string;
}

/** Builds only user-visible turns that the server has accepted and projected. */
export function sessionConversationTurns(run: Pick<Run, 'id' | 'goal' | 'progress'>): SessionConversationTurn[] {
  return [
    { key: `${run.id}:goal`, role: 'user', kind: 'goal', content: run.goal },
    ...(run.progress.answeredQuestions ?? []).flatMap((item, index): SessionConversationTurn[] => {
      const question = item.question?.trim();
      return [
        ...(question ? [{ key: `${run.id}:${item.questionId}:${index}:question`, role: 'assistant' as const, kind: 'question' as const, content: question }] : []),
        { key: `${run.id}:${item.questionId}:${index}:answer`, role: 'user', kind: 'answer', content: item.answer },
      ];
    }),
  ];
}

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

export type FollowupComposerState = 'hidden' | 'disabled' | 'enabled';

/** The runtime owns whether a continuation is safe; UI state must not second-guess a valid revise action. */
export function followupComposerState(run: Run | null | undefined): FollowupComposerState {
  if (!run || run.capabilityId !== 'business.goal' || run.failure === 'access_changed' || run.state === 'cancelled') return 'hidden';
  return run.actions.revise ? 'enabled' : 'disabled';
}

export function showGenericResume(run: Run): boolean {
  return run.actions.resume
    && !run.failure
    && run.progress.questions.length === 0
    && run.progress.decision?.selectedOptionId !== null
    && run.progress.workDecision?.selectedOptionId !== null;
}

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
  // The runtime can park a failed step in waiting_input so that a bounded
  // retry remains possible. That is not a question for the user.
  if (run.state === 'waiting_input') {
    if (run.failure) return hasResult ? 'partial' : 'failed';
    const hasVisibleInput = run.progress.questions.length > 0
      || run.progress.decision?.selectedOptionId === null
      || run.progress.workDecision?.selectedOptionId === null
      || run.actions.resume;
    return hasVisibleInput ? 'waiting_input' : hasResult ? 'partial' : 'failed';
  }
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
