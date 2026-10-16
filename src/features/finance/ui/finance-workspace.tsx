'use client';

import Link from 'next/link';
import { ArrowUpRight, Calculator } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import type { Locale } from '@/contracts/primitives';
import type { BusinessWorkPreview } from '@/contracts/work-preview';
import { Button, CheckboxField, InputField, SelectField, TableFrame } from '@/ui';
import type { FinanceRecalculateRequest } from '../contracts';
import styles from './work.module.css';

type FinancePreview = Extract<BusinessWorkPreview, { kind: 'finance' }>;
export type FinanceWorkspaceRecalculation = Pick<FinanceRecalculateRequest, 'branchTitle' | 'scenarios'>;

export interface FinanceWorkspaceProps {
  preview: FinancePreview;
  locale: Locale;
  editableHref: string;
  priorHref?: string;
  onRecalculate?: (input: FinanceWorkspaceRecalculation) => Promise<void>;
}

const copy = {
  ru: { eyebrow: 'Деньги · рабочая модель', title: 'Что произойдёт с деньгами', intro: 'Сценарии считают результат и движение денег отдельно. Измените допущение или название и сохраните пересчёт отдельной веткой.', result: 'Результат', income: 'Доходы', expense: 'Расходы', closing: 'Остаток', calendar: 'Календарь денег', date: 'Дата', inflow: 'Приход', outflow: 'Расход', balance: 'Остаток', unknown: 'Нужно уточнить', assumptions: 'Допущения', confirmed: 'Подтверждено', noRows: 'В этом периоде нет датированных движений.', scenarioName: 'Название варианта', assumptionName: 'Название допущения', amount: 'Сумма в минорных единицах', effectiveOn: 'Дата', direction: 'Направление', openModel: 'Открыть редактируемую модель', priorModel: 'Открыть исходный вариант', branchTitle: 'Название новой ветки', recalculate: 'Пересчитать и сохранить ветку', recalculating: 'Пересчитываем…', recalculated: 'Новая ветка сохранена. Исходная модель осталась без изменений.', failed: 'Не удалось сохранить пересчёт. Обновите модель и повторите.', partial: 'В панели показана часть допущений и календаря. Полная модель доступна по ссылке.' },
  kk: { eyebrow: 'Ақша · жұмыс моделі', title: 'Ақшаға не болады', intro: 'Сценарийлер нәтиже мен ақша қозғалысын бөлек есептейді. Болжамды немесе атауды өзгертіп, қайта есептеуді бөлек тармақ ретінде сақтаңыз.', result: 'Нәтиже', income: 'Кіріс', expense: 'Шығыс', closing: 'Қалдық', calendar: 'Ақша күнтізбесі', date: 'Күні', inflow: 'Кіріс', outflow: 'Шығыс', balance: 'Қалдық', unknown: 'Нақтылау керек', assumptions: 'Болжамдар', confirmed: 'Расталды', noRows: 'Бұл кезеңде күні көрсетілген ақша қозғалысы жоқ.', scenarioName: 'Нұсқа атауы', assumptionName: 'Болжам атауы', amount: 'Кіші бірліктегі сома', effectiveOn: 'Күні', direction: 'Бағыт', openModel: 'Өңделетін модельді ашу', priorModel: 'Бастапқы нұсқаны ашу', branchTitle: 'Жаңа тармақ атауы', recalculate: 'Қайта есептеп, тармақты сақтау', recalculating: 'Қайта есептелуде…', recalculated: 'Жаңа тармақ сақталды. Бастапқы модель өзгеріссіз қалды.', failed: 'Қайта есептеуді сақтау мүмкін болмады. Модельді жаңартып, қайталаңыз.', partial: 'Панельде болжамдар мен күнтізбенің бір бөлігі көрсетілген. Толық модель сілтемеде.' },
  en: { eyebrow: 'Money · working model', title: 'What happens to cash', intro: 'Scenarios keep financial result and cash movement separate. Change an assumption or scenario name, then save the recalculation as a separate branch.', result: 'Result', income: 'Income', expense: 'Expense', closing: 'Closing cash', calendar: 'Cash calendar', date: 'Date', inflow: 'Inflow', outflow: 'Outflow', balance: 'Balance', unknown: 'Needs input', assumptions: 'Assumptions', confirmed: 'Confirmed', noRows: 'There are no dated cash movements in this period.', scenarioName: 'Scenario name', assumptionName: 'Assumption name', amount: 'Amount in minor units', effectiveOn: 'Effective date', direction: 'Direction', openModel: 'Open editable model', priorModel: 'Open prior model', branchTitle: 'New branch name', recalculate: 'Recalculate and save branch', recalculating: 'Recalculating…', recalculated: 'The new branch is saved. The prior model remains unchanged.', failed: 'The recalculation could not be saved. Refresh the model and try again.', partial: 'This panel shows a bounded set of assumptions and calendar rows. Open the full model for everything.' },
} as const;

