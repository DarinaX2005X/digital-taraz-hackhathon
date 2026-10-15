import type { MaterialValue } from '@/contracts/materials';
export function valueText(value: MaterialValue, unknown: string): string {
  if (value.kind === 'unknown') return unknown;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.date;
  if (value.kind === 'quantity') return `${value.decimal} ${value.unit}`;
  if (value.kind === 'decimal') return value.decimal;
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: value.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = value.minorUnits.startsWith('-'), text = value.minorUnits.replace(/^-/, '').padStart(digits + 1, '0');
  return `${negative ? '-' : ''}${digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text} ${value.currency}`;
}
/** UI input is a human currency amount; dataset predicates use the stored exact minor-unit scalar. */
export function moneyFilterScalar(raw: string, currency: string): string | null {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const match = raw.trim().match(/^(-?)(\d+)(?:[.,](\d+))?$/);
  if (!match || (match[3]?.length ?? 0) > digits) return null;
  const unsigned = `${match[2]}${(match[3] ?? '').padEnd(digits,'0')}`.replace(/^0+(?=\d)/,'');
  return `${match[1] && /[1-9]/.test(unsigned) ? '-' : ''}${unsigned}`;
}

