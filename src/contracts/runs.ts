import { z } from 'zod';
import { PermissionSchema } from './capabilities';
import { HashSchema, IdSchema, InstantSchema, LocaleSchema, RevisionSchema } from './primitives';

export const RunStateSchema = z.enum(['queued', 'running', 'waiting_input', 'review_ready', 'completed', 'failed', 'cancelled']);
export const RunStepStateSchema = z.enum(['planned', 'claimed', 'succeeded', 'failed', 'skipped']);
export const RunUsageStateSchema = z.enum(['reserved', 'dispatched', 'succeeded', 'released', 'ambiguous']);
export const RunActionSchema = z.enum(['read_sources', 'extract_text', 'calculate', 'prepare_document', 'prepare_design', 'validate', 'save', 'export', 'continue', 'process']);
export const RunFailureSchema = z.enum([
  'unavailable', 'configuration', 'provider', 'provider_timeout', 'ambiguous_charge', 'invalid_result',
  'price_unknown', 'price_expired', 'model_expired', 'model_unproven', 'model_forbidden', 'unsupported_parameters',
  'run_budget', 'workspace_budget', 'deployment_budget', 'request_limit', 'step_limit', 'branch_limit',
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
});
export const CancelRunSchema = z.strictObject({ expectedEpoch: z.number().int().nonnegative() });

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
  actions: z.strictObject({ cancel: z.boolean(), resume: z.boolean(), retryStepIds: z.array(IdSchema).max(40) }),
});
export const RunEventSchema = z.strictObject({
  id: IdSchema, runId: IdSchema, sequence: RunCursorSchema.refine((value) => value > 0), at: InstantSchema,
  kind: z.enum(['run_state', 'step_state', 'usage', 'result']), state: RunStateSchema,
  stepId: IdSchema.optional(), stepState: RunStepStateSchema.optional(), action: RunActionSchema.optional(),
  failure: RunFailureSchema.optional(), resultRefs: z.array(RunResultRefSchema).max(40).default([]),
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
export type Run = z.infer<typeof RunSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
export type RunUsage = z.infer<typeof RunUsageSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventsPage = z.infer<typeof RunEventsPageSchema>;
export type RunResultRef = z.infer<typeof RunResultRefSchema>;
export type RunInputRef = z.infer<typeof RunInputRefSchema>;
export type ToolReceipt = z.infer<typeof ToolReceiptSchema>;
export type RunPolicy = z.infer<typeof RunPolicySchema>;