function formatMinor(locale: Locale, currency: string, raw: string | null) {
  if (raw === null) return copy[locale].unknown;
  const negative = raw.startsWith('-'), digits = negative ? raw.slice(1) : raw;
  const scale = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  if (digits.length > 15) return `${raw} ${currency} minor`;
  const padded = digits.padStart(scale + 1, '0'), major = padded.slice(0, -scale || undefined), fraction = scale ? padded.slice(-scale) : '';
  const numeric = `${negative ? '-' : ''}${major}${fraction ? `.${fraction}` : ''}`;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: scale, maximumFractionDigits: scale }).format(Number(numeric));
}

const assumptionKey = (scenarioId: string, assumptionId: string) => `${scenarioId}\0${assumptionId}`;

export function FinanceWorkspace(props: FinanceWorkspaceProps) {
  const key = `${props.preview.editable.artifactId}:${props.preview.editable.revision}`;
  return <FinanceWorkspaceModel key={key} {...props} />;
}

function FinanceWorkspaceModel({ preview, locale, editableHref, priorHref, onRecalculate }: FinanceWorkspaceProps) {
  const t = copy[locale];
  const [selectedId, setSelectedId] = useState(preview.scenarios[0]!.id);
  const [scenarioNames, setScenarioNames] = useState<Record<string, string>>(() => Object.fromEntries(preview.scenarios.map((scenario) => [scenario.id, scenario.title])));
  const [assumptionDrafts, setAssumptionDrafts] = useState<Record<string, { title: string; effectiveOn: string; direction: 'inflow' | 'outflow'; amountMinorUnits: string; confirmed: boolean }>>(() => Object.fromEntries(preview.assumptions.map((assumption) => [assumptionKey(assumption.scenarioId, assumption.id), { title: assumption.title, effectiveOn: assumption.effectiveOn, direction: assumption.direction, amountMinorUnits: assumption.amountMinorUnits ?? '', confirmed: assumption.confirmed }])));
  const [branchTitle, setBranchTitle] = useState(`${preview.scenarios[0]!.title} · recalculated`);
  const [pending, setPending] = useState(false), [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');

  const scenario = preview.scenarios.find((item) => item.id === selectedId) ?? preview.scenarios[0]!;
  const assumptions = useMemo(() => preview.assumptions.filter((item) => item.scenarioId === scenario.id), [preview.assumptions, scenario.id]);
  const calendar = useMemo(() => preview.calendar.filter((item) => item.scenarioId === scenario.id), [preview.calendar, scenario.id]);
  const partial = preview.assumptionCount > preview.assumptions.length || preview.calendarRowCount > preview.calendar.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!onRecalculate || pending || !branchTitle.trim()) return;
    const scenarios = preview.scenarios.flatMap((item) => {
      const edits = preview.assumptions.filter((assumption) => assumption.scenarioId === item.id).flatMap((assumption) => {
        const draft = assumptionDrafts[assumptionKey(item.id, assumption.id)];
        if (!draft) return [];
        const amountChanged = draft.amountMinorUnits !== (assumption.amountMinorUnits ?? '');
        if (draft.title === assumption.title && draft.effectiveOn === assumption.effectiveOn && draft.direction === assumption.direction && draft.confirmed === assumption.confirmed && !amountChanged) return [];
        return [{
          assumptionId: assumption.id,
          ...(draft.title === assumption.title ? {} : { title: draft.title }),
          ...(draft.effectiveOn === assumption.effectiveOn ? {} : { effectiveOn: draft.effectiveOn }),
          ...(draft.direction === assumption.direction ? {} : { direction: draft.direction }),
          ...(draft.confirmed === assumption.confirmed ? {} : { confirmed: draft.confirmed }),
          ...(amountChanged ? { amount: draft.amountMinorUnits ? { currency: preview.currency, minorUnits: draft.amountMinorUnits } : null } : {}),
        }];
      });
      const title = scenarioNames[item.id] ?? item.title;
      return title === item.title && edits.length === 0 ? [] : [{ scenarioId: item.id, ...(title === item.title ? {} : { title }), assumptions: edits }];
    });
    setPending(true); setStatus('idle');
    try { await onRecalculate({ branchTitle: branchTitle.trim(), scenarios }); setStatus('saved'); }
    catch { setStatus('failed'); }
    finally { setPending(false); }
  }

  return <section className={styles.workspace} aria-labelledby="finance-work-title">
    <header className={styles.header}><div><p className={styles.eyebrow}>{t.eyebrow}</p><h1 id="finance-work-title">{t.title}</h1><p>{t.intro}</p></div><div className={styles.workspaceLinks}><Link href={editableHref}>{t.openModel}<ArrowUpRight size={14} aria-hidden="true" /></Link>{priorHref && <Link href={priorHref}>{t.priorModel}<ArrowUpRight size={14} aria-hidden="true" /></Link>}</div></header>
    <div className={styles.scenarioTabs} aria-label={t.assumptions}>{preview.scenarios.map((item) => <button key={item.id} type="button" aria-pressed={item.id === scenario.id} onClick={() => setSelectedId(item.id)}>{scenarioNames[item.id] ?? item.title}</button>)}</div>
    <div className={styles.metrics}><div className={styles.metric}><span>{t.result}</span><strong className={scenario.knownResultMinorUnits.startsWith('-') ? styles.negative : ''}>{formatMinor(locale, preview.currency, scenario.knownResultMinorUnits)}</strong></div><div className={styles.metric}><span>{t.income}</span><strong>{formatMinor(locale, preview.currency, scenario.knownIncomeMinorUnits)}</strong></div><div className={styles.metric}><span>{t.expense}</span><strong>{formatMinor(locale, preview.currency, scenario.knownExpenseMinorUnits)}</strong></div><div className={styles.metric}><span>{t.closing}</span><strong className={scenario.closingBalanceMinorUnits === null ? styles.unknown : scenario.closingBalanceMinorUnits.startsWith('-') ? styles.negative : ''}>{formatMinor(locale, preview.currency, scenario.closingBalanceMinorUnits)}</strong></div></div>
    {scenario.unknownCount > 0 && <div className={styles.notice} role="status"><strong>{t.unknown}:</strong> {scenario.unknownCount}</div>}
    {partial && <p className={styles.partialNote}>{t.partial}</p>}
    <div className={styles.split}>
      <section className={styles.panel}><div className={styles.panelHeader}><h2>{t.calendar}</h2><p>{preview.period.start} — {preview.period.end}</p></div><TableFrame label={t.calendar} className={styles.table}><table><caption className="tirlik-sr-only">{t.calendar}</caption><thead><tr><th>{t.date}</th><th>{t.inflow}</th><th>{t.outflow}</th><th>{t.balance}</th><th>{t.unknown}</th></tr></thead><tbody>{calendar.length ? calendar.map((row) => <tr key={row.date}><td>{row.date}</td><td>{formatMinor(locale, preview.currency, row.knownInflowsMinorUnits)}</td><td>{formatMinor(locale, preview.currency, row.knownOutflowsMinorUnits)}</td><td className={row.closingBalanceMinorUnits?.startsWith('-') ? styles.negative : row.closingBalanceMinorUnits === null ? styles.unknown : ''}>{formatMinor(locale, preview.currency, row.closingBalanceMinorUnits)}</td><td>{row.unknownCount || '—'}</td></tr>) : <tr><td colSpan={5}>{t.noRows}</td></tr>}</tbody></table></TableFrame></section>
      <form className={`${styles.panel} ${styles.recalculation}`} onSubmit={submit}><div className={styles.panelHeader}><h2>{t.assumptions}</h2><p>{scenario.title}</p></div><div className={styles.editFields}><InputField label={t.scenarioName} value={scenarioNames[scenario.id] ?? scenario.title} maxLength={240} disabled={!onRecalculate || pending} onChange={(event) => setScenarioNames((current) => ({ ...current, [scenario.id]: event.target.value }))} />{assumptions.map((assumption) => { const key = assumptionKey(scenario.id, assumption.id), draft = assumptionDrafts[key]; if (!draft) return null; const update = (patch: Partial<typeof draft>) => setAssumptionDrafts((current) => ({ ...current, [key]: { ...draft, ...patch } })); return <fieldset key={assumption.id} className={styles.assumptionEditor} disabled={!onRecalculate || pending}><legend>{assumption.title}</legend><InputField label={t.assumptionName} value={draft.title} maxLength={160} onChange={(event) => update({ title: event.target.value })} /><div className={styles.editGrid}><InputField label={t.effectiveOn} type="date" value={draft.effectiveOn} onChange={(event) => update({ effectiveOn: event.target.value })} /><SelectField label={t.direction} value={draft.direction} onChange={(event) => update({ direction: event.target.value as 'inflow' | 'outflow' })}><option value="inflow">{t.inflow}</option><option value="outflow">{t.outflow}</option></SelectField></div><InputField label={t.amount} inputMode="numeric" pattern="(?:0|[1-9]\d*)" value={draft.amountMinorUnits} onChange={(event) => update({ amountMinorUnits: event.target.value })} /><CheckboxField label={t.confirmed} checked={draft.confirmed} onChange={(event) => update({ confirmed: event.target.checked })} /></fieldset>; })}<InputField label={t.branchTitle} value={branchTitle} required maxLength={240} disabled={!onRecalculate || pending} onChange={(event) => setBranchTitle(event.target.value)} />{status === 'saved' && <p className={styles.success} role="status">{t.recalculated}</p>}{status === 'failed' && <p className={styles.failure} role="alert">{t.failed}</p>}<Button type="submit" variant="primary" icon={Calculator} pending={pending} pendingLabel={t.recalculating} disabled={!onRecalculate || !branchTitle.trim()}>{t.recalculate}</Button></div></form>
    </div>
  </section>;
}
