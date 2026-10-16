import { z } from 'zod';
import { SourceRefSchema } from '@/contracts/artifacts';
import { ArtifactSnapshotRefSchema, BusinessWorkResultSchema } from '@/contracts/business-work';
import { CalendarDateSchema, CurrencySchema, ElementIdSchema, IdSchema, MoneySchema } from '@/contracts/primitives';
import { WorkPreviewArtifactRefSchema } from '@/contracts/work-preview';

export const FinanceTransactionKindSchema = z.enum([
  'sale', 'return', 'cost', 'tax', 'receivable', 'payable', 'payment-in', 'payment-out',
]);

export const FinanceTransactionSchema = z.strictObject({
  id: ElementIdSchema,
  kind: FinanceTransactionKindSchema,
  occurredOn: CalendarDateSchema,
  cashDate: CalendarDateSchema.nullable(),
  amount: MoneySchema.nullable(),
  status: z.enum(['observed', 'assumed']).default('observed'),
  sourceRefs: z.array(SourceRefSchema).max(20).default([]),
  note: z.string().trim().max(1000).default(''),
});

export const FinanceAssumptionSchema = z.strictObject({
  id: ElementIdSchema,
  title: z.string().trim().min(1).max(240),
  effectiveOn: CalendarDateSchema,
  direction: z.enum(['inflow', 'outflow']),
  amount: MoneySchema.nullable(),
  confirmed: z.boolean(),
  sourceRef: SourceRefSchema.optional(),
});

export const FinanceScenarioInputSchema = z.strictObject({
  id: ElementIdSchema,
  title: z.string().trim().min(1).max(240),
  assumptions: z.array(FinanceAssumptionSchema).max(500),
});

export const FinanceAnalysisInputSchema = z.strictObject({
  currency: CurrencySchema,
  accounting: z.enum(['cash', 'accrual']),
  openingBalance: MoneySchema.nullable(),
  period: z.strictObject({ start: CalendarDateSchema, end: CalendarDateSchema }),
  transactions: z.array(FinanceTransactionSchema).max(100_000),
  scenarios: z.array(FinanceScenarioInputSchema).min(1).max(12),
  excludedTransactionIds: z.array(ElementIdSchema).max(10_000).default([]),
}).superRefine((value, context) => {
  if (value.period.end < value.period.start) context.addIssue({ code: 'custom', path: ['period', 'end'], message: 'finance.errors.period' });
  if (value.openingBalance && value.openingBalance.currency !== value.currency) context.addIssue({ code: 'custom', path: ['openingBalance'], message: 'finance.errors.currency' });
  if (new Set(value.transactions.map((item) => item.id)).size !== value.transactions.length) context.addIssue({ code: 'custom', path: ['transactions'], message: 'finance.errors.duplicateTransaction' });
  if (new Set(value.scenarios.map((item) => item.id)).size !== value.scenarios.length) context.addIssue({ code: 'custom', path: ['scenarios'], message: 'finance.errors.duplicateScenario' });
});

export const FinanceCoverageIssueSchema = z.strictObject({
  code: z.enum(['amount-unknown', 'cash-date-unknown', 'currency-mismatch', 'outside-period', 'excluded']),
  transactionId: ElementIdSchema,
  sourceRefs: z.array(SourceRefSchema).max(20),
});

export const CashCalendarRowSchema = z.strictObject({
  date: CalendarDateSchema,
  knownInflowsMinorUnits: z.string().regex(/^\d+$/),
  knownOutflowsMinorUnits: z.string().regex(/^\d+$/),
  netKnownMinorUnits: z.string().regex(/^-?\d+$/),
  closingBalanceMinorUnits: z.string().regex(/^-?\d+$/).nullable(),
  unknownItemIds: z.array(ElementIdSchema),
  sourceRefs: z.array(SourceRefSchema).max(1000),
});

