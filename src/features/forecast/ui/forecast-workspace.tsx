import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Locale } from '@/contracts/primitives';
import type { BusinessWorkPreview } from '@/contracts/work-preview';
import { InlineNotice, TableFrame } from '@/ui';
import styles from '@/features/finance/ui/work.module.css';

type ForecastPreview = Extract<BusinessWorkPreview, { kind: 'forecast' }>;

const copy = {
  ru: { eyebrow: 'Прогноз · проверено на истории', title: 'Будущий диапазон и фактическая ошибка', insufficient: 'Истории недостаточно для честного прогноза', reason: 'Исходный ряд сохранён; добавьте историю или исправьте регулярность.', point: 'Прогноз', lower: 'Нижняя граница', upper: 'Верхняя граница', date: 'Дата', method: 'Метод', backtest: 'Историческая проверка', baseline: 'Базовая модель', coverage: 'Эмпирическое покрытие' },
  kk: { eyebrow: 'Болжам · тарихта тексерілген', title: 'Болашақ ауқымы және нақты қате', insufficient: 'Адал болжам үшін тарих жеткіліксіз', reason: 'Бастапқы қатар сақталды; тарихты толықтырыңыз немесе тұрақтылықты түзетіңіз.', point: 'Болжам', lower: 'Төменгі шек', upper: 'Жоғарғы шек', date: 'Күні', method: 'Әдіс', backtest: 'Тарихи тексеру', baseline: 'Базалық модель', coverage: 'Эмпирикалық қамту' },
  en: { eyebrow: 'Forecast · tested on history', title: 'Future range and measured error', insufficient: 'There is not enough history for an honest forecast', reason: 'The input series is saved; add history or repair regularity.', point: 'Forecast', lower: 'Lower', upper: 'Upper', date: 'Date', method: 'Method', backtest: 'Backtest', baseline: 'Baseline', coverage: 'Empirical coverage' },
} as const;

function chart(preview: ForecastPreview) {
  if (!preview.points.length) return null;
  const values = preview.points.flatMap((item) => [Number(item.lower), Number(item.upper)]), min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const xy = (value: string, index: number) => `${(index / Math.max(1, preview.points.length - 1)) * 100},${92 - ((Number(value) - min) / spread) * 84}`;
  const upper = preview.points.map((item, index) => xy(item.upper, index)), lower = [...preview.points].reverse().map((item, reverseIndex) => xy(item.lower, preview.points.length - 1 - reverseIndex));
  return <svg viewBox="0 0 100 100" role="img" aria-label="Forecast range chart" preserveAspectRatio="none"><line className={styles.axis} x1="0" x2="100" y1="92" y2="92" /><polygon className={styles.range} points={[...upper, ...lower].join(' ')} /><polyline className={styles.line} points={preview.points.map((item, index) => xy(item.value, index)).join(' ')} /></svg>;
}

export function ForecastWorkspace({ preview, locale, editableHref }: { preview: ForecastPreview; locale: Locale; editableHref: string }) {
  const t = copy[locale], eligible = preview.eligibility.state === 'eligible';
  return <section className={styles.workspace} aria-labelledby="forecast-work-title"><header className={styles.header}><div><p className={styles.eyebrow}>{t.eyebrow}</p><h1 id="forecast-work-title">{t.title}</h1><p>{preview.target} · {preview.aggregation} · {preview.coverage.start} — {preview.coverage.end}</p></div><div className={styles.workspaceLinks}>{eligible && <span className={styles.pill}>{preview.modelFamily}</span>}<Link href={editableHref}>{t.title}<ArrowUpRight size={14} aria-hidden="true" /></Link></div></header>
    {!eligible ? <InlineNotice tone="warning" title={t.insufficient}><p>{t.reason}</p><ul>{preview.eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></InlineNotice> : <>
      <div className={styles.metrics}><div className={styles.metric}><span>{t.method}</span><strong>{preview.modelFamily}</strong></div><div className={styles.metric}><span>MAE</span><strong>{preview.backtestMetrics!.mae}</strong></div><div className={styles.metric}><span>{t.baseline}</span><strong>{preview.baseline.family}</strong></div><div className={styles.metric}><span>{t.coverage}</span><strong>{preview.interval.empiricalCoverage === null ? '—' : `${Math.round(preview.interval.empiricalCoverage * 100)}%`}</strong></div></div>
      <section className={styles.panel}><div className={styles.panelHeader}><h2>{t.title}</h2><p>{preview.interval.method} · {Math.round(preview.interval.level * 100)}% · {preview.pointCount} points</p></div><div className={styles.forecastChart}>{chart(preview)}</div><TableFrame label={t.title} className={styles.table}><table><caption className="tirlik-sr-only">{t.title}</caption><thead><tr><th>{t.date}</th><th>{t.point}</th><th>{t.lower}</th><th>{t.upper}</th></tr></thead><tbody>{preview.points.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.value}</td><td>{point.lower}</td><td>{point.upper}</td></tr>)}</tbody></table></TableFrame></section>
      <section className={styles.panel}><div className={styles.panelHeader}><h2>{t.backtest}</h2><p>{preview.foldCount} folds · WAPE {preview.backtestMetrics!.wape ?? '—'}</p></div><TableFrame label={t.backtest} className={styles.table}><table><caption className="tirlik-sr-only">{t.backtest}</caption><thead><tr><th>#</th><th>Train end</th><th>Test</th><th>MAE</th><th>WAPE</th></tr></thead><tbody>{preview.folds.map((fold, index) => <tr key={`${fold.testStart}-${fold.testEnd}`}><td>{index + 1}</td><td>{fold.trainEnd}</td><td>{fold.testStart} — {fold.testEnd}</td><td>{fold.metrics.mae}</td><td>{fold.metrics.wape ?? '—'}</td></tr>)}</tbody></table></TableFrame></section>
    </>}
  </section>;
}

