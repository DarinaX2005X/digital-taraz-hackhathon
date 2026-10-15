'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Pencil, Play } from 'lucide-react';
import type { Run, ResumeRun } from '../../../contracts/runs';
import type { Locale } from '../../../i18n/locales';
import { Button, TextareaField } from '../../../ui';
import styles from './runs.module.css';

const copy = {
  ru: { plan: 'План работы', questions: 'Нужно уточнить', answer: 'Ваш ответ', send: 'Ответить и продолжить', revise: 'Изменить задачу', goal: 'Что должно получиться', editPlan: 'План — один шаг на строку', apply: 'Продолжить с изменениями', keep: 'Оставить как есть', parent: 'Предыдущая часть задачи', child: 'Открыть продолжение', changed: 'Готовые материалы сохранятся. Изменённая задача продолжится отдельно со ссылкой на эту работу.' },
  kk: { plan: 'Жұмыс жоспары', questions: 'Нақтылау қажет', answer: 'Жауабыңыз', send: 'Жауап беріп, жалғастыру', revise: 'Тапсырманы өзгерту', goal: 'Қандай нәтиже қажет', editPlan: 'Жоспар — әр жолда бір қадам', apply: 'Өзгерістермен жалғастыру', keep: 'Өзгеріссіз қалдыру', parent: 'Тапсырманың алдыңғы бөлігі', child: 'Жалғасын ашу', changed: 'Дайын материалдар сақталады. Өзгертілген тапсырма осы жұмысқа сілтемемен бөлек жалғасады.' },
  en: { plan: 'Work plan', questions: 'A few details are needed', answer: 'Your answer', send: 'Answer and continue', revise: 'Change the task', goal: 'What should be delivered', editPlan: 'Plan — one step per line', apply: 'Continue with changes', keep: 'Keep as is', parent: 'Previous part of this task', child: 'Open continuation', changed: 'Saved materials will remain. The changed task continues separately with a link to this work.' },
};
export type RunChange = Pick<ResumeRun, 'answers' | 'goal' | 'plan'>;
export function RunContinuation({ run, locale, pending, onContinue }: { run: Run; locale: Locale; pending: boolean; onContinue: (change: RunChange) => void }) {
  const text = copy[locale], [editing, setEditing] = useState(false), [goal, setGoal] = useState(run.goal), [plan, setPlan] = useState(run.progress.plan.join('\n')), [answers, setAnswers] = useState<Record<string, string>>({});
  const submitAnswers = (event: FormEvent) => { event.preventDefault(); onContinue({ answers: run.progress.questions.flatMap((question) => answers[question.id]?.trim() ? [{ questionId: question.id, answer: answers[question.id]!.trim() }] : []) }); };
  const submitGoal = (event: FormEvent) => {
    event.preventDefault();
    const steps = plan.split('\n').map((step) => step.trim()).filter(Boolean);
    onContinue({ goal: goal.trim(), ...(steps.length ? { plan: steps } : {}) });
  };
  return <div className={styles.continuation}>
    {run.progress.parentRunId && <Link className={styles.textLink} href={`/app/runs/${run.progress.parentRunId}`}>{text.parent}</Link>}
    {run.progress.continuationRunId && <Link className={styles.textLink} href={`/app/runs/${run.progress.continuationRunId}`}>{text.child}<ArrowRight size={16} aria-hidden="true" /></Link>}
    {run.progress.summary && <p className={styles.resultSummary}>{run.progress.summary}</p>}
    {!!run.progress.plan.length && !editing && <section aria-label={text.plan}><h3>{text.plan}</h3><ol className={styles.workPlan}>{run.progress.plan.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol></section>}
    {!!run.progress.questions.length && run.actions.resume && <form onSubmit={submitAnswers} className={styles.questionForm}>
      <h3>{text.questions}</h3>
      {run.progress.questions.map((question) => <TextareaField key={question.id} label={question.text} required={question.required} maxLength={4000} rows={3} disabled={pending} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />)}
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
