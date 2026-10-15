import Decimal from 'decimal.js';
import type { SourceRef } from '@/contracts/artifacts';
import type { SourceFragment } from '@/contracts/sources';
import { MaterialValueSchema, type ImportMapping, type MaterialCell, type MaterialField, type MaterialValue } from '@/contracts/materials';
import { canonicalJson, hashJson } from '@/features/artifacts/domain/canonical';

const Exact = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });
const unknown = (reason: string): MaterialValue => ({ kind: 'unknown', reason });
const units: Record<string, { unit: string; dimension: string; scale: string }> = {
  kg: { unit: 'kg', dimension: 'mass', scale: '1' }, 'кг': { unit: 'kg', dimension: 'mass', scale: '1' },
  g: { unit: 'g', dimension: 'mass', scale: '0.001' }, 'г': { unit: 'g', dimension: 'mass', scale: '0.001' },
  l: { unit: 'l', dimension: 'volume', scale: '1' }, 'л': { unit: 'l', dimension: 'volume', scale: '1' },
  ml: { unit: 'ml', dimension: 'volume', scale: '0.001' }, 'мл': { unit: 'ml', dimension: 'volume', scale: '0.001' },
  m: { unit: 'm', dimension: 'length', scale: '1' }, 'м': { unit: 'm', dimension: 'length', scale: '1' },
  cm: { unit: 'cm', dimension: 'length', scale: '0.01' }, 'см': { unit: 'cm', dimension: 'length', scale: '0.01' },
  pcs: { unit: 'pcs', dimension: 'count', scale: '1' }, 'шт': { unit: 'pcs', dimension: 'count', scale: '1' },
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseExactNumber(raw: string, field: Pick<MaterialField, 'decimalSeparator' | 'groupSeparator'>): string | null {
  let text = raw.trim().replace(/[\u00a0\u202f]/g, ' ');
  const decimal = escape(field.decimalSeparator);
  const group = field.groupSeparator === 'space' ? ' ' : field.groupSeparator === 'none' ? null : escape(field.groupSeparator);
  const integer = group ? `(?:\\d{1,3}(?:${group}\\d{3})+|\\d+)` : '\\d+';
  if (!new RegExp(`^[+-]?${integer}(?:${decimal}\\d+)?$`).test(text)) return null;
  if (group) text = text.replace(new RegExp(group, 'g'), '');
  text = text.replace(field.decimalSeparator, '.');
  try {
    const result = new Exact(text).toFixed();
    return result.length <= 80 ? result : null;
  } catch { return null; }
}

function parseDate(raw: string, format: MaterialField['dateFormat']): string | null {
  const separator = format.includes('/') ? '/' : format.includes('.') ? '.' : '-';
  const parts = raw.trim().split(separator), layout = format.split(separator);
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const year = parts[layout.indexOf('YYYY')]!, month = parts[layout.indexOf('MM')]!, day = parts[layout.indexOf('DD')]!;
  if (year.length !== 4 || month.length > 2 || day.length > 2 || Number(year) < 1) return null;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function normalizeValue(raw: string, field: MaterialField): MaterialValue {
  if (field.emptyValues.includes(raw.trim())) return unknown('empty');
  if (field.kind === 'text') return { kind: 'text', text: raw };
  if (field.kind === 'date') {
    const date = parseDate(raw, field.dateFormat);
    return date ? { kind: 'date', date, precision: 'day' } : unknown('date');
  }
  let text = raw.trim(), multiplier = new Exact(1);
  if (field.kind === 'money') {
    const symbol = field.currency === 'KZT' ? '(?:KZT|₸|тг\\.?)' : escape(field.currency);
    text = text.replace(new RegExp(`^${symbol}\\s*|\\s*${symbol}$`, 'i'), '').trim();
  }
  if (field.kind === 'quantity') {
    const sourceName = field.sourceUnit || field.unit;
    const source = units[sourceName.toLowerCase()], target = units[field.unit.toLowerCase()];
    const suffix = text.match(/\s*([^\d\s.,+\-]+)\s*$/)?.[1];
    if (suffix) {
      const declared = units[suffix.toLowerCase()];
      if (suffix.toLowerCase() !== sourceName.toLowerCase() && (!source || !declared || source.unit !== declared.unit)) return unknown('unit');
      text = text.slice(0, text.lastIndexOf(suffix)).trim();
    }
    if (sourceName !== field.unit) {
      if (!source || !target || source.dimension !== target.dimension) return unknown('unit');
      multiplier = new Exact(source.scale).div(target.scale);
    }
  }
  const numeric = parseExactNumber(text, field);
  if (numeric === null) return unknown('number');
  const number = new Exact(numeric).mul(multiplier);
  if (number.isNegative() && !field.adjustmentReason) return unknown('negative');
  const adjustment = field.adjustmentReason ? { adjustmentReason: field.adjustmentReason } : {};
  let result: MaterialValue;
  if (field.kind === 'money') {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: field.currency }).resolvedOptions().maximumFractionDigits;
    const minor = number.mul(new Exact(10).pow(digits ?? 2));
    if (!minor.isInteger()) return unknown('precision');
    result = { kind: 'money', minorUnits: minor.toFixed(0), currency: field.currency, ...adjustment };
  } else if (field.kind === 'quantity') result = { kind: 'quantity', decimal: number.toFixed(), unit: field.unit, ...adjustment };
  else result = { kind: 'decimal', decimal: number.toFixed(), ...adjustment };
  const validated = MaterialValueSchema.safeParse(result);
  return validated.success ? validated.data : unknown('number');
}

