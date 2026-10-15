import { z } from 'zod';
import { SourceRefSchema } from './artifacts';
import { PermissionSchema } from './capabilities';
import { CalendarDateSchema, HashSchema, IdSchema, InstantSchema, LocaleSchema, RevisionSchema } from './primitives';

export const RunStateSchema = z.enum(['queued', 'running', 'waiting_input', 'review_ready', 'completed', 'failed', 'cancelled']);
export const RunStepStateSchema = z.enum(['planned', 'claimed', 'succeeded', 'failed', 'skipped']);
export const RunUsageStateSchema = z.enum(['reserved', 'dispatched', 'succeeded', 'released', 'ambiguous']);
export const RunActionSchema = z.enum(['read_sources', 'extract_text', 'calculate', 'prepare_document', 'prepare_design', 'validate', 'save', 'export', 'continue', 'process']);
export const RunFailureSchema = z.enum([
  'unavailable', 'configuration', 'provider', 'provider_timeout', 'ambiguous_charge', 'invalid_result',
  'price_unknown', 'price_expired', 'price_exceeded', 'model_expired', 'model_unproven', 'model_forbidden', 'unsupported_parameters',
  'run_budget', 'workspace_budget', 'deployment_budget', 'authorization_budget', 'request_limit', 'step_limit', 'branch_limit', 'continuation_limit',
  'run_deadline', 'step_deadline', 'lease_lost', 'access_changed', 'cancelled', 'conflict',
]);
// USD values keep sub-token prices exact and are never transported as floating point.
export const UsdSchema = z.string().max(30).regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/);
export const RunCursorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CapabilityIdSchema = z.string().max(100).regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
export const ToolNameSchema = z.string().max(100).regex(/^[a-z][a-z0-9_.-]*$/);
export const ToolCallIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

