import { z } from 'zod';
import { SourceRefSchema } from '../../contracts/artifacts';
import { WorkRuleDefinitionSchema } from '../../contracts/business-work';
import { CalendarDateSchema, IdSchema, InstantSchema, MoneySchema, QuantitySchema } from '../../contracts/primitives';
import { AuthzVersionSchema } from '../identity/contracts';

export const WorkRuleStateSchema = z.enum(['enabled', 'paused', 'disabled']);
export const WorkOccurrenceStateSchema = z.enum(['queued', 'running', 'waiting_input', 'paused', 'review_ready', 'completed', 'failed', 'cancelled']);

export const WorkRuleSummarySchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  ownerId: IdSchema,
  title: z.string().min(1).max(240),
  state: WorkRuleStateSchema,
  currentVersion: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  permissions: z.strictObject({ read: z.literal(true), edit: z.boolean(), enable: z.boolean(), run: z.boolean() }),
});

export const WorkRuleVersionSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  ruleId: IdSchema,
  version: z.number().int().positive(),
  definition: WorkRuleDefinitionSchema,
  reason: z.string().min(1).max(1_000),
  createdBy: IdSchema,
  createdAt: InstantSchema,
});

export const WorkRuleDetailSchema = z.strictObject({ rule: WorkRuleSummarySchema, version: WorkRuleVersionSchema, authzVersion: AuthzVersionSchema });
export const WorkRuleListSchema = z.strictObject({ rules: z.array(WorkRuleSummarySchema).max(100), authzVersion: AuthzVersionSchema });

export const CreateWorkRuleSchema = z.strictObject({
  workspaceId: IdSchema,
  projectId: IdSchema,
  expectedAuthzVersion: AuthzVersionSchema,
  title: z.string().trim().min(1).max(240),
  state: WorkRuleStateSchema.default('paused'),
  definition: WorkRuleDefinitionSchema,
  reason: z.string().trim().min(1).max(1_000),
});
export const UpdateWorkRuleSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: AuthzVersionSchema,
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  definition: WorkRuleDefinitionSchema,
  reason: z.string().trim().min(1).max(1_000),
});
export const SetWorkRuleStateSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: AuthzVersionSchema,
  expectedVersion: z.number().int().positive(),
  state: WorkRuleStateSchema,
});
export const ListWorkRulesSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema, state: WorkRuleStateSchema.optional(), limit: z.number().int().min(1).max(100).default(50) });

export const WorkOccurrenceSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  ruleId: IdSchema,
  ruleVersion: z.number().int().positive(),
  trigger: z.strictObject({ kind: z.enum(['manual', 'schedule', 'source-update']), at: InstantSchema, sourceRefs: z.array(SourceRefSchema).max(100) }),
  state: WorkOccurrenceStateSchema,
  runId: IdSchema.nullable(),
  branchId: IdSchema.nullable(),
  reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/).nullable(),
  restartedFrom: IdSchema.nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  completedAt: InstantSchema.nullable(),
});
export const WorkOccurrenceListSchema = z.strictObject({ occurrences: z.array(WorkOccurrenceSchema).max(200), authzVersion: AuthzVersionSchema });
export const ListWorkOccurrencesSchema = z.strictObject({ workspaceId: IdSchema, ruleId: IdSchema, limit: z.number().int().min(1).max(200).default(50) });
export const OccurrenceMutationSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: AuthzVersionSchema });
export const RestartOccurrenceSchema = OccurrenceMutationSchema.extend({ occurrenceId: IdSchema });

export const OutcomeValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('count'), value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ kind: z.literal('money'), value: MoneySchema }),
  z.strictObject({ kind: z.literal('quantity'), value: QuantitySchema }),
  z.strictObject({ kind: z.literal('duration-minutes'), value: z.number().nonnegative().max(10_000_000) }),
  z.strictObject({ kind: z.literal('ratio'), value: z.number().min(-1_000_000).max(1_000_000) }),
  z.strictObject({ kind: z.literal('text'), value: z.string().min(1).max(4_000) }),
]);
export const OutcomeEvidenceSchema = z.strictObject({
  kind: z.enum(['manual', 'source', 'artifact']),
  sourceRefs: z.array(SourceRefSchema).max(100),
  note: z.string().trim().max(2_000),
});
export const OutcomeObservationSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  occurrenceId: IdSchema.nullable(),
  runId: IdSchema.nullable(),
  artifactId: IdSchema.nullable(),
  artifactRevision: z.number().int().nonnegative().nullable(),
  periodStart: CalendarDateSchema,
  periodEnd: CalendarDateSchema,
  metricKey: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
  label: z.string().min(1).max(240),
  value: OutcomeValueSchema,
  evidence: OutcomeEvidenceSchema,
  note: z.string().max(4_000),
  recordedBy: IdSchema,
  createdAt: InstantSchema,
});
export const CreateOutcomeObservationSchema = OutcomeObservationSchema.omit({ id: true, recordedBy: true, createdAt: true }).extend({ expectedAuthzVersion: AuthzVersionSchema }).superRefine((input, context) => {
  if (input.periodStart > input.periodEnd) context.addIssue({ code: 'custom', path: ['periodEnd'], message: 'Outcome period must be ordered.' });
  if ((input.artifactId === null) !== (input.artifactRevision === null)) context.addIssue({ code: 'custom', path: ['artifactRevision'], message: 'Artifact id and revision must be supplied together.' });
  if (!input.occurrenceId && !input.runId && !input.artifactId) context.addIssue({ code: 'custom', message: 'Outcome evidence must reference completed work.' });
});
export const ListOutcomesSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema, limit: z.number().int().min(1).max(200).default(50) });
export const OutcomeListSchema = z.strictObject({ outcomes: z.array(OutcomeObservationSchema).max(200), authzVersion: AuthzVersionSchema });

export type WorkRuleSummary = z.infer<typeof WorkRuleSummarySchema>;
export type WorkRuleVersion = z.infer<typeof WorkRuleVersionSchema>;
export type WorkRuleDetail = z.infer<typeof WorkRuleDetailSchema>;
export type WorkOccurrence = z.infer<typeof WorkOccurrenceSchema>;
export type OutcomeObservation = z.infer<typeof OutcomeObservationSchema>;
