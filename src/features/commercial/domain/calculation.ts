import Decimal from 'decimal.js';
import { CalculationSpecSchema, type CalculationSpec } from '../../../contracts/calculations';
import type { ArtifactContent, TableCell } from '../../artifacts/domain/content-models';
import { tableCellTargetId } from '../../artifacts/domain/targets';

const Money = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_UP });
export type CalculationCell = { value?: string | number | boolean | null; formula?: string };
export type CalculationResult = { state: 'verified' | 'incomplete' | 'modified'; values: Record<string, string | null>; missingIds: string[]; modifiedIds: string[]; subtotal: string | null; total: string | null };
const numeric = (raw: CalculationCell | undefined) => {
  const value = raw?.value;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || text.length > 60) return null;
  return new Money(text);
};
/** Never reads formula caches as inputs, silently accepts a changed formula, or treats an empty price as zero. */
export function evaluateCalculation(raw: CalculationSpec, cells: Record<string, CalculationCell>): CalculationResult {
  const spec = CalculationSpecSchema.parse(raw), values: Record<string, string | null> = {}, missing = new Set<string>(), modified = new Set<string>();
  const read = (id: string) => { const cell = cells[id]; if (cell?.formula) { modified.add(id); return null; } const value = numeric(cell); if (!value || value.isNegative()) missing.add(id); return value && !value.isNegative() ? value : null; };
  const output = (id: string, formula: string, value: Decimal | null) => {
    if (!cells[id]) { missing.add(id); values[id] = null; return null; }
    if (cells[id]?.formula !== formula) modified.add(id);
    const rounded = value?.toDecimalPlaces(spec.scale, Decimal.ROUND_HALF_UP) ?? null;
    values[id] = rounded?.toFixed(spec.scale) ?? null;
    return rounded;
  };
  let subtotal: Decimal | null = new Money(0);
  for (const line of spec.lines) {
    const quantity = read(line.quantityCellId), price = read(line.priceCellId);
    const amount = output(line.amountCellId, line.expectedFormula, quantity && price ? quantity.times(price) : null);
    subtotal = subtotal && amount ? subtotal.plus(amount) : null;
  }
  subtotal = output(spec.subtotalCellId, spec.subtotalFormula, subtotal);
  let discount: Decimal | null = new Money(0), tax: Decimal | null = new Money(0);
  if (spec.discount) {
    const rate = read(spec.discount.rateCellId);
    if (rate?.greaterThan(100)) missing.add(spec.discount.rateCellId);
    discount = output(spec.discount.amountCellId, spec.discount.expectedFormula, subtotal && rate && rate.lessThanOrEqualTo(100) ? subtotal.times(rate).div(100) : null);
  }
  const base = subtotal && discount ? subtotal.minus(discount) : null;
  if (spec.tax) {
    const rate = read(spec.tax.rateCellId);
    if (rate?.greaterThan(100)) missing.add(spec.tax.rateCellId);
    tax = output(spec.tax.amountCellId, spec.tax.expectedFormula, base && rate && rate.lessThanOrEqualTo(100) ? base.times(rate).div(100) : null);
  }
  output(spec.totalCellId, spec.totalFormula, base && tax ? base.plus(tax) : null);
  return { state: modified.size ? 'modified' : missing.size ? 'incomplete' : 'verified', values, missingIds: [...missing], modifiedIds: [...modified], subtotal: values[spec.subtotalCellId] ?? null, total: values[spec.totalCellId] ?? null };
}

/** Called after the spreadsheet engine. Custom formulas remain the user's formulas. */
export function recalculateEstimate(input: Extract<ArtifactContent, { kind: 'table' }>) {
  const content = structuredClone(input), results: Record<string, CalculationResult> = {};
  for (const [sheetId, sheet] of Object.entries(content.workbook.sheets)) {
    const raw = (sheet as typeof sheet & { calculation?: CalculationSpec }).calculation;
    if (!raw) continue;
    const ids = content.stableIds[sheetId];
    if (!ids) continue;
    const cells: Record<string, CalculationCell> = {}, locations = new Map<string, TableCell>();
    for (const [row, rowId] of ids.rows.entries()) for (const [column, columnId] of ids.columns.entries()) {
      const id = tableCellTargetId(sheetId, rowId, columnId), cell = sheet.cellData[row]?.[column];
      if (cell) { cells[id] = { value: cell.v, formula: cell.f }; locations.set(id, cell); }
    }
    const result = evaluateCalculation(raw, cells); results[sheetId] = result;
    if (result.state === 'modified') continue;
    for (const [id, value] of Object.entries(result.values)) {
      const cell = locations.get(id);
      if (cell) { cell.v = value ?? ''; cell.t = 1; }
    }
  }
  return { content, results };
}
