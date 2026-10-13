import { z } from 'zod';

export const IdSchema = z.uuid();
export const RevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const LocaleSchema = z.enum(['ru', 'kk', 'en']);
export const InstantSchema = z.iso.datetime();
export const CalendarDateSchema = z.iso.date();
export const ElementIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const DecimalStringSchema = z.string().max(80).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const currencies = new Set(Intl.supportedValuesOf('currency'));
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/).refine((value) => currencies.has(value));

export const MoneySchema = z.strictObject({
  currency: CurrencySchema,
  minorUnits: z.string().max(80).regex(/^(?:0|[1-9]\d*)$/),
});
export const MoneyAdjustmentSchema = z.strictObject({
  currency: CurrencySchema,
  minorUnits: z.string().max(80).regex(/^-?(?:0|[1-9]\d*)$/),
  reason: z.enum(['return', 'correction']),
});
export const QuantitySchema = z.strictObject({
  decimal: DecimalStringSchema,
  unit: z.string().trim().min(1).max(40),
});

export type Money = z.infer<typeof MoneySchema>;
export type Quantity = z.infer<typeof QuantitySchema>;
export type Locale = z.infer<typeof LocaleSchema>;
