import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import ARIMA, { type ArimaOptions } from 'arima';
import { ForecastRunSchema, type ForecastRun } from '@/contracts/business-work';
import { ForecastSeriesSchema, type ForecastSeries } from '../contracts';

const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
type Value = InstanceType<typeof Exact>;
type Family = ForecastRun['model']['family'];
type Metrics = { mae: string; wape: string | null };
type Model = { family: Family; parameters: Record<string, string | number | boolean>; predict(train: readonly Value[], horizon: number): Value[] };

const minimumHistory = { daily: 56, weekly: 26, monthly: 24 } as const;
const seasonalPeriod = { daily: 7, weekly: 52, monthly: 12 } as const;
const stepDays = { daily: 1, weekly: 7 } as const;

function nextDate(raw: string, aggregation: ForecastSeries['aggregation'], steps = 1) {
  const value = new Date(`${raw}T00:00:00.000Z`);
  if (aggregation === 'monthly') value.setUTCMonth(value.getUTCMonth() + steps);
  else value.setUTCDate(value.getUTCDate() + stepDays[aggregation] * steps);
  return value.toISOString().slice(0, 10);
}

function expectedNext(left: string, right: string, aggregation: ForecastSeries['aggregation']) {
  return nextDate(left, aggregation) === right;
}

function decimal(value: Value) {
  return value.toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed().replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function metrics(actual: readonly Value[], predicted: readonly Value[]): Metrics {
  if (actual.length !== predicted.length || actual.length === 0) throw new Error('FORECAST_METRICS_SHAPE');
  let absolute = new Exact(0), denominator = new Exact(0);
  for (let index = 0; index < actual.length; index++) {
    absolute = absolute.plus(actual[index]!.minus(predicted[index]!).abs());
    denominator = denominator.plus(actual[index]!.abs());
  }
  return { mae: decimal(absolute.div(actual.length)), wape: denominator.isZero() ? null : decimal(absolute.div(denominator)) };
}

function lastValue(): Model {
  return { family: 'last-value', parameters: {}, predict: (train, horizon) => Array.from({ length: horizon }, () => train.at(-1) ?? new Exact(0)) };
}

function seasonalNaive(period: number): Model {
  return {
    family: 'seasonal-naive', parameters: { period },
    predict(train, horizon) {
      if (train.length < period) return lastValue().predict(train, horizon);
      return Array.from({ length: horizon }, (_, index) => train[train.length - period + index % period]!);
    },
  };
}

function ctsa(options: ArimaOptions, family: 'arima' | 'sarima'): Model {
  const parameters = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined && typeof value !== 'object')) as Record<string, string | number | boolean>;
  return {
    family, parameters: { engine: 'ctsa', ...parameters },
    predict(train, horizon) {
      const center = train.reduce((sum, value) => sum.plus(value), new Exact(0)).div(train.length);
      const scale = Decimal.max(new Exact(1), ...train.map((value) => value.minus(center).abs()));
      const normalized = train.map((value) => value.minus(center).div(scale).toNumber());
      if (normalized.some((value) => !Number.isFinite(value))) throw new Error('FORECAST_NUMERIC_RANGE');
      const model = new ARIMA({ ...options, verbose: false });
      try {
        model.train(normalized);
        const [predicted] = model.predict(horizon);
        if (predicted.length !== horizon || predicted.some((value) => !Number.isFinite(value))) throw new Error('FORECAST_MODEL_OUTPUT');
        return predicted.map((value) => new Exact(value).times(scale).plus(center));
      } finally { model.destroy(); }
    },
  };
}

function quantile(values: readonly Value[], probability: number) {
  const sorted = [...values].sort((left, right) => left.comparedTo(right));
  if (!sorted.length) return new Exact(0);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1))]!;
}

function insufficient(input: ForecastSeries, reasons: string[]): ForecastRun {
  return ForecastRunSchema.parse({
    id: randomUUID(), eligibility: { state: 'insufficient', reasons }, model: { family: 'last-value', parameters: { selected: false } },
    trainRange: { start: input.coverage.start, end: input.coverage.end }, backtest: { folds: [], metrics: null }, points: [], ranges: [],
    interval: { method: 'none', level: 0, empiricalCoverage: null }, baseline: { family: 'last-value', metrics: null }, sourceRevisions: input.sourceRevisions,
  });
}

/**
 * Deterministic rolling-origin forecast. Every fold trains only on values before
 * its test window. A fitted AR(1) is selected only when it beats the strongest
 * naive baseline on the same folds; otherwise the baseline remains authoritative.
 */
