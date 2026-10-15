'use client';

import Link from 'next/link';
import { Check, CircleHelp, ExternalLink } from 'lucide-react';
import type { RunDecision } from '@/contracts/runs';
import { formatCalendarDate, formatDecimal, formatInstant, formatList, formatNumber, type Locale } from '@/i18n';
import { Button } from '@/ui';
import { businessDecisionCopy, businessDecisionMessageKeys, decisionFactorMessageKey, type BusinessDecisionMessageKey } from '@/features/agent-tools/locales/decision';
import type { AssistantSessionCopy } from '../locales';
import styles from './runs.module.css';

const knownDecisionKeys = new Set<string>(businessDecisionMessageKeys);

function amount(locale: Locale, value: string | null, currency: string, unknown: string) {
  return value === null ? unknown : `${formatDecimal(locale, value)} ${currency}`;
}

function EvidenceLinks({ refs, workspaceId, copy }: { refs: RunDecision['options'][number]['sourceRefs']; workspaceId: string; copy: AssistantSessionCopy }) {
  const unique = [...new Map(refs.map((ref) => [ref.sourceId, ref])).values()];
  if (!unique.length) return null;
  return <small className={styles.evidenceLinks}>{copy.evidence}: {unique.map((ref, index) => <Link key={ref.sourceId} aria-label={`${copy.evidence} ${index + 1}`} href={`/app/materials/sources/${ref.sourceId}?workspaceId=${workspaceId}`}>{index + 1}<ExternalLink size={12} aria-hidden="true" /></Link>)}</small>;
}

function factorText(locale: Locale, factor: RunDecision['options'][number]['factors'][number]) {
  const key = (knownDecisionKeys.has(factor.messageKey) ? factor.messageKey : decisionFactorMessageKey(factor.kind, factor.code)) as BusinessDecisionMessageKey;
  return businessDecisionCopy[locale][key];
}

function CapacityEvidence({ evidence, locale, workspaceId, copy }: { evidence: RunDecision['options'][number]['capacity'][number]['evidence']; locale: Locale; workspaceId: string; copy: AssistantSessionCopy }) {
  if (evidence.origin === 'source') return <small className={styles.capacityEvidence}><span>{copy.sourceAvailability}</span><span>{copy.verifiedAvailability}: {formatInstant(locale, evidence.verifiedAt, { dateStyle: 'medium' })}</span><EvidenceLinks refs={evidence.sourceRefs} workspaceId={workspaceId} copy={copy} /></small>;
  if (evidence.origin === 'manual') return <small className={styles.capacityEvidence}><span>{copy.manualAvailability}</span>{evidence.verifiedAt ? <span>{copy.verifiedAvailability}: {formatInstant(locale, evidence.verifiedAt, { dateStyle: 'medium' })}</span> : <span>{copy.unknown}</span>}</small>;
  return <small className={styles.capacityEvidence}>{copy.missingAvailability}</small>;
}

