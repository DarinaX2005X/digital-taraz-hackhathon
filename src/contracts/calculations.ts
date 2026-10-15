import { z } from 'zod';
import { CurrencySchema, ElementIdSchema } from './primitives';

const FormulaSchema = z.string().min(2).max(8000).startsWith('=');
const AdjustmentSchema = z.strictObject({ rateCellId: ElementIdSchema, amountCellId: ElementIdSchema, expectedFormula: FormulaSchema });
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
});
export type CalculationSpec = z.infer<typeof CalculationSpecSchema>;
