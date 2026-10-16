'use client';

import Link from 'next/link';
import { ArrowUpRight, Check, Layers3 } from 'lucide-react';

import type { RunWorkDecision } from '@/contracts/runs';
import type { Locale } from '@/i18n';
import { Button } from '@/ui';

import styles from './work-decision-panel.module.css';

type ResultLink = { href: string; title?: string };

const copy = {
  ru: {
    eyebrow: 'Выбор направления',
    title: 'Какой вариант развивать дальше?',
    hint: 'Оба варианта остаются редактируемыми. Выбор фиксирует направление для следующего шага и не выпускает файлы автоматически.',
    selected: 'Выбрано',
    choose: 'Выбрать направление',
    open: 'Открыть макет',
    unavailable: 'Макет пока недоступен',
  },
  kk: {
    eyebrow: 'Бағытты таңдау',
    title: 'Қай нұсқаны әрі қарай дамытамыз?',
    hint: 'Екі нұсқа да өңделеді. Таңдау келесі қадамның бағытын бекітеді және файлдарды автоматты түрде шығармайды.',
    selected: 'Таңдалды',
    choose: 'Бағытты таңдау',
    open: 'Макетті ашу',
    unavailable: 'Макет әзірге қолжетімсіз',
  },
  en: {
    eyebrow: 'Direction choice',
    title: 'Which direction should move forward?',
    hint: 'Both directions stay editable. Choosing one sets the next step and does not release files automatically.',
    selected: 'Selected',
    choose: 'Choose direction',
    open: 'Open design',
    unavailable: 'Design is not available yet',
  },
} satisfies Record<Locale, Record<string, string>>;

export function WorkDecisionPanel({ decision, locale, resultHrefs, canChoose, pending, onChoose }: {
  decision: RunWorkDecision;
  locale: Locale;
  resultHrefs: Readonly<Record<string, ResultLink | undefined>>;
  canChoose: boolean;
  pending: boolean;
  onChoose: (optionId: string) => void;
}) {
  const text = copy[locale];
  return <section className={styles.panel} aria-labelledby={`work-decision-${decision.id}`}>
    <header className={styles.heading}>
      <span><Layers3 size={16} aria-hidden="true" />{text.eyebrow}</span>
      <h3 id={`work-decision-${decision.id}`}>{text.title}</h3>
      <p>{text.hint}</p>
    </header>
    <div className={styles.options}>
      {decision.options.map((option, index) => {
        const selected = decision.selectedOptionId === option.id;
        const links = option.artifactIds.map((artifactId) => resultHrefs[artifactId]).filter((item): item is ResultLink => Boolean(item));
        return <article className={styles.option} data-selected={selected || undefined} key={option.id}>
          <div className={styles.optionHeading}>
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <h4>{option.label}</h4>
            {selected && <strong><Check size={15} aria-hidden="true" />{text.selected}</strong>}
          </div>
          <div className={styles.resultLinks}>
            {links.length ? links.map((result) => <Link href={result.href} key={result.href}>{result.title ?? text.open}<ArrowUpRight size={14} aria-hidden="true" /></Link>) : <small>{text.unavailable}</small>}
          </div>
          {!selected && canChoose && <Button variant="primary" pending={pending} disabled={pending} onClick={() => onChoose(option.id)}>{text.choose}</Button>}
        </article>;
      })}
    </div>
  </section>;
}
