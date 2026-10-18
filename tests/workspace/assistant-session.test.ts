import { describe, expect, it } from 'vitest';
import type { Run, RunResultRef } from '@/contracts/runs';
import { assistantSessionCatalog, runCatalog } from '@/features/runs/locales';
import { assistantSessionState, followupComposerState, sessionArtifactResultHrefs, sessionConversationTurns, sessionFailureMessage, sessionResultHref, sessionResults, showGenericResume } from '@/features/runs/ui/session-state';

const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, '0')}`;
function run(state: Run['state'], refs: Run['progress']['results'] = []): Run {
  return {
    id: id('1'), workspaceId: id('2'), projectId: id('3'), createdBy: id('4'), capabilityId: 'business.assistant', capabilityVersion: 1,
    goal: 'Prepare an answer', locale: 'en', state, epoch: 0, cursor: 1, failure: state === 'failed' ? 'invalid_result' : state === 'cancelled' ? 'cancelled' : null,
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', startedAt: null, deadlineAt: null,
    budget: { limitUsd: '0.5', reservedUsd: '0', spentUsd: '0', requestCount: 0, requestLimit: 12 }, steps: [],
    progress: { plan: [], questions: [], answeredQuestions: [], summary: '', results: refs, decision: null, parentRunId: null, continuationRunId: null },
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

  it('describes a failure without claiming that an absent result was saved', () => {
    const value = run('waiting_input');
    value.failure = 'invalid_result';
    expect(sessionFailureMessage(value, runCatalog.en.failures, assistantSessionCatalog.en.failureWithoutResults)).toBe('The action failed. The messages and work context remain available.');
    value.progress.results = [{ kind: 'artifact', id: id('5'), revision: 1, title: 'Draft' }];
    expect(sessionFailureMessage(value, runCatalog.en.failures, assistantSessionCatalog.en.failureWithoutResults)).toBe('The result did not pass validation. Completed work is saved.');
  });

  it('keeps actionable failure guidance when no result was created', () => {
    const value = run('waiting_input');
    value.failure = 'model_expired';
    expect(sessionFailureMessage(value, runCatalog.en.failures, assistantSessionCatalog.en.failureWithoutResults)).toBe(runCatalog.en.failures.model_expired);
    value.failure = 'cancelled';
    expect(sessionFailureMessage(value, runCatalog.en.failures, assistantSessionCatalog.en.failureWithoutResults)).toBe(runCatalog.en.failures.cancelled);
  });

  it('does not present a parked runtime failure as a question for the user', () => {
    const value = run('waiting_input');
    value.failure = 'invalid_result';
    expect(assistantSessionState(value)).toBe('failed');
    value.progress.results = [{ kind: 'artifact', id: id('5'), revision: 1, title: 'Draft' }];
    expect(assistantSessionState(value)).toBe('partial');
  });

  it('requires a visible canonical input or continuation action before announcing a decision', () => {
    const value = run('waiting_input');
    expect(assistantSessionState(value)).toBe('failed');
    value.progress.questions = [{ id: 'delivery_date', text: 'When is delivery required?', required: true }];
    expect(assistantSessionState(value)).toBe('waiting_input');
    value.progress.questions = [];
    value.actions.resume = true;
    expect(assistantSessionState(value)).toBe('waiting_input');
    value.actions.resume = false;
    value.progress.results = [{ kind: 'artifact', id: id('5'), revision: 1, title: 'Draft' }];
    expect(assistantSessionState(value)).toBe('partial');
  });

  it('reconstructs accepted question answers in their canonical conversation order', () => {
    const value = run('running');
    value.progress.answeredQuestions = [
      { questionId: 'delivery_date', question: 'When is delivery required?', answer: '30 October' },
      { questionId: 'delivery_date', question: 'Which year?', answer: '2026' },
    ];
    expect(sessionConversationTurns(value).map(({ role, kind, content }) => ({ role, kind, content }))).toEqual([
      { role: 'user', kind: 'goal', content: 'Prepare an answer' },
      { role: 'assistant', kind: 'question', content: 'When is delivery required?' },
      { role: 'user', kind: 'answer', content: '30 October' },
      { role: 'assistant', kind: 'question', content: 'Which year?' },
      { role: 'user', kind: 'answer', content: '2026' },
    ]);
    expect(new Set(sessionConversationTurns(value).map((turn) => turn.key)).size).toBe(5);
  });

  it('keeps a legacy accepted answer without inventing a missing question turn', () => {
    const value = run('running');
    value.progress.answeredQuestions = [{ questionId: 'delivery_date', answer: '30 October' }];
    expect(sessionConversationTurns(value).map(({ role, kind, content }) => ({ role, kind, content }))).toEqual([
      { role: 'user', kind: 'goal', content: 'Prepare an answer' },
      { role: 'user', kind: 'answer', content: '30 October' },
    ]);
  });

  it('keeps the composer enabled for a server-authorized follow-up after a paused failure', () => {
    const value = run('waiting_input');
    value.capabilityId = 'business.goal';
    value.failure = 'run_deadline';
    value.actions.revise = true;
    expect(followupComposerState(value)).toBe('enabled');
    value.actions.revise = false;
    expect(followupComposerState(value)).toBe('disabled');
    value.state = 'cancelled';
    expect(followupComposerState(value)).toBe('hidden');
  });

  it('never offers a generic resume while a canonical work choice is unanswered', () => {
    const value = run('waiting_input');
    value.actions.resume = true;
    value.progress.workDecision = { id: 'direction', requiresConsent: true, selectedOptionId: null, options: [{ id: 'precise', label: 'Precise', artifactIds: [] }] };
    expect(showGenericResume(value)).toBe(false);
    value.progress.workDecision.selectedOptionId = 'precise';
    expect(showGenericResume(value)).toBe(true);
    value.progress.questions = [{ id: 'delivery_date', text: 'When is delivery required?', required: true }];
    expect(showGenericResume(value)).toBe(false);
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