export function runForecast(raw: ForecastSeries): ForecastRun {
  const input = ForecastSeriesSchema.parse(raw);
  const excluded = new Set(input.exclusions.map((item) => item.date));
  const observations = input.observations.filter((item) => !excluded.has(item.date)).sort((left, right) => left.date.localeCompare(right.date));
  const reasons: string[] = [];
  if (!input.coverage.regular) reasons.push('forecast.eligibility.irregularCoverage');
  if (observations.length < minimumHistory[input.aggregation]) reasons.push(`forecast.eligibility.minimum.${input.aggregation}.${minimumHistory[input.aggregation]}`);
  if (new Set(observations.map((item) => item.date)).size !== observations.length) reasons.push('forecast.eligibility.duplicateDates');
  if (observations.some((item, index) => index > 0 && !expectedNext(observations[index - 1]!.date, item.date, input.aggregation))) reasons.push('forecast.eligibility.gaps');
  if (observations.length !== input.coverage.observations - input.exclusions.filter((item) => input.observations.some((observation) => observation.date === item.date)).length) reasons.push('forecast.eligibility.coverageMismatch');
  if (reasons.length) return insufficient(input, reasons);

  const values = observations.map((item) => new Exact(item.value));
  const zeroRatio = values.filter((value) => value.isZero()).length / values.length;
  const center = quantile(values, 0.5), deviations = values.map((value) => value.minus(center).abs()), mad = quantile(deviations, 0.5);
  const outliers = mad.isZero() ? 0 : deviations.filter((value) => value.greaterThan(mad.times(6))).length;
  const foldSize = Math.max(1, Math.min(input.horizon, Math.floor(values.length / 8)));
  const earliestTrain = Math.max(8, Math.floor(values.length / 2));
  const possible = Math.floor((values.length - earliestTrain) / foldSize);
  const foldCount = Math.max(2, Math.min(5, possible));
  if (possible < 2) return insufficient(input, ['forecast.eligibility.folds']);
  const firstTest = values.length - foldCount * foldSize;
  const foldStarts = Array.from({ length: foldCount }, (_, index) => firstTest + index * foldSize);
  const period = seasonalPeriod[input.aggregation];
  const baselines = [lastValue(), ...(values.length >= period + foldSize ? [seasonalNaive(period)] : [])];
  const candidateModels: Model[] = [
    ctsa({ p: 1, d: 0, q: 0, method: 0, optimizer: 6 }, 'arima'),
    ctsa({ p: 1, d: 1, q: 0, method: 0, optimizer: 6 }, 'arima'),
    ctsa({ p: 0, d: 1, q: 1, method: 0, optimizer: 6 }, 'arima'),
    ...(values.length >= Math.max(36, period * 3) ? [ctsa({ p: 1, d: 0, q: 0, P: 1, D: 0, Q: 0, s: period, method: 0, optimizer: 6 }, 'sarima')] : []),
  ];

  const evaluate = (factory: (train: readonly Value[]) => Model) => {
    const actualAll: Value[] = [], predictedAll: Value[] = [], errors: Value[] = [];
    const folds = foldStarts.map((testStart) => {
      const train = values.slice(0, testStart), actual = values.slice(testStart, testStart + foldSize), predicted = factory(train).predict(train, actual.length);
      actualAll.push(...actual); predictedAll.push(...predicted); errors.push(...actual.map((value, index) => value.minus(predicted[index]!).abs()));
      return { trainEnd: observations[testStart - 1]!.date, testStart: observations[testStart]!.date, testEnd: observations[testStart + actual.length - 1]!.date, metrics: metrics(actual, predicted) };
    });
    return { metrics: metrics(actualAll, predictedAll), folds, errors };
  };

  const baselineScores = baselines.map((model) => ({ model, result: evaluate(() => model) }));
  baselineScores.sort((left, right) => new Exact(left.result.metrics.mae).comparedTo(right.result.metrics.mae));
  const baseline = baselineScores[0]!;
  const candidates = candidateModels.flatMap((model) => {
    try { return [{ model, result: evaluate(() => model) }]; } catch { return []; }
  });
  candidates.sort((left, right) => new Exact(left.result.metrics.mae).comparedTo(right.result.metrics.mae));
  const bestCandidate = candidates[0];
  const selected = bestCandidate && new Exact(bestCandidate.result.metrics.mae).lessThan(new Exact(baseline.result.metrics.mae).times('0.995')) ? bestCandidate : baseline;
  const fitted = selected.model;
  const points = fitted.predict(values, input.horizon);
  const errorQuantile = quantile(selected.result.errors, 0.9);
  const empiricalCoverage = selected.result.errors.length ? selected.result.errors.filter((value) => value.lessThanOrEqualTo(errorQuantile)).length / selected.result.errors.length : null;
  const dates = Array.from({ length: input.horizon }, (_, index) => nextDate(observations.at(-1)!.date, input.aggregation, index + 1));
  return ForecastRunSchema.parse({
    id: randomUUID(), eligibility: { state: 'eligible', reasons: [...(zeroRatio >= 0.4 ? ['forecast.coverage.zeroHeavy'] : []), ...(outliers ? [`forecast.coverage.outliers.${outliers}`] : [])] },
    model: { family: fitted.family, parameters: { ...fitted.parameters, baselineRetained: selected === baseline } },
    trainRange: { start: observations[0]!.date, end: observations.at(-1)!.date }, backtest: { folds: selected.result.folds, metrics: selected.result.metrics },
    points: dates.map((date, index) => ({ date, value: decimal(points[index]!) })),
    ranges: dates.map((date, index) => ({ date, lower: decimal(points[index]!.minus(errorQuantile)), upper: decimal(points[index]!.plus(errorQuantile)) })),
    interval: { method: 'residual-quantile', level: 0.9, empiricalCoverage }, baseline: { family: baseline.model.family, metrics: baseline.result.metrics }, sourceRevisions: input.sourceRevisions,
  });
}

