import { describe, expect, it } from 'vitest';
import { runForecast } from '@/features/forecast/domain/run-forecast';
import { buildForecastArtifacts } from '@/features/forecast/domain/artifact-builders';

const ref = { sourceId: '10000000-0000-4000-8000-000000000001', sourceVersionId: '10000000-0000-4000-8000-000000000002', revision: 4 };
const date = (offset: number) => { const value = new Date('2026-01-01T00:00:00.000Z'); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
const input = (values: string[]) => ({
  seriesRef: ref, target: 'revenue', dateColumn: 'date', valueColumn: 'value', aggregation: 'daily' as const, horizon: 7,
  calendar: { timezone: 'Asia/Qyzylorda', frequency: 'daily' as const }, exclusions: [],
  coverage: { start: date(0), end: date(values.length - 1), observations: values.length, regular: true }, sourceRevisions: { [ref.sourceId]: ref.revision },
  observations: values.map((value, index) => ({ id: `row_${index}`, date: date(index), value })),
});

describe('forecast engine', () => {
  it('uses rolling-origin folds without future observations and selects a fitted candidate only when it beats the baseline', () => {
    const run = runForecast(input(Array.from({ length: 70 }, (_, index) => String(50 + index * 3))));
    expect(run.eligibility.state).toBe('eligible');
    expect(run.backtest.folds.length).toBeGreaterThanOrEqual(2);
    for (const fold of run.backtest.folds) expect(fold.trainEnd < fold.testStart).toBe(true);
    expect(run.model.family).toBe('arima');
    expect(run.points).toHaveLength(7);
    expect(run.ranges.every((range, index) => range.date === run.points[index]!.date && Number(range.lower) <= Number(run.points[index]!.value) && Number(range.upper) >= Number(run.points[index]!.value))).toBe(true);
    expect(run.interval).toMatchObject({ method: 'residual-quantile', level: 0.9 });
  });

  it('retains the measured baseline when a fitted model is weaker', () => {
    const run = runForecast(input(Array.from({ length: 70 }, (_, index) => index % 7 === 0 ? '20' : '5')));
    expect(run.eligibility.state).toBe('eligible');
    expect(['last-value', 'seasonal-naive']).toContain(run.model.family);
    expect(run.model.parameters.baselineRetained).toBe(true);
  });

  it('returns an honest persisted-path result for insufficient history without invented accuracy', () => {
    const run = runForecast(input(Array.from({ length: 12 }, (_, index) => String(index))));
    expect(run.eligibility.state).toBe('insufficient');
    expect(run.backtest).toEqual({ folds: [], metrics: null });
    expect(run.baseline.metrics).toBeNull();
    expect(run.points).toEqual([]);
    expect(run.ranges).toEqual([]);
    expect(run.interval).toEqual({ method: 'none', level: 0, empiricalCoverage: null });
  });

  it('reports WAPE as unknown when the actual denominator is zero', () => {
    const run = runForecast(input(Array.from({ length: 60 }, () => '0')));
    expect(run.eligibility.state).toBe('eligible');
    expect(run.backtest.metrics?.wape).toBeNull();
    expect(run.baseline.metrics?.wape).toBeNull();
    expect(run.eligibility.reasons).toContain('forecast.coverage.zeroHeavy');
  });

  it('builds editable history, forecast, backtest and report artifacts', () => {
    const series = input(Array.from({ length: 70 }, (_, index) => String(10 + index)));
    const run = runForecast(series), built = buildForecastArtifacts(series, run, 'kk');
    expect(built.workbook.workbook.sheetOrder).toEqual(['forecast_history', 'forecast_points', 'forecast_backtest']);
    expect(built.workbook.workbook.sheets.forecast_points?.charts?.[0]?.valueColumnIds).toEqual(['point', 'lower', 'upper']);
    expect(built.report.document.type).toBe('doc');
  });
});

