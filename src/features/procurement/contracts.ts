import { z } from 'zod';
import { SourceRefSchema } from '@/contracts/artifacts';
import { CalendarDateSchema, CurrencySchema, ElementIdSchema, MoneySchema, QuantitySchema } from '@/contracts/primitives';

export const ProcurementNeedLineSchema = z.strictObject({
  id: ElementIdSchema,
  itemKey: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1000),
  quantity: QuantitySchema,
  requiredBy: CalendarDateSchema.nullable(),
  sourceRefs: z.array(SourceRefSchema).max(20).default([]),
});

export const StockLineSchema = z.strictObject({
  id: ElementIdSchema,
  itemKey: z.string().trim().min(1).max(240),
  quantity: QuantitySchema,
  asOf: CalendarDateSchema,
  sourceRefs: z.array(SourceRefSchema).max(20).default([]),
});

export const SupplierOfferSchema = z.strictObject({
  id: ElementIdSchema,
  supplierId: z.string().trim().min(1).max(240),
  supplierName: z.string().trim().min(1).max(240),
  itemKey: z.string().trim().min(1).max(240),
  packQuantity: QuantitySchema,
  packPrice: MoneySchema.nullable(),
  minimumPacks: z.number().int().nonnegative().nullable(),
  delivery: MoneySchema.nullable(),
  leadDays: z.number().int().nonnegative().max(3650).nullable(),
  paymentTerms: z.string().trim().min(1).max(1000).nullable(),
  discountRatePercent: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).nullable(),
  taxRatePercent: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).nullable(),
  validThrough: CalendarDateSchema.nullable(),
  fxRateToTarget: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).nullable(),
  sourceRefs: z.array(SourceRefSchema).max(20).default([]),
});

export const ProcurementComparisonInputSchema = z.strictObject({
  currency: CurrencySchema,
  asOf: CalendarDateSchema,
  deliveryDestination: z.string().trim().min(1).max(1000).nullable(),
  needs: z.array(ProcurementNeedLineSchema).min(1).max(10_000),
  stock: z.array(StockLineSchema).max(100_000),
  offers: z.array(SupplierOfferSchema).min(1).max(100_000),
}).superRefine((value, context) => {
  if (new Set(value.needs.map((line) => line.id)).size !== value.needs.length) context.addIssue({ code: 'custom', path: ['needs'], message: 'procurement.errors.duplicateNeed' });
  if (new Set(value.offers.map((offer) => offer.id)).size !== value.offers.length) context.addIssue({ code: 'custom', path: ['offers'], message: 'procurement.errors.duplicateOffer' });
});

export const ProcurementCandidateSchema = z.strictObject({
  offerId: ElementIdSchema,
  needId: ElementIdSchema,
  supplierId: z.string(),
  supplierName: z.string(),
  itemKey: z.string(),
  unit: z.string(),
  netRequired: z.string().regex(/^\d+(?:\.\d+)?$/),
  packs: z.number().int().nonnegative().nullable(),
  deliveredQuantity: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
  knownTotalMinorUnits: z.string().regex(/^\d+$/).nullable(),
  currency: CurrencySchema,
  leadDays: z.number().int().nonnegative().nullable(),
  arrivesOn: CalendarDateSchema.nullable(),
  paymentTerms: z.string().nullable(),
  complete: z.boolean(),
  eligible: z.boolean(),
  missing: z.array(z.enum(['unit', 'pack-size', 'pack-price', 'minimum-packs', 'delivery', 'lead-time', 'payment-terms', 'discount', 'tax', 'fx-rate', 'delivery-destination', 'expired'])),
  sourceRefs: z.array(SourceRefSchema).max(40),
});

export const DraftOrderLineSchema = z.strictObject({
  needId: ElementIdSchema,
  offerId: ElementIdSchema,
  itemKey: z.string(),
  description: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  packs: z.number().int().nonnegative(),
  deliveredQuantity: QuantitySchema,
  knownTotal: MoneySchema,
  requiredBy: CalendarDateSchema.nullable(),
  arrivesOn: CalendarDateSchema,
  paymentTerms: z.string(),
  sourceRefs: z.array(SourceRefSchema).max(60),
});

export const ProcurementComparisonResultSchema = z.strictObject({
  currency: CurrencySchema,
  candidates: z.array(ProcurementCandidateSchema),
  recommendedOfferIds: z.array(ElementIdSchema),
  draftOrder: z.strictObject({
    status: z.enum(['ready', 'partial', 'blocked']),
    destination: z.string().nullable(),
    lines: z.array(DraftOrderLineSchema),
    unresolvedNeedIds: z.array(ElementIdSchema),
    externalAction: z.literal('none'),
  }),
});

export type ProcurementComparisonInput = z.infer<typeof ProcurementComparisonInputSchema>;
export type ProcurementComparisonResult = z.infer<typeof ProcurementComparisonResultSchema>;
export type SupplierOffer = z.infer<typeof SupplierOfferSchema>;
export type StockLine = z.infer<typeof StockLineSchema>;

