import Decimal from 'decimal.js';
import { z } from 'zod';
import { CurrencySchema, ElementIdSchema, HashSchema, IdSchema, InstantSchema, RevisionSchema } from './primitives';

const FormulaSchema = z.string().min(2).max(8000).startsWith('=');
const AdjustmentSchema = z.strictObject({ rateCellId: ElementIdSchema, amountCellId: ElementIdSchema, expectedFormula: FormulaSchema });
/**
 * ISO-4217 minor-unit scale as provided by the runtime's ICU currency data.
 * Keeping this in the canonical calculation contract prevents callers from
 * assuming that every currency has two fractional digits.
 */
export function currencyMinorUnitScale(rawCurrency: string): number {
  const currency = CurrencySchema.parse(rawCurrency);
  const options = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions();
  if (options.minimumFractionDigits !== options.maximumFractionDigits) throw new Error('calculations.errors.currencyScale');
  return options.maximumFractionDigits!;
}

/** Configuration references the editable workbook; values have one authoritative home. */
export const CalculationSpecSchema = z.strictObject({
  schemaVersion: z.literal(1), currency: CurrencySchema, scale: z.number().int().min(0).max(4), rounding: z.literal('half-up'),
  lines: z.array(z.strictObject({ id: ElementIdSchema, quantityCellId: ElementIdSchema, priceCellId: ElementIdSchema, amountCellId: ElementIdSchema, expectedFormula: FormulaSchema })).min(1).max(200),
  subtotalCellId: ElementIdSchema, subtotalFormula: FormulaSchema,
  discount: AdjustmentSchema.optional(), tax: AdjustmentSchema.optional(),
  totalCellId: ElementIdSchema, totalFormula: FormulaSchema,
}).superRefine((value, context) => {
  const ids = value.lines.flatMap((line) => [line.id, line.quantityCellId, line.priceCellId, line.amountCellId]);
  ids.push(value.subtotalCellId, value.totalCellId);
  if (value.discount) ids.push(value.discount.rateCellId, value.discount.amountCellId);
  if (value.tax) ids.push(value.tax.rateCellId, value.tax.amountCellId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Calculation targets must be distinct.' });
  if (value.scale !== currencyMinorUnitScale(value.currency)) context.addIssue({ code: 'custom', message: 'Calculation scale must match the ISO currency minor unit.' });
});
export type CalculationSpec = z.infer<typeof CalculationSpecSchema>;

const ExactDecimalSchema = z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const CalculationFormulaNodeSchema = z.strictObject({
  outputCellId: ElementIdSchema,
  formula: FormulaSchema,
  inputCellIds: z.array(ElementIdSchema).max(202),
});
export const CalculationExactInputSchema = z.strictObject({ cellId: ElementIdSchema, value: ExactDecimalSchema });
export const CalculationResultSchema = z.strictObject({
  state: z.enum(['verified', 'incomplete', 'modified']),
  values: z.record(ElementIdSchema, ExactDecimalSchema.nullable()),
  missingIds: z.array(ElementIdSchema).max(1000),
  modifiedIds: z.array(ElementIdSchema).max(1000),
  subtotal: ExactDecimalSchema.nullable(),
  total: ExactDecimalSchema.nullable(),
});
export const CalculationCellSnapshotSchema = z.strictObject({
  v: z.union([z.string().max(100000), z.number().finite(), z.boolean(), z.null()]).optional(),
  t: z.number().int().min(1).max(4).optional(),
  f: z.string().max(8000).optional(),
  s: z.union([z.string().max(128), z.record(z.string().max(80), z.json())]).optional(),
  p: z.record(z.string().max(80), z.json()).optional(),
});
export const PreparedCalculationUpdateSchema = z.strictObject({
  cellId: ElementIdSchema,
  beforeHash: HashSchema,
  cell: CalculationCellSnapshotSchema,
});
export const PreparedCalculationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  artifactId: IdSchema,
  projectId: IdSchema,
  sheetId: ElementIdSchema,
  baseRevision: RevisionSchema,
  contentHash: HashSchema,
  preparedAt: InstantSchema,
  expectedSourceRevisions: z.record(IdSchema, RevisionSchema),
  spec: CalculationSpecSchema,
  formulaGraph: z.array(CalculationFormulaNodeSchema).min(1).max(404),
  exactInputs: z.array(CalculationExactInputSchema).min(1).max(404),
  result: CalculationResultSchema,
  updates: z.array(PreparedCalculationUpdateSchema).min(1).max(404),
  inputHash: HashSchema,
  calculationHash: HashSchema,
  preparedHash: HashSchema,
}).superRefine((value, context) => {
  for (const [items, label] of [[value.formulaGraph.map((node) => node.outputCellId), 'formula outputs'], [value.exactInputs.map((input) => input.cellId), 'exact inputs'], [value.updates.map((update) => update.cellId), 'updates']] as const) {
    if (new Set(items).size !== items.length) context.addIssue({ code: 'custom', message: `Prepared calculation ${label} must be unique.` });
  }
  if (value.result.state !== 'verified' || value.result.total === null) context.addIssue({ code: 'custom', message: 'Only a verified calculation can be prepared for apply.' });
});
export const PrepareCalculationRequestSchema = z.strictObject({
  workspaceId: IdSchema,
  artifactId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  baseRevision: RevisionSchema,
  sheetId: ElementIdSchema.optional(),
});
export const ApplyPreparedCalculationRequestSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  prepared: PreparedCalculationSchema,
  reason: z.string().trim().min(1).max(1000),
});

export type CalculationFormulaNode = z.infer<typeof CalculationFormulaNodeSchema>;
export type CalculationExactInput = z.infer<typeof CalculationExactInputSchema>;
export type ExactCalculationResult = z.infer<typeof CalculationResultSchema>;
export type PreparedCalculation = z.infer<typeof PreparedCalculationSchema>;
export type PrepareCalculationRequest = z.infer<typeof PrepareCalculationRequestSchema>;
export type ApplyPreparedCalculationRequest = z.infer<typeof ApplyPreparedCalculationRequestSchema>;

export type ExactCalculationCell = { value?: string | number | boolean | null; formula?: string };
const Money = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -200, toExpPos: 200 });
function numeric(raw: ExactCalculationCell | undefined): Decimal | null {
  const value = raw?.value;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || text.length > 80) return null;
  const result = new Money(text);
  return result.isFinite() ? result : null;
}

/**
 * Pure exact evaluator used by preparation, export and runtime adapters.
 * Formula caches are never read as inputs and changed output formulas are not
 * silently blessed as verified business calculations.
 */
export function evaluateExactCalculation(raw: CalculationSpec, cells: Readonly<Record<string, ExactCalculationCell>>): ExactCalculationResult {
  const spec = CalculationSpecSchema.parse(raw);
  const values: Record<string, string | null> = {}, missing = new Set<string>(), modified = new Set<string>();
  const read = (id: string) => {
    const cell = cells[id];
    if (cell?.formula) { modified.add(id); return null; }
    const value = numeric(cell);
    if (!value || value.isNegative()) missing.add(id);
    return value && !value.isNegative() ? value : null;
  };
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
  return CalculationResultSchema.parse({ state: modified.size ? 'modified' : missing.size ? 'incomplete' : 'verified', values, missingIds: [...missing], modifiedIds: [...modified], subtotal: values[spec.subtotalCellId] ?? null, total: values[spec.totalCellId] ?? null });
}