export const RunResultRefSchema = z.strictObject({
  kind: z.enum(['artifact', 'source', 'export']), id: IdSchema, revision: RevisionSchema.optional(),
});
export const RunInputRefSchema = z.strictObject({
  kind: z.enum(['artifact', 'source']), id: IdSchema, revision: RevisionSchema,
});
export const CreateRunSchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema.nullable(), capabilityId: CapabilityIdSchema,
  capabilityVersion: z.number().int().positive().max(10000), goal: z.string().trim().min(1).max(12000),
  locale: LocaleSchema, inputRefs: z.array(RunInputRefSchema).max(100),
});
export const ResumeRunSchema = z.strictObject({
  expectedEpoch: z.number().int().nonnegative(), stepId: IdSchema.optional(),
  answers: z.array(z.strictObject({ questionId: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/), answer: z.string().trim().min(1).max(4000) })).max(10).optional(),
  goal: z.string().trim().min(1).max(12000).optional(),
  plan: z.array(z.string().trim().min(1).max(500)).min(1).max(10).optional(),
  selectedOptionId: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/).optional(),
  acceptedConditionIds: z.array(z.string().regex(/^accept_conditions_[a-z0-9_-]{1,32}$/)).max(20).optional(),
}).superRefine((value, context) => {
  if (value.acceptedConditionIds && new Set(value.acceptedConditionIds).size !== value.acceptedConditionIds.length) context.addIssue({ code: 'custom', message: 'Accepted condition IDs must be unique.' });
});
export const CancelRunSchema = z.strictObject({ expectedEpoch: z.number().int().nonnegative() });
export const RunQuestionSchema = z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/), text: z.string().min(1).max(1000), required: z.boolean() });
const DecisionIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);
const DecisionDecimalSchema = z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const RunDecisionFactorSchema = z.strictObject({
  code: DecisionIdSchema,
  kind: z.enum(['reason', 'condition']),
  messageKey: z.string().min(1).max(160).regex(/^[a-z][A-Za-z0-9_.-]*$/),
  args: z.record(z.string().min(1).max(80), z.string().max(1500)).superRefine((value, context) => {
    if (Object.keys(value).length > 20) context.addIssue({ code: 'custom', message: 'At most 20 public decision arguments are allowed.' });
  }),
  sourceRefs: z.array(SourceRefSchema).max(100),
});
export const RunCapacityEvidenceSchema = z.discriminatedUnion('origin', [
  z.strictObject({ origin: z.literal('source'), resourceId: IdSchema, availabilityVersionId: IdSchema, verifiedAt: InstantSchema, sourceRefs: z.array(SourceRefSchema).min(1).max(100) }),
  z.strictObject({ origin: z.literal('manual'), resourceId: IdSchema, availabilityVersionId: IdSchema, verifiedAt: InstantSchema.nullable(), sourceRefs: z.array(SourceRefSchema).length(0) }),
  z.strictObject({ origin: z.literal('missing'), resourceId: IdSchema, availabilityVersionId: z.null(), verifiedAt: z.null(), sourceRefs: z.array(SourceRefSchema).length(0) }),
]);
export const RunDecisionOptionSchema = z.strictObject({
  id: DecisionIdSchema,
  title: z.string().min(1).max(240),
  outcome: z.enum(['feasible', 'conditional', 'not_confirmed']),
  sourceRefs: z.array(SourceRefSchema).min(1).max(100),
  commercial: z.strictObject({
    currency: z.string().regex(/^[A-Z]{3}$/),
    quotedTotal: DecisionDecimalSchema.nullable(),
    directCost: DecisionDecimalSchema.nullable(),
    contribution: DecisionDecimalSchema.nullable(),
    contributionRate: DecisionDecimalSchema.nullable(),
  }),
  deadline: z.strictObject({ requestedDate: CalendarDateSchema, openingDate: CalendarDateSchema.nullable(), earliestCompletionDate: CalendarDateSchema.nullable() }),
  capacity: z.array(z.strictObject({
    scope: z.string().min(1).max(500),
    requiredMinutes: z.number().int().nonnegative().max(10_000_000).nullable(),
    availableMinutes: z.number().int().nonnegative().max(10_000_000).nullable(),
    evidence: RunCapacityEvidenceSchema,
  })).max(100),
  factors: z.array(RunDecisionFactorSchema).max(100),
});
export const RunDecisionSchema = z.strictObject({
  outcome: z.enum(['feasible', 'conditional', 'not_confirmed']),
  selectedOptionId: DecisionIdSchema.nullable(),
  options: z.array(RunDecisionOptionSchema).min(2).max(5),
  differences: z.array(z.strictObject({
    leftOptionId: DecisionIdSchema,
    rightOptionId: DecisionIdSchema,
    dimensions: z.array(z.enum(['price', 'scope', 'deadline', 'capacity', 'conditions'])).min(1).max(5),
  })).max(10),
}).superRefine((value, context) => {
  const ids = new Set(value.options.map((option) => option.id));
  if (ids.size !== value.options.length) context.addIssue({ code: 'custom', message: 'Decision option IDs must be unique.' });
  if (value.selectedOptionId !== null && !ids.has(value.selectedOptionId)) context.addIssue({ code: 'custom', message: 'The selected decision option must exist.' });
  for (const difference of value.differences) if (!ids.has(difference.leftOptionId) || !ids.has(difference.rightOptionId) || difference.leftOptionId === difference.rightOptionId) context.addIssue({ code: 'custom', message: 'Decision differences must reference distinct options.' });
});
export const RunBranchStateSchema = z.enum(['planned', 'running', 'waiting_input', 'review_ready', 'completed', 'failed', 'cancelled']);
export const RunBranchProjectionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/),
  title: z.string().min(1).max(240),
  purposeKey: z.string().min(1).max(160).regex(/^[a-z][A-Za-z0-9_.-]*$/),
  state: RunBranchStateSchema,
  parentStepId: IdSchema.nullable(),
  resultRefs: z.array(RunResultRefSchema).max(40),
});
export const RunProgressProjectionSchema = z.strictObject({
  plan: z.array(z.string().min(1).max(500)).max(10), questions: z.array(RunQuestionSchema).max(10), summary: z.string().max(3000),
  results: z.array(RunResultRefSchema.extend({ title: z.string().max(240) })).max(40),
  decision: RunDecisionSchema.nullable().optional(),
  branches: z.array(RunBranchProjectionSchema).max(8).optional(),
});
export const RunProgressSchema = RunProgressProjectionSchema.extend({
  parentRunId: IdSchema.nullable(), continuationRunId: IdSchema.nullable(),
});

