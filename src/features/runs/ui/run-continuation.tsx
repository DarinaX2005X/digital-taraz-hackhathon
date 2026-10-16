'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Send, Play } from 'lucide-react';
import type { Run, ResumeRun } from '../../../contracts/runs';
import type { Locale } from '../../../i18n/locales';
import { Button, TextareaField } from '../../../ui';
import styles from './runs.module.css';

const copy = {
  ru: { plan: 'План работы', questions: 'Нужно уточнить', send: 'Ответить и продолжить', followup: 'Что изменить или дополнить в этом материале?', followupHint: 'Например: сократи введение, добавь условия оплаты и сохрани остальную структуру.', apply: 'Отправить ассистенту', parent: 'Предыдущая часть задачи', child: 'Открыть продолжение', changed: 'Текущая версия сначала сохранится. Ответ появится как продолжение этой работы.' },
  kk: { plan: 'Жұмыс жоспары', questions: 'Нақтылау қажет', send: 'Жауап беріп, жалғастыру', followup: 'Осы материалда нені өзгерту немесе толықтыру керек?', followupHint: 'Мысалы: кіріспені қысқартып, төлем шарттарын қосыңыз, қалған құрылымды сақтаңыз.', apply: 'Ассистентке жіберу', parent: 'Тапсырманың алдыңғы бөлігі', child: 'Жалғасын ашу', changed: 'Ағымдағы нұсқа алдымен сақталады. Жауап осы жұмыстың жалғасы ретінде ашылады.' },
  en: { plan: 'Work plan', questions: 'A few details are needed', send: 'Answer and continue', followup: 'What should change or be added to this material?', followupHint: 'For example: shorten the introduction, add payment terms, and keep the rest of the structure.', apply: 'Send to the assistant', parent: 'Previous part of this task', child: 'Open continuation', changed: 'The current version will be saved first. The response will open as a continuation of this work.' },
};

export type RunChange = Pick<ResumeRun, 'answers' | 'goal' | 'plan' | 'selectedOptionId' | 'acceptedConditionIds'>;
export const runAnswerDraftKey = (ownerId: string, runId: string) => `tirlik.run-answer-draft.v1:${ownerId}:${runId}`;
export const runFollowupDraftKey = (ownerId: string, runId: string, artifactId?: string) => `tirlik.run-followup-draft.v1:${ownerId}:${runId}:${artifactId ?? 'none'}`;
const legacyDraftKey = (ownerId: string, runId: string) => `tirlik.run-session-draft.v1:${ownerId}:${runId}`;

export function RunContinuation({ run, locale, pending, onContinue, draftOwnerId, runHref, structuredDecision = false }: { run: Run; locale: Locale; pending: boolean; onContinue: (change: RunChange) => void; draftOwnerId?: string; runHref?: (runId: string) => string; structuredDecision?: boolean }) {
  const text = copy[locale], [answers, setAnswers] = useState<Record<string, string>>({});
  const draftKey = draftOwnerId ? runAnswerDraftKey(draftOwnerId, run.id) : undefined;
  const visibleQuestions = run.progress.questions.filter((question) => !structuredDecision || !run.progress.decision || question.id !== 'select_option' && !question.id.startsWith('accept_conditions_'));
  const restored = useRef(false);
  useEffect(() => {
    if (!draftKey || !draftOwnerId) { restored.current = true; return; }
    const timer = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(draftKey) ?? sessionStorage.getItem(legacyDraftKey(draftOwnerId, run.id));
        const value: unknown = JSON.parse(raw ?? 'null');
        if (value && typeof value === 'object') {
          const draft = value as Record<string, unknown>;
          if (draft.answers && typeof draft.answers === 'object' && Object.values(draft.answers).every((answer) => typeof answer === 'string' && answer.length <= 4000)) setAnswers(draft.answers as Record<string, string>);
        }
      } catch { /* The authoritative run remains available without a tab draft. */ }
      restored.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [draftKey, draftOwnerId, run.id]);
  useEffect(() => {
    if (!draftKey || !restored.current) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ answers })); } catch { /* Keep the draft in component state. */ }
  }, [draftKey, answers]);
  const submitAnswers = (event: FormEvent) => { event.preventDefault(); onContinue({ answers: visibleQuestions.flatMap((question) => answers[question.id]?.trim() ? [{ questionId: question.id, answer: answers[question.id]!.trim() }] : []) }); };
  return <div className={styles.continuation}>
    {run.progress.parentRunId && <Link className={styles.textLink} href={runHref?.(run.progress.parentRunId) ?? `/app/runs/${run.progress.parentRunId}`}>{text.parent}</Link>}
    {run.progress.continuationRunId && <Link className={styles.textLink} href={runHref?.(run.progress.continuationRunId) ?? `/app/runs/${run.progress.continuationRunId}`}>{text.child}<ArrowRight size={16} aria-hidden="true" /></Link>}
    {run.progress.summary && <p className={styles.resultSummary}>{run.progress.summary}</p>}
    {!!run.progress.plan.length && <section aria-label={text.plan}><h3>{text.plan}</h3><ol className={styles.workPlan}>{run.progress.plan.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol></section>}
    {!!visibleQuestions.length && run.actions.resume && <form onSubmit={submitAnswers} className={styles.questionForm}>
      <h3>{text.questions}</h3>
      {visibleQuestions.map((question) => <TextareaField key={question.id} label={question.text} required={question.required} maxLength={4000} rows={3} disabled={pending} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />)}
      <div><Button type="submit" variant="primary" icon={Play} pending={pending}>{text.send}</Button></div>
    </form>}
  </div>;
}

export function RunFollowupComposer({ run, locale, pending, draftOwnerId, artifactId, error, onContinue }: { run: Run; locale: Locale; pending: boolean; draftOwnerId: string; artifactId?: string; error?: string; onContinue: (change: RunChange) => void }) {
  const text = copy[locale], [goal, setGoal] = useState('');
  const draftKey = runFollowupDraftKey(draftOwnerId, run.id, artifactId);
  const restored = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const own = sessionStorage.getItem(draftKey);
        const legacy = own === null ? sessionStorage.getItem(legacyDraftKey(draftOwnerId, run.id)) : null;
        const value: unknown = JSON.parse(own ?? legacy ?? 'null');
        if (value && typeof value === 'object') {
          const draft = value as Record<string, unknown>;
          if (typeof draft.goal === 'string' && draft.goal.length <= 12000 && (own !== null || draft.editing === true)) setGoal(draft.goal === run.goal ? '' : draft.goal);
        }
      } catch { /* Keep an empty in-memory composer. */ }
      restored.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [draftKey, draftOwnerId, run.id, run.goal]);
  useEffect(() => {
    if (!restored.current) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ goal })); } catch { /* Keep the draft in component state. */ }
  }, [draftKey, goal]);
  const submit = (event: FormEvent) => { event.preventDefault(); const value = goal.trim(); if (value) onContinue({ goal: value }); };
  return <form className={styles.followupComposer} onSubmit={submit}>
    <TextareaField label={text.followup} hint={text.followupHint} required maxLength={12000} rows={3} disabled={pending} value={goal} onChange={(event) => setGoal(event.target.value)} />
    <div className={styles.followupMeta}><small>{text.changed}</small><Button type="submit" variant="primary" icon={Send} pending={pending} disabled={!goal.trim()}>{text.apply}</Button></div>
    {error && <p className={styles.followupError} role="alert">{error}</p>}
  </form>;
}
