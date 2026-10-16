import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Locale } from '@/contracts/primitives';
import type { BusinessWorkPreview } from '@/contracts/work-preview';
import { InlineNotice, TableFrame } from '@/ui';
import styles from '@/features/finance/ui/work.module.css';

type ProcurementPreview = Extract<BusinessWorkPreview, { kind: 'procurement' }>;

const copy = {
  ru: { eyebrow: 'Закупка · полная известная стоимость', title: 'Что купить, у кого и к какому сроку', intro: 'Неполное предложение остаётся видимым, но не может победить. Заказ — черновик.', supplier: 'Поставщик', need: 'Потребность', packs: 'Упаковки', total: 'Полная стоимость', arrival: 'Прибытие', terms: 'Оплата', gaps: 'Не хватает данных', order: 'Черновик заказа', noSend: 'Ничего не отправлено поставщику.', unresolved: 'Есть позиции без пригодного предложения' },
  kk: { eyebrow: 'Сатып алу · толық белгілі құн', title: 'Нені, кімнен және қай мерзімге сатып алу', intro: 'Толық емес ұсыныс көрінеді, бірақ жеңе алмайды. Тапсырыс — жоба.', supplier: 'Жеткізуші', need: 'Қажеттілік', packs: 'Қаптама', total: 'Толық құн', arrival: 'Келуі', terms: 'Төлем', gaps: 'Дерек жетіспейді', order: 'Тапсырыс жобасы', noSend: 'Жеткізушіге ештеңе жіберілген жоқ.', unresolved: 'Жарамды ұсынысы жоқ позициялар бар' },
  en: { eyebrow: 'Procurement · complete known cost', title: 'What to buy, from whom, and by when', intro: 'An incomplete offer remains visible but cannot win. The order is a draft.', supplier: 'Supplier', need: 'Need', packs: 'Packs', total: 'Complete cost', arrival: 'Arrival', terms: 'Payment', gaps: 'Missing data', order: 'Draft order', noSend: 'Nothing was sent to a supplier.', unresolved: 'Some needs have no eligible offer' },
} as const;

export function ProcurementWorkspace({ preview, locale, editableHref }: { preview: ProcurementPreview; locale: Locale; editableHref: string }) {
  const t = copy[locale];
  return <section className={styles.workspace} aria-labelledby="procurement-work-title"><header className={styles.header}><div><p className={styles.eyebrow}>{t.eyebrow}</p><h1 id="procurement-work-title">{t.title}</h1><p>{t.intro}</p></div><div className={styles.workspaceLinks}><span className={styles.pill}>{preview.currency}</span><Link href={editableHref}>{t.order}<ArrowUpRight size={14} aria-hidden="true" /></Link></div></header>
    {preview.draftOrder.unresolvedCount > 0 && <InlineNotice tone="warning" title={t.unresolved}>{preview.draftOrder.unresolvedNeedIds.join(', ')}{preview.draftOrder.unresolvedCount > preview.draftOrder.unresolvedNeedIds.length ? ` · +${preview.draftOrder.unresolvedCount - preview.draftOrder.unresolvedNeedIds.length}` : ''}</InlineNotice>}
    <div className={styles.split}><section className={styles.panel}><div className={styles.panelHeader}><h2>{t.supplier}</h2><p>{preview.candidateCount} options</p></div><TableFrame label={t.title} className={styles.table}><table><caption className="tirlik-sr-only">{t.title}</caption><thead><tr><th>{t.supplier}</th><th>{t.need}</th><th>{t.packs}</th><th>{t.total}</th><th>{t.arrival}</th><th>{t.terms}</th><th>{t.gaps}</th></tr></thead><tbody>{preview.candidates.map((candidate) => <tr key={`${candidate.needId}-${candidate.offerId}`} className={styles.candidate} data-eligible={candidate.eligible} data-complete={candidate.complete}><td>{candidate.supplierName}</td><td>{candidate.netRequired} {candidate.unit}</td><td>{candidate.packs ?? '—'}</td><td>{candidate.knownTotalMinorUnits === null ? '—' : `${candidate.knownTotalMinorUnits} ${preview.currency} minor`}</td><td>{candidate.arrivesOn ?? '—'}</td><td>{candidate.paymentTerms ?? '—'}</td><td>{candidate.missing.join(', ') || '—'}</td></tr>)}</tbody></table></TableFrame></section>
      <aside className={styles.panel}><div className={styles.panelHeader}><h2>{t.order}</h2><p>{preview.draftOrder.destination ?? '—'}</p></div><div className={styles.order}>{preview.draftOrder.lines.map((line) => <div className={styles.orderLine} key={line.needId}><strong>{line.supplierName}</strong><span>{line.description}</span><p>{line.packs} × {line.deliveredQuantity.decimal} {line.deliveredQuantity.unit} · {line.knownTotal.minorUnits} {line.knownTotal.currency} minor</p><small>{line.arrivesOn} · {line.paymentTerms}</small></div>)}{preview.draftOrder.lineCount > preview.draftOrder.lines.length && <p className={styles.footerNote}>+{preview.draftOrder.lineCount - preview.draftOrder.lines.length}</p>}<p className={styles.footerNote}>{t.noSend}</p></div></aside></div>
  </section>;
}

