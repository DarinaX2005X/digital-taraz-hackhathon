'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Pencil, Play } from 'lucide-react';
import type { Run, ResumeRun } from '../../../contracts/runs';
import type { Locale } from '../../../i18n/locales';
import { Button, TextareaField } from '../../../ui';
import styles from './runs.module.css';

const copy = {
  ru: { plan: 'План работы', questions: 'Нужно уточнить', answer: 'Ваш ответ', send: 'Ответить и продолжить', revise: 'Изменить задачу', goal: 'Что должно получиться', editPlan: 'План: один шаг на строку', apply: 'Продолжить с изменениями', keep: 'Оставить как есть', parent: 'Предыдущая часть задачи', child: 'Открыть продолжение', changed: 'Готовые материалы сохранятся. Изменённая задача продолжится отдельно со ссылкой на эту работу.' },
  kk: { plan: 'Жұмыс жоспары', questions: 'Нақтылау қажет', answer: 'Жауабыңыз', send: 'Жауап беріп, жалғастыру', revise: 'Тапсырманы өзгерту', goal: 'Қандай нәтиже қажет', editPlan: 'Жоспар: әр жолда бір қадам', apply: 'Өзгерістермен жалғастыру', keep: 'Өзгеріссіз қалдыру', parent: 'Тапсырманың алдыңғы бөлігі', child: 'Жалғасын ашу', changed: 'Дайын материалдар сақталады. Өзгертілген тапсырма осы жұмысқа сілтемемен бөлек жалғасады.' },
  en: { plan: 'Work plan', questions: 'A few details are needed', answer: 'Your answer', send: 'Answer and continue', revise: 'Change the task', goal: 'What should be delivered', editPlan: 'Plan: one step per line', apply: 'Continue with changes', keep: 'Keep as is', parent: 'Previous part of this task', child: 'Open continuation', changed: 'Saved materials will remain. The changed task continues separately with a link to this work.' },
};
export type RunChange = Pick<ResumeRun, 'answers' | 'goal' | 'plan' | 'selectedOptionId' | 'acceptedConditionIds'>;
export function RunContinuation({ run, locale, pending, onContinue, draftOwnerId, runHref, structuredDecision = false }: { run: Run; locale: Locale; pending: boolean; onContinue: (change: RunChange) => void; draftOwnerId?: string; runHref?: (runId: string) => string; structuredDecision?: boolean }) {
  const text = copy[locale], [editing, setEditing] = useState(false), [goal, setGoal] = useState(run.goal), [plan, setPlan] = useState(run.progress.plan.join('\n')), [answers, setAnswers] = useState<Record<string, string>>({});
  const draftKey = draftOwnerId ? `tirlik.run-session-draft.v1:${draftOwnerId}:${run.id}` : undefined;
  const visibleQuestions = run.progress.questions.filter((question) => !structuredDecision || !run.progress.decision || question.id !== 'select_option' && !question.id.startsWith('accept_conditions_'));
  const restored = useRef(false);
  useEffect(() => {
    if (!draftKey) { restored.current = true; return; }
    const timer = setTimeout(() => {
      try {
        const value: unknown = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
        if (value && typeof value === 'object') {
          const draft = value as Record<string, unknown>;
          if (typeof draft.goal === 'string' && draft.goal.length <= 12000) setGoal(draft.goal);
          if (typeof draft.plan === 'string' && draft.plan.length <= 5000) setPlan(draft.plan);
          if (typeof draft.editing === 'boolean') setEditing(draft.editing);
          if (draft.answers && typeof draft.answers === 'object' && Object.values(draft.answers).every((answer) => typeof answer === 'string' && answer.length <= 4000)) setAnswers(draft.answers as Record<string, string>);
        }
      } catch { /* The authoritative run remains available without a tab draft. */ }
      restored.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey || !restored.current) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ goal, plan, answers, editing })); } catch { /* Keep the draft in component state. */ }
  }, [draftKey, goal, plan, answers, editing]);
  const submitAnswers = (event: FormEvent) => { event.preventDefault(); onContinue({ answers: visibleQuestions.flatMap((question) => answers[question.id]?.trim() ? [{ questionId: question.id, answer: answers[question.id]!.trim() }] : []) }); };
  const submitGoal = (event: FormEvent) => {
    event.preventDefault();
    const steps = plan.split('\n').map((step) => step.trim()).filter(Boolean);
    onContinue({ goal: goal.trim(), ...(steps.length ? { plan: steps } : {}) });
  };
  return <div className={styles.continuation}>
    {run.progress.parentRunId && <Link className={styles.textLink} href={runHref?.(run.progress.parentRunId) ?? `/app/runs/${run.progress.parentRunId}`}>{text.parent}</Link>}
    {run.progress.continuationRunId && <Link className={styles.textLink} href={runHref?.(run.progress.continuationRunId) ?? `/app/runs/${run.progress.continuationRunId}`}>{text.child}<ArrowRight size={16} aria-hidden="true" /></Link>}
    {run.progress.summary && <p className={styles.resultSummary}>{run.progress.summary}</p>}
    {!!run.progress.plan.length && !editing && <section aria-label={text.plan}><h3>{text.plan}</h3><ol className={styles.workPlan}>{run.progress.plan.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol></section>}
    {!!visibleQuestions.length && run.actions.resume && <form onSubmit={submitAnswers} className={styles.questionForm}>
      <h3>{text.questions}</h3>
      {visibleQuestions.map((question) => <TextareaField key={question.id} label={question.text} required={question.required} maxLength={4000} rows={3} disabled={pending} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />)}
      <div><Button type="submit" variant="primary" icon={Play} pending={pending}>{text.send}</Button></div>
    </form>}
    {run.actions.revise && (editing ? <form onSubmit={submitGoal} className={styles.questionForm}>
      <TextareaField label={text.goal} required maxLength={12000} rows={4} disabled={pending} value={goal} onChange={(event) => setGoal(event.target.value)} />
      <TextareaField label={text.editPlan} maxLength={5000} rows={5} disabled={pending} value={plan} onChange={(event) => setPlan(event.target.value)} />
      <p className={styles.muted}>{text.changed}</p>
      <div className={styles.actions}><Button type="submit" variant="primary" icon={ArrowRight} pending={pending}>{text.apply}</Button><Button disabled={pending} onClick={() => setEditing(false)}>{text.keep}</Button></div>
    </form> : <div><Button icon={Pencil} variant="quiet" disabled={pending} onClick={() => { setGoal(run.goal); setPlan(run.progress.plan.join('\n')); setEditing(true); }}>{text.revise}</Button></div>)}
  </div>;
}
