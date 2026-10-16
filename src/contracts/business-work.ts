import { z } from 'zod';
import { ArtifactMutationResultSchema } from '../features/artifacts/contracts';
import { SourceRefSchema } from './artifacts';
import { CalculationSpecSchema } from './calculations';
import { RevisionVectorSchema } from './commands';
import { DatasetQuerySchema } from './materials';
import {
  CalendarDateSchema,
  CurrencySchema,
  ElementIdSchema,
  IdSchema,
  InstantSchema,
  LocaleSchema,
  MoneySchema,
  QuantitySchema,
  RevisionSchema,
} from './primitives';
import { RunInputRefSchema } from './runs';
import { ProposeWorkPlanInputSchema } from '../features/operations/domain/propose-work-plan';
import { BusinessWorkPreviewSchema } from './work-preview';

export { BusinessWorkPreviewSchema, WorkPreviewArtifactRefSchema } from './work-preview';
export type { BusinessWorkPreview, WorkPreviewArtifactRef } from './work-preview';

/** A selected immutable artifact version. Content is read through the artifact ACL. */
export const ArtifactSnapshotRefSchema = z.strictObject({
  artifactId: IdSchema,
  revision: RevisionSchema,
});

export const WorkExecutionAuthoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: IdSchema }),
  z.strictObject({ kind: z.literal('demo'), sessionId: IdSchema, userId: IdSchema, expiresAt: InstantSchema }),
]);

/**
 * Trusted execution context assembled by the server. Model/tool arguments never
 * get to choose ownership, allowed inputs, authorization versions, or epochs.
 */
export const WorkExecutionContextSchema = z.strictObject({
  authority: WorkExecutionAuthoritySchema,
  operationId: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  allowedInputRefs: z.array(RunInputRefSchema).max(100),
  inputRevisionVector: RevisionVectorSchema,
  cancelEpoch: z.number().int().nonnegative(),
  locale: LocaleSchema,
});

const WorkFindingSchema = z.strictObject({
  code: z.string().min(1).max(120).regex(/^[a-z][a-z0-9_.-]*$/),
  targetIds: z.array(ElementIdSchema).max(1000),
  sourceRefs: z.array(SourceRefSchema).max(1000),
});

const WorkDecisionIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);

export const BusinessWorkDecisionSchema = z.strictObject({
  id: WorkDecisionIdSchema,
  options: z.array(z.strictObject({ id: WorkDecisionIdSchema, label: z.string().trim().min(1).max(240), artifactIds: z.array(IdSchema).max(40) })).min(1).max(20),
  requiresConsent: z.boolean(),
});

export const BusinessWorkResultSchema = z.strictObject({
  artifacts: z.array(ArtifactMutationResultSchema).max(40),
  inputRevisionVector: RevisionVectorSchema,
  checks: z.array(WorkFindingSchema.extend({ status: z.enum(['passed', 'failed', 'unknown']) })).max(200),
  unresolved: z.array(WorkFindingSchema).max(200),
  decision: BusinessWorkDecisionSchema.optional(),
  workPreview: BusinessWorkPreviewSchema.optional(),
  summary: z.string().max(3000),
}).superRefine((result, context) => {
  const artifactIds = new Set(result.artifacts.map((item) => item.artifact.id));
  if (artifactIds.size !== result.artifacts.length) context.addIssue({ code: 'custom', message: 'Business work artifacts must be unique.' });
  if (result.decision?.options.some((option) => option.artifactIds.some((id) => !artifactIds.has(id)))) context.addIssue({ code: 'custom', message: 'Decision options may reference only returned artifacts.' });
  if (result.workPreview && !artifactIds.has(result.workPreview.editable.artifactId)) context.addIssue({ code: 'custom', message: 'A work preview must reference an artifact returned by the same operation.' });
});

/** Existing canonical material query, named as the cross-domain K7 contract. */
export const DatasetQuerySpecSchema = DatasetQuerySchema;

export const FinanceAssumptionVariableSchema = z.strictObject({
  id: ElementIdSchema,
  value: z.union([MoneySchema, QuantitySchema, CalendarDateSchema]).nullable(),
  sourceRef: SourceRefSchema.optional(),
  confirmed: z.boolean(),
});
export const BuildFinanceWorkInputSchema = z.strictObject({
  sourceRefs: z.array(SourceRefSchema).max(1000),
  query: DatasetQuerySpecSchema,
  currency: CurrencySchema,
  accounting: z.enum(['cash', 'accrual']),
  openingBalance: MoneySchema.nullable(),
  period: z.strictObject({ start: CalendarDateSchema, end: CalendarDateSchema }).refine((period) => period.start <= period.end),
  assumptionSets: z.array(z.strictObject({
    id: ElementIdSchema,
    title: z.string().trim().min(1).max(240),
    variables: z.array(FinanceAssumptionVariableSchema).max(200),
    calculation: CalculationSpecSchema,
  })).min(1).max(20),
});

