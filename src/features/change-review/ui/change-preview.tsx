'use client';
import type { ChangeSet, DependencyChange } from '@/contracts/dependencies';
import type { Locale } from '@/i18n/locales';
import { selectableGroups } from '@/features/dependencies/domain/proposal';
import { changeReviewCopy } from '../locales';
import styles from './changes.module.css';

export function previewValue(value: unknown): string {
  if (value === null || value === undefined) return '…';
  if (typeof value !== 'object') return String(value);
  const field = value as { v?: unknown; type?: string; attrs?: { value?: unknown }; text?: string };
  if (Object.hasOwn(field, 'v')) return String(field.v ?? '');
  if (field.type === 'dataField') return String(field.attrs?.value ?? '');
  if (field.type === 'text') return field.text ?? '';
  return '';
}
export function ChangePreview({ changeset, locale, selected, onSelect, disabled = false }: { changeset: ChangeSet; locale: Locale; selected: string[]; onSelect: (groups: string[]) => void; disabled?: boolean }) {
  const t = changeReviewCopy[locale], allowed = new Set(selectableGroups(changeset.proposal)), settled = new Set([...changeset.acceptedGroupIds, ...changeset.rejectedGroupIds]);
  const groups = new Map<string, DependencyChange[]>();
  for (const change of changeset.proposal.changes) if (change.state !== 'unchanged') groups.set(change.groupId, [...groups.get(change.groupId) ?? [], change]);
  if (!changeset.proposal.changes.length) return <div className={styles.empty}><h3>{t.noLinks}</h3><p>{t.noLinksHint}</p></div>;
  if (!groups.size) return <p className={styles.success}>{t.empty}</p>;
  return <div className={styles.groups}>{[...groups].map(([groupId, changes]) => <section className={styles.group} key={groupId}>
    <label className={styles.groupHeading}><input type="checkbox" checked={selected.includes(groupId)} disabled={disabled || settled.has(groupId) || !allowed.has(groupId)} onChange={(event) => onSelect(event.target.checked ? [...selected, groupId] : selected.filter((id) => id !== groupId))} /><span>{t.choose}</span><strong>{changes.map((change) => change.title).filter((title, index, list) => list.indexOf(title) === index).join(' + ')}</strong></label>
    <div className={styles.comparison} role="table" aria-label={changes.map((change) => change.label).join(', ')}>
      <div className={styles.compareHeader} role="row"><span role="columnheader" /><span role="columnheader">{t.before}</span><span role="columnheader">{t.after}</span></div>
      {changes.map((change) => <div className={styles.compareRow} role="row" key={change.edgeId}><div role="rowheader"><strong>{change.label}</strong><span className={styles.state}>{settled.has(groupId) ? changeset.acceptedGroupIds.includes(groupId) ? t.applied : t.kept : t.states[change.state]}</span></div><span role="cell">{previewValue(change.before)}</span><span role="cell" className={change.state === 'ready' ? styles.changed : undefined}>{change.after === undefined ? t.states[change.state] : previewValue(change.after)}</span></div>)}
    </div>
  </section>)}</div>;
}