export function DecisionPanel({ decision, locale, workspaceId, copy, canChoose, pending, pendingConditions = [], onChoose, onAcceptConditions }: {
  decision: RunDecision;
  locale: Locale;
  workspaceId: string;
  copy: AssistantSessionCopy;
  canChoose: boolean;
  pending: boolean;
  pendingConditions?: { id: string; text: string }[];
  onChoose: (optionId: string) => void;
  onAcceptConditions?: (conditionIds: string[]) => void;
}) {
  const dimensions = [...new Set(decision.differences.flatMap((difference) => difference.dimensions))];
  return <section className={styles.decision} aria-labelledby="assistant-decision-title">
    <div className={styles.decisionHeading}><div><h3 id="assistant-decision-title">{copy.decisionTitle}</h3><p>{copy.decisionHint}</p></div>{dimensions.length > 0 && <span>{formatList(locale, dimensions.map((dimension) => copy.dimensions[dimension]))}</span>}</div>
    <div className={styles.decisionTableWrap} tabIndex={0}>
      <table className={styles.decisionTable}>
        <thead><tr><th scope="col">{copy.outcome}</th>{decision.options.map((option) => <th scope="col" key={option.id}><strong>{option.title}</strong><span data-outcome={option.outcome}>{copy.outcomes[option.outcome]}</span>{decision.selectedOptionId === option.id ? <em><Check size={16} aria-hidden="true" />{copy.selectedOption}</em> : canChoose && option.outcome !== 'not_confirmed' ? <Button variant="primary" pending={pending} disabled={pending} onClick={() => onChoose(option.id)}>{copy.chooseOption}</Button> : null}<EvidenceLinks refs={option.sourceRefs} workspaceId={workspaceId} copy={copy} /></th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">{copy.quotedTotal}</th>{decision.options.map((option) => <td key={option.id}>{amount(locale, option.commercial.quotedTotal, option.commercial.currency, copy.unknown)}</td>)}</tr>
          <tr><th scope="row">{copy.directCost}</th>{decision.options.map((option) => <td key={option.id}>{amount(locale, option.commercial.directCost, option.commercial.currency, copy.unknown)}</td>)}</tr>
          <tr><th scope="row">{copy.contribution}</th>{decision.options.map((option) => <td key={option.id}>{amount(locale, option.commercial.contribution, option.commercial.currency, copy.unknown)}</td>)}</tr>
          <tr><th scope="row">{copy.contributionRate}</th>{decision.options.map((option) => <td key={option.id}>{option.commercial.contributionRate === null ? copy.unknown : `${formatDecimal(locale, option.commercial.contributionRate)}%`}</td>)}</tr>
          <tr><th scope="row">{copy.requestedDate}</th>{decision.options.map((option) => <td key={option.id}>{formatCalendarDate(locale, option.deadline.requestedDate)}</td>)}</tr>
          <tr><th scope="row">{copy.openingDate}</th>{decision.options.map((option) => <td key={option.id}>{option.deadline.openingDate ? formatCalendarDate(locale, option.deadline.openingDate) : copy.unknown}</td>)}</tr>
          <tr><th scope="row">{copy.earliestDate}</th>{decision.options.map((option) => <td key={option.id}>{option.deadline.earliestCompletionDate ? formatCalendarDate(locale, option.deadline.earliestCompletionDate) : copy.unknown}</td>)}</tr>
          <tr><th scope="row">{copy.capacity}</th>{decision.options.map((option) => <td key={option.id}>{option.capacity.length ? <ul className={styles.capacityList}>{option.capacity.map((item, index) => <li key={`${index}:${item.scope}`}><span>{item.scope}</span><strong>{item.requiredMinutes === null ? copy.unknown : formatNumber(locale, item.requiredMinutes)} / {item.availableMinutes === null ? copy.unknown : formatNumber(locale, item.availableMinutes)} {copy.minutes}</strong><CapacityEvidence evidence={item.evidence} locale={locale} workspaceId={workspaceId} copy={copy} /></li>)}</ul> : copy.unknown}</td>)}</tr>
          <tr><th scope="row">{copy.conditions}</th>{decision.options.map((option) => <td key={option.id}>{option.factors.length ? <ul className={styles.factorList}>{option.factors.map((factor, index) => <li key={`${factor.code}:${index}`}><CircleHelp size={16} aria-hidden="true" /><span>{factorText(locale, factor)}<EvidenceLinks refs={factor.sourceRefs} workspaceId={workspaceId} copy={copy} /></span></li>)}</ul> : <span>{copy.outcomes[option.outcome]}</span>}</td>)}</tr>
        </tbody>
      </table>
    </div>
    {pendingConditions.length > 0 && <div className={styles.decisionConsent}><ul>{pendingConditions.map((question) => <li key={question.id}>{question.text}</li>)}</ul><Button variant="primary" pending={pending} disabled={pending || !onAcceptConditions} onClick={() => onAcceptConditions?.(pendingConditions.map((question) => question.id))}>{copy.acceptConditions}</Button></div>}
  </section>;
}