export const RunStepSchema = z.strictObject({
  id: IdSchema, runId: IdSchema, ordinal: z.number().int().min(1).max(40), action: RunActionSchema,
  state: RunStepStateSchema, toolName: ToolNameSchema, toolVersion: z.number().int().positive(),
  attempt: z.number().int().nonnegative(), failure: RunFailureSchema.nullable(), retryable: z.boolean(),
  resultRefs: z.array(RunResultRefSchema).max(40), startedAt: InstantSchema.nullable(), finishedAt: InstantSchema.nullable(),
});
export const RunUsageSchema = z.strictObject({
  id: IdSchema, runId: IdSchema, stepId: IdSchema, state: RunUsageStateSchema,
  model: z.string().min(1).max(128), endpoint: z.string().min(1).max(128),
  reservedUsd: UsdSchema, actualUsd: UsdSchema.nullable(),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  createdAt: InstantSchema, reconciledAt: InstantSchema.nullable(),
});
export const RunBudgetSchema = z.strictObject({
  limitUsd: UsdSchema, reservedUsd: UsdSchema, spentUsd: UsdSchema,
  requestCount: z.number().int().nonnegative(), requestLimit: z.literal(12),
});
export const RunSchema = z.strictObject({
  id: IdSchema, workspaceId: IdSchema, projectId: IdSchema.nullable(), createdBy: IdSchema,
  capabilityId: CapabilityIdSchema, capabilityVersion: z.number().int().positive(), goal: z.string().max(12000),
  locale: LocaleSchema, state: RunStateSchema, epoch: z.number().int().nonnegative(), cursor: RunCursorSchema,
  failure: RunFailureSchema.nullable(), createdAt: InstantSchema, updatedAt: InstantSchema,
  startedAt: InstantSchema.nullable(), deadlineAt: InstantSchema.nullable(),
  budget: RunBudgetSchema, steps: z.array(RunStepSchema).max(40),
  progress: RunProgressSchema.default({ plan: [], questions: [], summary: '', results: [], parentRunId: null, continuationRunId: null }),
  actions: z.strictObject({ cancel: z.boolean(), resume: z.boolean(), revise: z.boolean().default(false), retryStepIds: z.array(IdSchema).max(40) }),
});
export const RunListCursorSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const RunListPageSchema = z.strictObject({ runs: z.array(RunSchema).max(30), nextCursor: RunListCursorSchema.nullable() });
export const RunEventSchema = z.strictObject({
  id: IdSchema, runId: IdSchema, sequence: RunCursorSchema.refine((value) => value > 0), at: InstantSchema,
  kind: z.enum(['run_state', 'step_state', 'usage', 'result', 'branch_state', 'projection_changed']), state: RunStateSchema,
  stepId: IdSchema.optional(), stepState: RunStepStateSchema.optional(), action: RunActionSchema.optional(),
  failure: RunFailureSchema.optional(), resultRefs: z.array(RunResultRefSchema).max(40).default([]),
  branchId: RunBranchProjectionSchema.shape.id.optional(), branchState: RunBranchStateSchema.optional(),
  projectionRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).superRefine((value, context) => {
  if (value.kind === 'branch_state' && (!value.branchId || !value.branchState)) context.addIssue({ code: 'custom', message: 'A branch event requires branch identity and state.' });
  if (value.kind !== 'branch_state' && (value.branchId !== undefined || value.branchState !== undefined)) context.addIssue({ code: 'custom', message: 'Only branch events may expose branch fields.' });
  if (value.kind === 'projection_changed' && value.projectionRevision === undefined) context.addIssue({ code: 'custom', message: 'A projection event requires its committed revision.' });
  if (value.kind !== 'projection_changed' && value.projectionRevision !== undefined) context.addIssue({ code: 'custom', message: 'Only projection events may expose a projection revision.' });
});
export const RunEventsPageSchema = z.strictObject({
  runId: IdSchema, events: z.array(RunEventSchema).max(100), cursor: RunCursorSchema,
  hasMore: z.boolean(), terminal: z.boolean(),
});
export const ToolReceiptSchema = z.strictObject({
  runId: IdSchema, stepId: IdSchema, toolCallId: ToolCallIdSchema, inputHash: HashSchema,
  outputHash: HashSchema, resultRefs: z.array(RunResultRefSchema).max(40), committedAt: InstantSchema,
});
export const RunPolicySchema = z.strictObject({
  scope: PermissionSchema, confidential: z.boolean(),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type RunStepState = z.infer<typeof RunStepStateSchema>;
export type RunUsageState = z.infer<typeof RunUsageStateSchema>;
export type RunAction = z.infer<typeof RunActionSchema>;
export type RunFailure = z.infer<typeof RunFailureSchema>;
export type CreateRun = z.infer<typeof CreateRunSchema>;
export type ResumeRun = z.infer<typeof ResumeRunSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunListPage = z.infer<typeof RunListPageSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
export type RunUsage = z.infer<typeof RunUsageSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventsPage = z.infer<typeof RunEventsPageSchema>;
export type RunResultRef = z.infer<typeof RunResultRefSchema>;
export type RunInputRef = z.infer<typeof RunInputRefSchema>;
export type RunDecision = z.infer<typeof RunDecisionSchema>;
export type RunBranchProjection = z.infer<typeof RunBranchProjectionSchema>;
export type RunProgressProjection = z.infer<typeof RunProgressProjectionSchema>;
export type ToolReceipt = z.infer<typeof ToolReceiptSchema>;
export type RunPolicy = z.infer<typeof RunPolicySchema>;
