import type { ForecastRun } from '@/contracts/business-work';
import type { Locale } from '@/contracts/primitives';
import type { ArtifactContent } from '@/features/artifacts/domain/content-models';
import { bulletList, documentArtifact, heading, paragraph, uniqueSourceRefs, workbookArtifact } from '@/features/finance/domain/artifact-builders';
import type { ForecastSeries } from '../contracts';

const labels = {
  ru: { title: 'Прогноз и историческая проверка', history: 'История', forecast: 'Прогноз', backtest: 'Историческая проверка', report: 'Отчёт по прогнозу', insufficient: 'Истории недостаточно для проверяемого прогноза. Ввод сохранён для сценарной работы.', interval: 'Диапазон построен по квантилю ошибок исторической проверки; эмпирическое покрытие показано отдельно.' },
  kk: { title: 'Болжам және тарихи тексеру', history: 'Тарих', forecast: 'Болжам', backtest: 'Тарихи тексеру', report: 'Болжам есебі', insufficient: 'Тексерілетін болжам үшін тарих жеткіліксіз. Кіріс сценарийлік жұмыс үшін сақталды.', interval: 'Ауқым тарихи тексеру қателерінің квантилі бойынша құрылды; эмпирикалық қамту бөлек көрсетілді.' },
  en: { title: 'Forecast and historical check', history: 'History', forecast: 'Forecast', backtest: 'Backtest', report: 'Forecast report', insufficient: 'There is not enough history for a tested forecast. The input is saved for scenario work.', interval: 'The range uses a historical-error quantile; empirical coverage is shown separately.' },
} as const;

export function buildForecastArtifacts(input: ForecastSeries, run: ForecastRun, locale: Locale): { workbook: Extract<ArtifactContent, { kind: 'table' }>; report: Extract<ArtifactContent, { kind: 'document' }>; sourceRefs: typeof input.seriesRef[] } {
  const copy = labels[locale];
  const historyRows = input.observations.map((item, index) => ({ id: `history_${index}`, values: [item.date, item.value, input.exclusions.some((excluded) => excluded.date === item.date)] }));
  const forecastRows = run.points.map((point, index) => ({ id: `forecast_${index}`, values: [point.date, point.value, run.ranges[index]!.lower, run.ranges[index]!.upper] }));
  const foldRows = run.backtest.folds.map((fold, index) => ({ id: `fold_${index}`, values: [index + 1, fold.trainEnd, fold.testStart, fold.testEnd, fold.metrics.mae, fold.metrics.wape] }));
  const forecastFallback = [{ id: 'forecast_empty', values: [null, null, null, null] }];
  const foldFallback = [{ id: 'fold_empty', values: [null, null, null, null, null, null] }];
  const workbook = workbookArtifact(copy.title, locale, [
    { id: 'forecast_history', name: copy.history, columns: [{ id: 'date', title: 'Date', unit: { kind: 'date' } }, { id: 'value', title: input.target, unit: { kind: 'number' } }, { id: 'excluded', title: 'Excluded' }], rows: historyRows.length ? historyRows : [{ id: 'history_empty', values: [null, null, false] }], chart: historyRows.length ? { id: 'history_chart', title: copy.history, type: 'line', labelColumnId: 'date', valueColumnIds: ['value'], rowIds: historyRows.slice(-500).map((row) => row.id) } : undefined },
    { id: 'forecast_points', name: copy.forecast, columns: [{ id: 'date', title: 'Date', unit: { kind: 'date' } }, { id: 'point', title: 'Point', unit: { kind: 'number' } }, { id: 'lower', title: 'Lower', unit: { kind: 'number' } }, { id: 'upper', title: 'Upper', unit: { kind: 'number' } }], rows: forecastRows.length ? forecastRows : forecastFallback, chart: forecastRows.length ? { id: 'forecast_chart', title: copy.forecast, type: 'line', labelColumnId: 'date', valueColumnIds: ['point', 'lower', 'upper'], rowIds: forecastRows.slice(0, 500).map((row) => row.id) } : undefined },
    { id: 'forecast_backtest', name: copy.backtest, columns: [{ id: 'fold', title: 'Fold' }, { id: 'train_end', title: 'Train end', unit: { kind: 'date' } }, { id: 'test_start', title: 'Test start', unit: { kind: 'date' } }, { id: 'test_end', title: 'Test end', unit: { kind: 'date' } }, { id: 'mae', title: 'MAE', unit: { kind: 'number' } }, { id: 'wape', title: 'WAPE', unit: { kind: 'number' } }], rows: foldRows.length ? foldRows : foldFallback },
  ]);
  const eligible = run.eligibility.state === 'eligible';
  const report = documentArtifact([
    heading(copy.report), paragraph(`${input.target} · ${input.aggregation} · ${input.coverage.start} — ${input.coverage.end}`),
    paragraph(eligible ? `${run.model.family} · MAE ${run.backtest.metrics!.mae} · WAPE ${run.backtest.metrics!.wape ?? 'unknown'} · baseline ${run.baseline.family} MAE ${run.baseline.metrics!.mae}.` : copy.insufficient),
    ...(eligible ? [paragraph(`${copy.interval} ${run.interval.method}, level ${run.interval.level}, empirical coverage ${run.interval.empiricalCoverage ?? 'unknown'}.`)] : []),
    ...(run.eligibility.reasons.length ? [heading('Coverage', 2), bulletList(run.eligibility.reasons)] : []),
  ]);
  return { workbook, report, sourceRefs: uniqueSourceRefs([input.seriesRef]) };
}

