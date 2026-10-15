import Decimal from 'decimal.js';
import type { DependencyTransform } from '../../../contracts/dependencies';
import type { MaterialValue } from '../../../contracts/materials';
import { ContentValidationError } from '../../artifacts/domain/canonical';
import type { JsonValue } from '../../artifacts/domain/content-models';
import type { ArtifactTarget } from '../../artifacts/domain/targets';

const Exact = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP });
export type DependencyScalar = string | number | boolean | null;
export function exactDecimal(value: DependencyScalar): Decimal {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value)) || String(value).length > 80) throw new ContentValidationError('dependency-number-required');
  const result = new Exact(value);
  if (!result.isFinite()) throw new ContentValidationError('dependency-number-required');
  return result;
}
export function materialScalar(value: MaterialValue): DependencyScalar {
  switch (value.kind) {
    case 'money': { const scale = new Intl.NumberFormat('en', { style: 'currency', currency: value.currency }).resolvedOptions().maximumFractionDigits ?? 2; return new Exact(value.minorUnits).div(new Exact(10).pow(scale)).toFixed(scale); }
    case 'decimal': case 'quantity': return value.decimal;
    case 'text': return value.text;
    case 'date': return value.date;
    default: throw new ContentValidationError('dependency-value-unknown');
  }
}
export function targetScalar(target: ArtifactTarget): DependencyScalar {
  const value = target.value as Record<string, JsonValue> | null;
  if (!value || Array.isArray(value)) throw new ContentValidationError('dependency-value-unknown');
  const scalar = target.kind === 'table-cell' ? value.v : target.kind === 'document-node' && value.type === 'dataField' ? (value.attrs as Record<string, JsonValue> | undefined)?.value : target.kind === 'design-layer' && value.type === 'text' ? value.text : undefined;
  if (scalar === undefined || typeof scalar === 'object') throw new ContentValidationError('dependency-value-unknown');
  if (typeof scalar === 'string' && /^#(?:REF!|VALUE!|DIV\/0!|NAME\?|NUM!|N\/A|CYCLE!|ERROR!)/.test(scalar)) throw new ContentValidationError('dependency-formula-error');
  return scalar;
}
export function transformValue(transform: DependencyTransform, inputs: ReadonlyMap<string, DependencyScalar>): DependencyScalar {
  const read = (key: string) => { if (!inputs.has(key)) throw new ContentValidationError('dependency-input-missing'); return inputs.get(key)!; };
  if (transform.kind === 'copy' || transform.kind === 'material-format') return read(transform.input);
  if (transform.kind === 'decimal') {
    const initial = new Exact(transform.operation === 'sum' ? 0 : 1);
    const result = transform.inputs.reduce((value, key) => transform.operation === 'sum' ? value.add(exactDecimal(read(key))) : value.mul(exactDecimal(read(key))), initial).toDecimalPlaces(transform.scale);
    if (result.toFixed(transform.scale).length > 80) throw new ContentValidationError('dependency-number-too-large');
    return result.toFixed(transform.scale);
  }
  const amount = exactDecimal(read(transform.input)).div(transform.basis === 'minor' ? new Exact(10).pow(transform.scale) : 1).toFixed(transform.scale);
  // Format the integer as BigInt, never convert money through an IEEE-754 float.
  const negative = amount.startsWith('-'), [whole, fraction] = amount.replace(/^-/, '').split('.');
  const formatter = new Intl.NumberFormat(transform.locale, { style: 'currency', currency: transform.currency, minimumFractionDigits: transform.scale, maximumFractionDigits: transform.scale });
  const parts = formatter.formatToParts(BigInt(`${negative ? '-' : ''}${whole}`));
  const formatted = parts.map((part) => part.type === 'fraction' ? fraction ?? '0'.repeat(transform.scale) : part.value).join('');
  return negative && whole === '0' ? `-${formatted}` : formatted;
}

/** The binding transform `material-value` uses this exact display conversion. */
export function formatMaterialValue(value: MaterialValue, locale: 'ru' | 'kk' | 'en'): string {
  switch (value.kind) {
    case 'text': return value.text;
    case 'decimal': return value.decimal;
    case 'quantity': return `${value.decimal} ${value.unit}`;
    case 'date': return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${value.date}T00:00:00Z`));
    case 'money': { const scale = new Intl.NumberFormat(locale, { style: 'currency', currency: value.currency }).resolvedOptions().maximumFractionDigits ?? 2; return String(transformValue({ kind: 'money-format', input: 'value', locale, currency: value.currency, scale, basis: 'minor' }, new Map([['value', value.minorUnits]]))); }
    default: throw new ContentValidationError('dependency-value-unknown');
  }
}

/** Replace only the field value, retaining document words, cell formulas and layer geometry. */
export function replaceTargetScalar(target: ArtifactTarget, scalar: DependencyScalar): JsonValue {
  const value = target.value as Record<string, JsonValue> | null;
  if (target.kind === 'table-cell') {
    const numeric = typeof scalar === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(scalar) ? Number(scalar) : scalar;
    const safeNumber = typeof numeric === 'number' && Number.isFinite(numeric) && new Exact(numeric).eq(String(scalar));
    const next = safeNumber ? numeric : scalar;
    return { ...value ?? {}, v: next, t: typeof next === 'number' ? 2 : typeof next === 'boolean' ? 3 : 1 };
  }
  if (target.kind === 'document-node' && value?.type === 'dataField') return { ...value, attrs: { ...value.attrs as Record<string, JsonValue>, value: String(scalar ?? '') } };
  if (target.kind === 'design-layer' && value?.type === 'text') return { ...value, text: String(scalar ?? '') };
  throw new ContentValidationError('dependency-target-not-a-field');
}