export const ForecastInputSchema = z.strictObject({
  seriesRef: SourceRefSchema,
  target: ElementIdSchema,
  dateColumn: ElementIdSchema,
  valueColumn: ElementIdSchema,
  aggregation: z.enum(['daily', 'weekly', 'monthly']),
  horizon: z.number().int().min(1).max(730),
  calendar: z.strictObject({ timezone: z.string().min(1).max(80), frequency: z.enum(['daily', 'weekly', 'monthly']) }),
  exclusions: z.array(z.strictObject({ date: CalendarDateSchema, reason: z.string().trim().min(1).max(500) })).max(1000),
  coverage: z.strictObject({ start: CalendarDateSchema, end: CalendarDateSchema, observations: z.number().int().nonnegative(), regular: z.boolean() }),
}).superRefine((input, context) => {
  if (input.coverage.start > input.coverage.end) context.addIssue({ code: 'custom', message: 'Forecast coverage must be ordered.' });
  if (input.aggregation !== input.calendar.frequency) context.addIssue({ code: 'custom', message: 'Forecast aggregation and calendar frequency must agree.' });
});

const ForecastMetricSchema = z.strictObject({ mae: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/), wape: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).nullable() });
export const ForecastRunSchema = z.strictObject({
  id: IdSchema,
  eligibility: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('eligible'), reasons: z.array(z.string().max(500)).max(20) }),
    z.strictObject({ state: z.literal('insufficient'), reasons: z.array(z.string().min(1).max(500)).min(1).max(20) }),
  ]),
  model: z.strictObject({ family: z.enum(['arima', 'sarima', 'last-value', 'seasonal-naive']), parameters: z.record(z.string().max(80), z.union([z.string().max(200), z.number().finite(), z.boolean()])) }),
  trainRange: z.strictObject({ start: CalendarDateSchema, end: CalendarDateSchema }),
  backtest: z.strictObject({
    folds: z.array(z.strictObject({ trainEnd: CalendarDateSchema, testStart: CalendarDateSchema, testEnd: CalendarDateSchema, metrics: ForecastMetricSchema })).max(30),
    metrics: ForecastMetricSchema.nullable(),
  }),
  points: z.array(z.strictObject({ date: CalendarDateSchema, value: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/) })).max(730),
  ranges: z.array(z.strictObject({ date: CalendarDateSchema, lower: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/), upper: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/) })).max(730),
  interval: z.strictObject({ method: z.enum(['residual-quantile', 'none']), level: z.number().min(0).max(1), empiricalCoverage: z.number().min(0).max(1).nullable() }),
  baseline: z.strictObject({ family: z.enum(['last-value', 'seasonal-naive']), metrics: ForecastMetricSchema.nullable() }),
  sourceRevisions: RevisionVectorSchema,
}).superRefine((run, context) => {
  if (run.trainRange.start > run.trainRange.end) context.addIssue({ code: 'custom', message: 'Forecast train range must be ordered.' });
  if (run.eligibility.state === 'eligible' && run.backtest.folds.length < 2) context.addIssue({ code: 'custom', message: 'Eligible forecasts require at least two backtest folds.' });
  if (run.eligibility.state === 'eligible' && (run.backtest.metrics === null || run.baseline.metrics === null)) context.addIssue({ code: 'custom', message: 'Eligible forecasts require measured model and baseline metrics.' });
  if (run.points.length !== run.ranges.length || run.points.some((point, index) => point.date !== run.ranges[index]?.date)) context.addIssue({ code: 'custom', message: 'Forecast points and ranges must align.' });
});

export const ProcurementNeedLineSchema = z.strictObject({
  id: ElementIdSchema,
  itemKey: z.string().trim().min(1).max(500),
  quantity: QuantitySchema,
  requiredBy: CalendarDateSchema.nullable(),
  sourceRefs: z.array(SourceRefSchema).max(100),
});
export const BuildProcurementWorkInputSchema = z.strictObject({
  needLines: z.array(ProcurementNeedLineSchema).min(1).max(1000),
  offerSourceRefs: z.array(SourceRefSchema).max(1000),
  stockSourceRefs: z.array(SourceRefSchema).max(1000),
  currency: CurrencySchema,
  deliveryDestination: z.string().trim().min(1).max(1000).nullable(),
});