export function mapFragment(fragment: SourceFragment, mapping: ImportMapping, sourceRef: SourceRef): Record<string, MaterialCell> {
  const values = fragment.values ?? [fragment.text ?? ''];
  return Object.fromEntries(mapping.fields.map((field) => {
    const rawValue = values[field.column] ?? '';
    const value = normalizeValue(rawValue, field);
    return [field.id, {
      value, rawValue, reviewState: fragment.review === 'needs-review' || value.kind === 'unknown' ? 'needs-review' : 'observed',
      origin: 'observed', sourceRef, factRevision: 0,
      lineage: { fragmentId: fragment.id, column: field.column, ...(fragment.row ? { row: fragment.row } : {}), ...(fragment.sheet ? { sheet: fragment.sheet } : {}), ...(fragment.page ? { page: fragment.page } : {}) },
    } satisfies MaterialCell];
  }));
}

export function recordKey(cells: Record<string, MaterialCell>, mapping: ImportMapping): { key: string | null; hash: string | null } {
  const spec = mapping.recordKeySpec;
  if (spec.kind === 'fingerprint') {
    const values = Object.fromEntries(Object.keys(cells).sort().map((id) => [id, cells[id]!.rawValue]));
    return { key: canonicalJson(values), hash: hashJson(values) };
  }
  const parts = spec.fieldIds.map((id) => {
    const cell = cells[id];
    if (!cell || cell.value.kind === 'unknown') return null;
    let value = spec.trim ? cell.rawValue.trim() : cell.rawValue;
    if (!spec.caseSensitive) value = value.toLocaleLowerCase('und');
    return value || null;
  });
  if (parts.some((part) => part === null)) return { key: null, hash: null };
  const key = JSON.stringify(parts);
  return { key, hash: hashJson(parts) };
}

export function cellsHash(cells: Record<string, MaterialCell>): string {
  return hashJson(Object.fromEntries(Object.keys(cells).sort().map((id) => [id, { value: cells[id]!.value, reviewState: cells[id]!.reviewState }])));
}
export function compatibleFields(previous: ImportMapping | null, next: ImportMapping): boolean {
  if (!previous) return true;
  // Key semantics cannot be replaced while retaining the same identity namespace.
  return canonicalJson(previous.recordKeySpec) === canonicalJson(next.recordKeySpec)
    && previous.fields.every((field) => {
      const current = next.fields.find((candidate) => candidate.id === field.id);
      return !current || field.kind === current.kind && field.currency === current.currency && field.unit === current.unit;
    });
}
export function isHeader(fragment: SourceFragment, mapping: ImportMapping): boolean {
  return mapping.headerRow > 0 && fragment.row === mapping.headerRow && (mapping.sheet === null || fragment.sheet === mapping.sheet);
}
export function matchesHeaders(fragment: SourceFragment, mapping: ImportMapping): boolean {
  return canonicalJson(fragment.values ?? []) === canonicalJson(mapping.headers);
}
export function rowLabel(cells: Record<string, MaterialCell>, mapping: ImportMapping): string {
  const ids = mapping.recordKeySpec.kind === 'fields' ? mapping.recordKeySpec.fieldIds : mapping.fields.slice(0, 2).map((field) => field.id);
  return ids.map((id) => cells[id]?.rawValue ?? '').join(' / ').slice(0, 240);
}
export function cellIssues(cells: Record<string, MaterialCell>): string[] {
  return [...new Set(Object.values(cells).flatMap((cell) => cell.value.kind === 'unknown' ? [`unknown:${cell.value.reason ?? 'value'}`] : cell.reviewState === 'needs-review' ? ['review'] : []))];
}
