import { describe, expect, it } from 'vitest';
import type { Run, RunResultRef } from '@/contracts/runs';
import { assistantSessionState, sessionArtifactResultHrefs, sessionResultHref, sessionResults } from '@/features/runs/ui/session-state';

const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, '0')}`;
function run(state: Run['state'], refs: Run['progress']['results'] = []): Run {
  return {
    id: id('1'), workspaceId: id('2'), projectId: id('3'), createdBy: id('4'), capabilityId: 'business.assistant', capabilityVersion: 1,
    goal: 'Prepare an answer', locale: 'en', state, epoch: 0, cursor: 1, failure: state === 'failed' ? 'invalid_result' : state === 'cancelled' ? 'cancelled' : null,
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', startedAt: null, deadlineAt: null,
    budget: { limitUsd: '0.5', reservedUsd: '0', spentUsd: '0', requestCount: 0, requestLimit: 12 }, steps: [],
    progress: { plan: [], questions: [], summary: '', results: refs, decision: null, parentRunId: null, continuationRunId: null },
    actions: { cancel: false, resume: false, revise: false, retryStepIds: [] },
  };
}

describe('assistant-first session state', () => {
  it('never calls a text-only completed run complete', () => {
    expect(assistantSessionState(run('completed'))).toBe('partial');
    expect(assistantSessionState(run('completed', [{ kind: 'artifact', id: id('5'), revision: 1, title: 'Estimate' }]))).toBe('completed');
  });

  it('keeps a usable result visible after failure or interruption', () => {
    const ref = { kind: 'artifact' as const, id: id('5'), revision: 2, title: 'Estimate' };
    expect(assistantSessionState(run('failed', [ref]))).toBe('partial');
    expect(assistantSessionState(run('cancelled', [ref]))).toBe('partial');
    expect(assistantSessionState(run('cancelled'))).toBe('interrupted');
  });

  it('deduplicates result receipts and keeps the session id in an artifact link', () => {
    const value = run('review_ready', [{ kind: 'artifact', id: id('5'), revision: 2, title: 'Estimate' }]);
    value.steps = [{ id: id('6'), runId: value.id, ordinal: 1, action: 'save', state: 'succeeded', toolName: 'artifact.save', toolVersion: 1, attempt: 1, failure: null, retryable: false, resultRefs: value.progress.results, startedAt: null, finishedAt: null }];
    expect(sessionResults(value)).toHaveLength(1);
    expect(sessionResultHref(value, value.progress.results[0]!)).toBe(`/app/projects/${value.projectId}/artifacts/${id('5')}?run=${value.id}`);
  });

  it('links a work decision only to artifacts actually committed by this project run', () => {
    const value = run('review_ready', [{ kind: 'artifact', id: id('5'), revision: 2, title: 'Campaign direction' }]);
    expect(sessionArtifactResultHrefs(value, [id('5'), id('7'), id('5')])).toEqual({
      [id('5')]: { href: `/app/projects/${value.projectId}/artifacts/${id('5')}?run=${value.id}`, title: 'Campaign direction' },
    });
  });

  it('uses an injected result boundary for every committed result and can suppress demo links', () => {
    const value = run('review_ready', [{ kind: 'artifact', id: id('5'), revision: 2, title: 'Campaign direction' }]);
    const scoped = (current: Pick<Run, 'id'>, result: RunResultRef) => `/scoped/${current.id}/${result.kind}/${result.id}`;
    expect(sessionResultHref(value, value.progress.results[0]!, scoped)).toBe(`/scoped/${value.id}/artifact/${id('5')}`);
    expect(sessionArtifactResultHrefs(value, [id('5')], () => null)).toEqual({});
  });
});