export const FinanceScenarioResultSchema = z.strictObject({
  id: ElementIdSchema,
  title: z.string(),
  accounting: z.enum(['cash', 'accrual']),
  knownIncomeMinorUnits: z.string().regex(/^\d+$/),
  knownExpenseMinorUnits: z.string().regex(/^\d+$/),
  knownResultMinorUnits: z.string().regex(/^-?\d+$/),
  closingBalanceMinorUnits: z.string().regex(/^-?\d+$/).nullable(),
  minimumBalanceMinorUnits: z.string().regex(/^-?\d+$/).nullable(),
  unknownItemIds: z.array(ElementIdSchema),
  calendar: z.array(CashCalendarRowSchema),
});

export const FinanceAnalysisResultSchema = z.strictObject({
  currency: CurrencySchema,
  period: z.strictObject({ start: CalendarDateSchema, end: CalendarDateSchema }),
  coverage: z.strictObject({
    acceptedTransactions: z.number().int().nonnegative(),
    excludedTransactions: z.number().int().nonnegative(),
    issues: z.array(FinanceCoverageIssueSchema),
  }),
  scenarios: z.array(FinanceScenarioResultSchema).min(1),
});

export const FinanceAssumptionEditSchema = z.strictObject({
  assumptionId: ElementIdSchema,
  title: z.string().trim().min(1).max(240).optional(),
  effectiveOn: CalendarDateSchema.optional(),
  direction: z.enum(['inflow', 'outflow']).optional(),
  amount: MoneySchema.nullable().optional(),
  confirmed: z.boolean().optional(),
}).refine((edit) => edit.title !== undefined || edit.effectiveOn !== undefined || edit.direction !== undefined || edit.amount !== undefined || edit.confirmed !== undefined, {
  message: 'An assumption edit must change at least one field.',
});

export const FinanceScenarioEditSchema = z.strictObject({
  scenarioId: ElementIdSchema,
  title: z.string().trim().min(1).max(240).optional(),
  assumptions: z.array(FinanceAssumptionEditSchema).max(200).default([]),
}).refine((edit) => edit.title !== undefined || edit.assumptions.length > 0, {
  message: 'A scenario edit must change its title or an assumption.',
});

export const FinanceRecalculateRequestSchema = z.strictObject({
  workspaceId: IdSchema,
  projectId: IdSchema,
  base: ArtifactSnapshotRefSchema,
  branchTitle: z.string().trim().min(1).max(240),
  scenarios: z.array(FinanceScenarioEditSchema).max(12).default([]),
}).superRefine((input, context) => {
  if (new Set(input.scenarios.map((scenario) => scenario.scenarioId)).size !== input.scenarios.length) {
    context.addIssue({ code: 'custom', path: ['scenarios'], message: 'Finance scenario edits must be unique.' });
  }
  for (const [index, scenario] of input.scenarios.entries()) {
    if (new Set(scenario.assumptions.map((assumption) => assumption.assumptionId)).size !== scenario.assumptions.length) {
      context.addIssue({ code: 'custom', path: ['scenarios', index, 'assumptions'], message: 'Finance assumption edits must be unique within a scenario.' });
    }
  }
});

export const FinanceRecalculateResultSchema = z.strictObject({
  work: BusinessWorkResultSchema,
  comparison: z.strictObject({
    base: WorkPreviewArtifactRefSchema,
    branch: WorkPreviewArtifactRefSchema,
  }),
});

export type FinanceTransaction = z.infer<typeof FinanceTransactionSchema>;
export type FinanceAssumption = z.infer<typeof FinanceAssumptionSchema>;
export type FinanceAnalysisInput = z.infer<typeof FinanceAnalysisInputSchema>;
export type FinanceAnalysisResult = z.infer<typeof FinanceAnalysisResultSchema>;
export type FinanceRecalculateRequest = z.infer<typeof FinanceRecalculateRequestSchema>;
export type FinanceRecalculateResult = z.infer<typeof FinanceRecalculateResultSchema>;