const CampaignConditionSchema = z.strictObject({
  id: ElementIdSchema,
  kind: z.enum(['price', 'date', 'quantity', 'text']),
  value: z.union([MoneySchema, QuantitySchema, CalendarDateSchema, z.string().max(4000)]),
  sourceRef: SourceRefSchema,
});

const CampaignFormatSchema = z.strictObject({
  id: ElementIdSchema,
  width: z.number().positive().max(100_000),
  height: z.number().positive().max(100_000),
  unit: z.enum(['px', 'mm']),
  locale: LocaleSchema,
});

export const BuildCampaignWorkInputSchema = z.strictObject({
  brief: z.string().trim().min(1).max(12_000),
  sourceRefs: z.array(SourceRefSchema).max(1_000),
  assetRefs: z.array(IdSchema).max(200),
  brandRef: z.strictObject({
    contextId: IdSchema,
    revision: RevisionSchema,
    itemIds: z.array(ElementIdSchema).max(200),
  }).nullable(),
  conditions: z.array(CampaignConditionSchema).max(200),
  formats: z.array(CampaignFormatSchema).min(1).max(20),
  budgetRef: ArtifactSnapshotRefSchema.nullable(),
  planInput: ProposeWorkPlanInputSchema.nullable(),
}).superRefine((input, context) => {
  const reportDuplicate = (values: readonly string[], path: string, message: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [path], message });
  };
  reportDuplicate(input.assetRefs, 'assetRefs', 'Campaign asset references must be unique.');
  reportDuplicate(input.conditions.map((condition) => condition.id), 'conditions', 'Campaign condition ids must be unique.');
  reportDuplicate(input.formats.map((format) => format.id), 'formats', 'Campaign format ids must be unique.');

  const sourceRefKey = (ref: z.infer<typeof SourceRefSchema>) => [
    ref.sourceId, ref.sourceVersionId, ref.revision, ref.fragmentId ?? '', ref.collectionId ?? '',
    ref.recordId ?? '', ref.fieldId ?? '', ref.factRevision ?? '',
  ].join(':');
  const allowedSourceRefs = new Set(input.sourceRefs.map(sourceRefKey));
  for (const [index, condition] of input.conditions.entries()) {
    const isMoney = typeof condition.value === 'object' && condition.value !== null && 'currency' in condition.value && 'minorUnits' in condition.value;
    const isQuantity = typeof condition.value === 'object' && condition.value !== null && 'decimal' in condition.value && 'unit' in condition.value;
    const isDate = typeof condition.value === 'string' && CalendarDateSchema.safeParse(condition.value).success;
    const validKind = condition.kind === 'price' ? isMoney
      : condition.kind === 'quantity' ? isQuantity
        : condition.kind === 'date' ? isDate
          : typeof condition.value === 'string';
    if (!validKind) context.addIssue({ code: 'custom', path: ['conditions', index, 'value'], message: `Campaign ${condition.kind} condition has an incompatible value.` });
    if (!allowedSourceRefs.has(sourceRefKey(condition.sourceRef))) context.addIssue({ code: 'custom', path: ['conditions', index, 'sourceRef'], message: 'Campaign condition source must be included in sourceRefs.' });
  }
});

export interface BusinessWorkToolDescriptor<Input, Result extends BusinessWorkResult = BusinessWorkResult> {
  readonly name: string;
  readonly version: 1;
  readonly purpose: string;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType<Result>;
  readonly policy: 'read' | 'edit';
  readonly costClass: 'local' | 'model' | 'image';
  readonly deadlineMs: number;
  readonly idempotency: 'operation-receipt';
  execute(input: Input, context: WorkExecutionContext): Promise<Result>;
}

export type ArtifactSnapshotRef = z.infer<typeof ArtifactSnapshotRefSchema>;
export type WorkExecutionAuthority = z.infer<typeof WorkExecutionAuthoritySchema>;
export type WorkExecutionContext = z.infer<typeof WorkExecutionContextSchema>;
export type BusinessWorkResult = z.infer<typeof BusinessWorkResultSchema>;
export type BusinessWorkDecision = z.infer<typeof BusinessWorkDecisionSchema>;
export type DatasetQuerySpec = z.infer<typeof DatasetQuerySpecSchema>;
export type BuildFinanceWorkInput = z.infer<typeof BuildFinanceWorkInputSchema>;
export type ForecastInput = z.infer<typeof ForecastInputSchema>;
export type ForecastRun = z.infer<typeof ForecastRunSchema>;
export type BuildProcurementWorkInput = z.infer<typeof BuildProcurementWorkInputSchema>;
export type BuildCampaignWorkInput = z.infer<typeof BuildCampaignWorkInputSchema>;
export type LocalDate = z.infer<typeof CalendarDateSchema>;

