import Decimal from 'decimal.js';
import { UsdSchema } from '../../../contracts/runs';

const Exact = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_CEIL });
export function usd(value: string): Decimal {
  return new Exact(UsdSchema.parse(value));
}
export function usdString(value: Decimal): string {
  if (!value.isFinite() || value.isNegative()) throw new Error('INVALID_USD');
  return UsdSchema.parse(value.toDecimalPlaces(12, Decimal.ROUND_CEIL).toFixed().replace(/\.0+$/, ''));
}
export function addUsd(...values: string[]): string {
  return usdString(values.reduce((sum, value) => sum.plus(usd(value)), new Exact(0)));
}
export function subtractUsd(left: string, right: string): string {
  return usdString(usd(left).minus(usd(right)));
}
export function exceedsUsd(...values: [limit: string, ...costs: string[]]): boolean {
  const [limit, ...costs] = values;
  return usd(addUsd(...costs)).gt(usd(limit));
}
