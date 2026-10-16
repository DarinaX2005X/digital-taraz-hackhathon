import { z } from 'zod';

import {
  CalendarDateSchema,
  CurrencySchema,
  ElementIdSchema,
  IdSchema,
  MoneySchema,
  QuantitySchema,
  RevisionSchema,
} from './primitives';

const UnsignedDecimalSchema = z.string().max(80).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const SignedDecimalSchema = z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const SignedIntegerSchema = z.string().max(80).regex(/^-?(?:0|[1-9]\d*)$/);
const CountSchema = z.number().int().nonnegative().max(1_000_000);

export const WorkPreviewArtifactRefSchema = z.strictObject({
  artifactId: IdSchema,
  revision: RevisionSchema,
});

export const WorkPreviewForecastMetricSchema = z.strictObject({
  mae: UnsignedDecimalSchema,
  wape: UnsignedDecimalSchema.nullable(),
});

const FinanceWorkPreviewSchema = z.strictObject({
  kind: z.literal('finance'),
  editable: WorkPreviewArtifactRefSchema,
  currency: CurrencySchema,
  period: z.strictObject({ start: CalendarDateSchema, end: CalendarDateSchema }),
  scenarios: z.array(z.strictObject({
    id: ElementIdSchema,
    title: z.string().trim().min(1).max(240),
    accounting: z.enum(['cash', 'accrual']),
    knownIncomeMinorUnits: UnsignedDecimalSchema,
    knownExpenseMinorUnits: UnsignedDecimalSchema,
    knownResultMinorUnits: SignedIntegerSchema,
    closingBalanceMinorUnits: SignedIntegerSchema.nullable(),
    minimumBalanceMinorUnits: SignedIntegerSchema.nullable(),
    unknownCount: CountSchema,
  })).max(12),
  assumptions: z.array(z.strictObject({
    scenarioId: ElementIdSchema,
    id: ElementIdSchema,
    title: z.string().trim().min(1).max(160),
    effectiveOn: CalendarDateSchema,
    direction: z.enum(['inflow', 'outflow']),
    amountMinorUnits: UnsignedDecimalSchema.nullable(),
    confirmed: z.boolean(),
  })).max(12),
  assumptionCount: CountSchema,
  calendar: z.array(z.strictObject({
    scenarioId: ElementIdSchema,
    date: CalendarDateSchema,
    knownInflowsMinorUnits: UnsignedDecimalSchema,
    knownOutflowsMinorUnits: UnsignedDecimalSchema,
    closingBalanceMinorUnits: SignedIntegerSchema.nullable(),
    unknownCount: CountSchema,
  })).max(24),
  calendarRowCount: CountSchema,
});

const ForecastWorkPreviewSchema = z.strictObject({
  kind: z.literal('forecast'),
  editable: WorkPreviewArtifactRefSchema,
  target: ElementIdSchema,
  aggregation: z.enum(['daily', 'weekly', 'monthly']),
  coverage: z.strictObject({
    start: CalendarDateSchema,
    end: CalendarDateSchema,
    observations: CountSchema,
    regular: z.boolean(),
  }),
  eligibility: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('eligible'), reasons: z.array(z.string().max(500)).max(20) }),
    z.strictObject({ state: z.literal('insufficient'), reasons: z.array(z.string().min(1).max(500)).min(1).max(20) }),
  ]),
  modelFamily: z.enum(['arima', 'sarima', 'last-value', 'seasonal-naive']),
  backtestMetrics: WorkPreviewForecastMetricSchema.nullable(),
  baseline: z.strictObject({ family: z.enum(['last-value', 'seasonal-naive']), metrics: WorkPreviewForecastMetricSchema.nullable() }),
  interval: z.strictObject({ method: z.enum(['residual-quantile', 'none']), level: z.number().min(0).max(1), empiricalCoverage: z.number().min(0).max(1).nullable() }),
  points: z.array(z.strictObject({ date: CalendarDateSchema, value: SignedDecimalSchema, lower: SignedDecimalSchema, upper: SignedDecimalSchema })).max(36),
  pointCount: CountSchema,
  folds: z.array(z.strictObject({ trainEnd: CalendarDateSchema, testStart: CalendarDateSchema, testEnd: CalendarDateSchema, metrics: WorkPreviewForecastMetricSchema })).max(8),
  foldCount: CountSchema,
});

const ProcurementWorkPreviewSchema = z.strictObject({
  kind: z.literal('procurement'),
  editable: WorkPreviewArtifactRefSchema,
  currency: CurrencySchema,
  candidateCount: CountSchema,
  candidates: z.array(z.strictObject({
    offerId: ElementIdSchema,
    needId: ElementIdSchema,
    supplierName: z.string().trim().min(1).max(240),
    netRequired: UnsignedDecimalSchema,
    unit: z.string().trim().min(1).max(40),
    packs: z.number().int().nonnegative().nullable(),
    knownTotalMinorUnits: UnsignedDecimalSchema.nullable(),
    leadDays: z.number().int().nonnegative().max(3650).nullable(),
    arrivesOn: CalendarDateSchema.nullable(),
    paymentTerms: z.string().trim().max(240).nullable(),
    complete: z.boolean(),
    eligible: z.boolean(),
    missing: z.array(z.enum(['unit', 'pack-size', 'pack-price', 'minimum-packs', 'delivery', 'lead-time', 'payment-terms', 'discount', 'tax', 'fx-rate', 'delivery-destination', 'expired'])).max(20),
  })).max(12),
  draftOrder: z.strictObject({
    status: z.enum(['ready', 'partial', 'blocked']),
    destination: z.string().trim().max(1000).nullable(),
    lineCount: CountSchema,
    lines: z.array(z.strictObject({
      needId: ElementIdSchema,
      offerId: ElementIdSchema,
      description: z.string().trim().min(1).max(500),
      supplierName: z.string().trim().min(1).max(240),
      packs: z.number().int().nonnegative(),
      deliveredQuantity: QuantitySchema,
      knownTotal: MoneySchema,
      arrivesOn: CalendarDateSchema,
      paymentTerms: z.string().trim().min(1).max(240),
    })).max(12),
    unresolvedNeedIds: z.array(ElementIdSchema).max(20),
    unresolvedCount: CountSchema,
    externalAction: z.literal('none'),
  }),
});

export const BusinessWorkPreviewSchema = z.discriminatedUnion('kind', [
  FinanceWorkPreviewSchema,
  ForecastWorkPreviewSchema,
  ProcurementWorkPreviewSchema,
]).superRefine((preview, context) => {
  if (new TextEncoder().encode(JSON.stringify(preview)).byteLength > 18_000) {
    context.addIssue({ code: 'custom', message: 'Business work preview exceeds its durable projection limit.' });
  }
});

export type WorkPreviewArtifactRef = z.infer<typeof WorkPreviewArtifactRefSchema>;
export type BusinessWorkPreview = z.infer<typeof BusinessWorkPreviewSchema>;
