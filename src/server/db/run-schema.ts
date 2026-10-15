import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid as uuidColumn } from 'drizzle-orm/pg-core';
import type { RunInputRef, RunResultRef } from '../../contracts/runs';
import { identityUsers, identityWorkspaces } from './identity-schema';
import { projects } from './project-schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });
const usd = (name: string) => numeric(name, { precision: 24, scale: 12 });

export const agentRuns = pgTable('agent_runs', {
  id: uuidColumn('id').primaryKey(), workspaceId: uuidColumn('workspace_id').notNull().references(() => identityWorkspaces.id),
  projectId: uuidColumn('project_id'), createdBy: uuidColumn('created_by').notNull().references(() => identityUsers.id),
  authzVersion: integer('authz_version').notNull(), capabilityId: text('capability_id').notNull(), capabilityVersion: integer('capability_version').notNull(),
  requiredScope: text('required_scope').notNull(), confidential: boolean('confidential').notNull(), goal: text('goal').notNull(), locale: text('locale').notNull(),
  inputRefs: jsonb('input_refs').$type<RunInputRef[]>().notNull(), requestKeyHash: text('request_key_hash').notNull(), inputHash: text('input_hash').notNull(),
  state: text('state').notNull().default('queued'), failureCode: text('failure_code'), executionEpoch: integer('execution_epoch').notNull().default(0),
  leaseOwner: uuidColumn('lease_owner'), leaseUntil: instant('lease_until'), eventSequence: bigint('event_sequence', { mode: 'number' }).notNull().default(0),
  requestCount: integer('request_count').notNull().default(0), stepCount: integer('step_count').notNull().default(0),
  budgetLimitUsd: usd('budget_limit_usd').notNull().default('0.5'), reservedUsd: usd('reserved_usd').notNull().default('0'), spentUsd: usd('spent_usd').notNull().default('0'),
  workflowRunId: text('workflow_run_id').unique(), workflowState: text('workflow_state').notNull().default('pending'), workflowDispatchedAt: instant('workflow_dispatched_at'),
  startedAt: instant('started_at'), deadlineAt: instant('deadline_at'), finishedAt: instant('finished_at'),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('agent_runs_workspace_id_id_key').on(table.workspaceId, table.id),
  unique('agent_runs_workspace_id_created_by_request_key_hash_key').on(table.workspaceId, table.createdBy, table.requestKeyHash),
  foreignKey({ columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  index('agent_runs_queue_idx').on(table.state, table.createdAt, table.id),
  index('agent_runs_scope_idx').on(table.workspaceId, table.projectId, table.createdAt.desc(), table.id),
  index('agent_runs_lease_idx').on(table.leaseUntil).where(sql`${table.state} = 'running'`),
  check('agent_runs_authz_version_check', sql`${table.authzVersion} > 0`),
  check('agent_runs_capability_id_check', sql`length(${table.capabilityId}) BETWEEN 3 AND 100`),
  check('agent_runs_capability_version_check', sql`${table.capabilityVersion} > 0`),
  check('agent_runs_required_scope_check', sql`${table.requiredScope} IN ('read','edit','approve','export','manage-members','read-confidential')`),
  check('agent_runs_goal_check', sql`length(${table.goal}) BETWEEN 1 AND 12000`),
  check('agent_runs_locale_check', sql`${table.locale} IN ('ru','kk','en')`),
  check('agent_runs_input_refs_check', sql`jsonb_typeof(${table.inputRefs}) = 'array' AND jsonb_array_length(${table.inputRefs}) <= 100`),
  check('agent_runs_request_key_hash_check', sql`${table.requestKeyHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_runs_input_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_runs_state_check', sql`${table.state} IN ('queued','running','waiting_input','review_ready','completed','failed','cancelled')`),
  check('agent_runs_execution_epoch_check', sql`${table.executionEpoch} >= 0`),
  check('agent_runs_event_sequence_check', sql`${table.eventSequence} BETWEEN 0 AND 9007199254740991`),
  check('agent_runs_request_count_check', sql`${table.requestCount} BETWEEN 0 AND 12`),
  check('agent_runs_step_count_check', sql`${table.stepCount} BETWEEN 0 AND 40`),
  check('agent_runs_budget_limit_usd_check', sql`${table.budgetLimitUsd} > 0 AND ${table.budgetLimitUsd} <= 0.5`),
  check('agent_runs_reserved_usd_check', sql`${table.reservedUsd} >= 0 AND ${table.reservedUsd} <> 'NaN'::numeric`),
  check('agent_runs_spent_usd_check', sql`${table.spentUsd} >= 0 AND ${table.spentUsd} <> 'NaN'::numeric`),
  check('agent_runs_workflow_run_id_check', sql`length(${table.workflowRunId}) <= 160`),
  check('agent_runs_workflow_state_check', sql`${table.workflowState} IN ('pending','dispatching','started','uncertain')`),
  check('agent_runs_lease_pair_check', sql`(${table.leaseOwner} IS NULL) = (${table.leaseUntil} IS NULL)`),
  check('agent_runs_lease_state_check', sql`${table.state} = 'running' OR ${table.leaseOwner} IS NULL`),
  check('agent_runs_deadline_pair_check', sql`(${table.startedAt} IS NULL) = (${table.deadlineAt} IS NULL)`),
  check('agent_runs_deadline_check', sql`${table.deadlineAt} IS NULL OR ${table.deadlineAt} > ${table.startedAt}`),
  check('agent_runs_terminal_check', sql`(${table.state} IN ('completed','cancelled','failed')) = (${table.finishedAt} IS NOT NULL)`),
]);

export const agentRunSteps = pgTable('agent_run_steps', {
  id: uuidColumn('id').primaryKey(), runId: uuidColumn('run_id').notNull().references(() => agentRuns.id),
  ordinal: integer('ordinal').notNull(), action: text('action').notNull(), toolName: text('tool_name').notNull(), toolVersion: integer('tool_version').notNull(),
  state: text('state').notNull().default('planned'), attempt: integer('attempt').notNull().default(0), executionEpoch: integer('execution_epoch'),
  failureCode: text('failure_code'), retryable: boolean('retryable').notNull().default(false),
  resultRefs: jsonb('result_refs').$type<RunResultRef[]>().notNull().default([]),
  inputState: jsonb('input_state').$type<Record<string, unknown>>().notNull().default({}), inputHash: text('input_hash'),
  startedAt: instant('started_at'), finishedAt: instant('finished_at'), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('agent_run_steps_run_id_id_key').on(table.runId, table.id), unique('agent_run_steps_run_id_ordinal_key').on(table.runId, table.ordinal),
  check('agent_run_steps_ordinal_check', sql`${table.ordinal} BETWEEN 1 AND 40`),
  check('agent_run_steps_action_check', sql`${table.action} IN ('read_sources','extract_text','calculate','prepare_document','prepare_design','validate','save','export','continue','process')`),
  check('agent_run_steps_tool_name_check', sql`length(${table.toolName}) BETWEEN 1 AND 100`),
  check('agent_run_steps_tool_version_check', sql`${table.toolVersion} > 0`),
  check('agent_run_steps_state_check', sql`${table.state} IN ('planned','claimed','succeeded','failed','skipped')`),
  check('agent_run_steps_attempt_check', sql`${table.attempt} >= 0`),
  check('agent_run_steps_result_refs_check', sql`jsonb_typeof(${table.resultRefs}) = 'array' AND jsonb_array_length(${table.resultRefs}) <= 40`),
  check('agent_run_steps_terminal_check', sql`(${table.state} IN ('succeeded','failed','skipped')) = (${table.finishedAt} IS NOT NULL)`),
  check('agent_run_steps_claim_check', sql`${table.state} <> 'claimed' OR ${table.executionEpoch} IS NOT NULL`),
  check('agent_run_steps_input_state_check', sql`jsonb_typeof(${table.inputState}) = 'object' AND octet_length(${table.inputState}::text) <= 65536`),
  check('agent_run_steps_input_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
]);
export const agentRunContexts = pgTable('agent_run_contexts', {
  runId: uuidColumn('run_id').primaryKey().references(() => agentRuns.id), revision: integer('revision').notNull().default(0),
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  check('agent_run_contexts_revision_check', sql`${table.revision} >= 0`),
  check('agent_run_contexts_state_check', sql`jsonb_typeof(${table.state}) = 'object' AND octet_length(${table.state}::text) <= 65536`),
]);
export const agentRunContinuations = pgTable('agent_run_continuations', {
  workspaceId: uuidColumn('workspace_id').notNull(), parentRunId: uuidColumn('parent_run_id').notNull(), childRunId: uuidColumn('child_run_id').primaryKey(),
  createdBy: uuidColumn('created_by').notNull().references(() => identityUsers.id), requestKeyHash: text('request_key_hash').notNull(), inputHash: text('input_hash').notNull(),
  reason: text('reason').notNull(), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.parentRunId], foreignColumns: [agentRuns.workspaceId, agentRuns.id] }),
  foreignKey({ columns: [table.workspaceId, table.childRunId], foreignColumns: [agentRuns.workspaceId, agentRuns.id] }),
  unique('agent_run_continuations_request_key').on(table.parentRunId, table.createdBy, table.requestKeyHash),
  unique('agent_run_continuations_parent_key').on(table.parentRunId),
  index('agent_run_continuations_workspace_idx').on(table.workspaceId, table.parentRunId),
  check('agent_run_continuations_distinct_check', sql`${table.parentRunId} <> ${table.childRunId}`),
  check('agent_run_continuations_reason_check', sql`${table.reason} IN ('deadline','goal-change','follow-up')`),
  check('agent_run_continuations_request_hash_check', sql`${table.requestKeyHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_run_continuations_input_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
]);
export const agentToolReceipts = pgTable('agent_tool_receipts', {
  runId: uuidColumn('run_id').notNull(), stepId: uuidColumn('step_id').notNull(), toolCallId: text('tool_call_id').notNull(),
  inputHash: text('input_hash').notNull(), outputHash: text('output_hash').notNull(),
  resultRefs: jsonb('result_refs').$type<RunResultRef[]>().notNull(), committedAt: instant('committed_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.stepId, table.toolCallId] }),
  unique('agent_tool_receipts_effect_key').on(table.runId, table.stepId, table.toolCallId, table.inputHash),
  foreignKey({ columns: [table.runId, table.stepId], foreignColumns: [agentRunSteps.runId, agentRunSteps.id] }),
  check('agent_tool_receipts_tool_call_id_check', sql`length(${table.toolCallId}) BETWEEN 1 AND 128`),
  check('agent_tool_receipts_input_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_tool_receipts_output_hash_check', sql`${table.outputHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_tool_receipts_result_refs_check', sql`jsonb_typeof(${table.resultRefs}) = 'array' AND jsonb_array_length(${table.resultRefs}) <= 40`),
]);
export const agentRunUsage = pgTable('agent_run_usage', {
  id: uuidColumn('id').primaryKey(), runId: uuidColumn('run_id').notNull(), stepId: uuidColumn('step_id').notNull(),
  callKey: text('call_key').notNull(), operationKey: text('operation_key'), inputHash: text('input_hash').notNull(), workspaceId: uuidColumn('workspace_id').notNull(),
  budgetDay: date('budget_day').notNull(), state: text('state').notNull(), model: text('model').notNull(), endpoint: text('endpoint').notNull(),
  pricingSnapshot: jsonb('pricing_snapshot').notNull(), reservedUsd: usd('reserved_usd').notNull(), actualUsd: usd('actual_usd'),
  providerRequestId: text('provider_request_id'), inputTokens: integer('input_tokens'), outputTokens: integer('output_tokens'), cachedInputTokens: integer('cached_input_tokens'),
  leaseEpoch: integer('lease_epoch').notNull(), dispatchedAt: instant('dispatched_at'), reconciledAt: instant('reconciled_at'), createdAt: instant('created_at').notNull().defaultNow(),
  authorizationId: text('authorization_id').references(() => agentBudgetAuthorizations.id),
}, (table) => [
  unique('agent_run_usage_run_id_call_key_key').on(table.runId, table.callKey),
  uniqueIndex('agent_model_operation_idx').on(table.runId, table.stepId, table.operationKey).where(sql`${table.state} <> 'released'`),
  index('agent_run_usage_authorization_idx').on(table.authorizationId, table.state),
  foreignKey({ columns: [table.runId, table.stepId], foreignColumns: [agentRunSteps.runId, agentRunSteps.id] }),
  foreignKey({ columns: [table.workspaceId, table.runId], foreignColumns: [agentRuns.workspaceId, agentRuns.id] }),
  index('agent_run_usage_day_idx').on(table.budgetDay, table.workspaceId, table.state), index('agent_run_usage_run_idx').on(table.runId, table.createdAt),
  check('agent_run_usage_call_key_check', sql`length(${table.callKey}) BETWEEN 1 AND 128`),
  check('agent_run_usage_operation_key_check', sql`${table.operationKey} ~ '^[A-Za-z0-9_-]{1,90}$'`),
  check('agent_run_usage_input_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_run_usage_state_check', sql`${table.state} IN ('reserved','dispatched','succeeded','released','ambiguous')`),
  check('agent_run_usage_model_check', sql`length(${table.model}) BETWEEN 1 AND 128`),
  check('agent_run_usage_endpoint_check', sql`length(${table.endpoint}) BETWEEN 1 AND 128`),
  check('agent_run_usage_pricing_snapshot_check', sql`octet_length(${table.pricingSnapshot}::text) <= 16384`),
  check('agent_run_usage_reserved_usd_check', sql`${table.reservedUsd} >= 0 AND ${table.reservedUsd} <> 'NaN'::numeric`),
  check('agent_run_usage_actual_usd_check', sql`${table.actualUsd} >= 0 AND ${table.actualUsd} <> 'NaN'::numeric`),
  check('agent_run_usage_provider_request_id_check', sql`length(${table.providerRequestId}) <= 160`),
  check('agent_run_usage_input_tokens_check', sql`${table.inputTokens} >= 0`), check('agent_run_usage_output_tokens_check', sql`${table.outputTokens} >= 0`),
  check('agent_run_usage_cached_input_tokens_check', sql`${table.cachedInputTokens} IS NULL OR (${table.inputTokens} IS NOT NULL AND ${table.cachedInputTokens} BETWEEN 0 AND ${table.inputTokens})`),
  check('agent_run_usage_lease_epoch_check', sql`${table.leaseEpoch} > 0`),
  check('agent_run_usage_actual_state_check', sql`(${table.state} = 'succeeded') = (${table.actualUsd} IS NOT NULL)`),
  check('agent_run_usage_reconcile_check', sql`(${table.state} IN ('succeeded','released')) = (${table.reconciledAt} IS NOT NULL)`),
  check('agent_run_usage_reserve_check', sql`${table.state} <> 'reserved' OR ${table.dispatchedAt} IS NULL`),
  check('agent_run_usage_dispatch_check', sql`${table.state} NOT IN ('dispatched','succeeded','ambiguous') OR ${table.dispatchedAt} IS NOT NULL`),
]);
export const agentBudgetDays = pgTable('agent_budget_days', {
  scope: text('scope').notNull(), scopeKey: text('scope_key').notNull(), day: date('day').notNull(),
  reservedUsd: usd('reserved_usd').notNull().default('0'), spentUsd: usd('spent_usd').notNull().default('0'),
}, (table) => [
  primaryKey({ columns: [table.scope, table.scopeKey, table.day] }),
  check('agent_budget_days_scope_check', sql`${table.scope} IN ('deployment','workspace')`),
  check('agent_budget_days_scope_key_check', sql`length(${table.scopeKey}) BETWEEN 1 AND 80`),
  check('agent_budget_days_reserved_usd_check', sql`${table.reservedUsd} >= 0 AND ${table.reservedUsd} <> 'NaN'::numeric`),
  check('agent_budget_days_spent_usd_check', sql`${table.spentUsd} >= 0 AND ${table.spentUsd} <> 'NaN'::numeric`),
  check('agent_budget_days_deployment_check', sql`${table.scope} <> 'deployment' OR ${table.scopeKey} = 'deployment'`),
]);
export const agentRunEvents = pgTable('agent_run_events', {
  runId: uuidColumn('run_id').notNull().references(() => agentRuns.id), sequence: bigint('sequence', { mode: 'number' }).notNull(),
  id: uuidColumn('id').notNull().unique(), kind: text('kind').notNull(), payload: jsonb('payload').notNull(), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.sequence] }), index('agent_run_events_retention_idx').on(table.createdAt),
  check('agent_run_events_sequence_check', sql`${table.sequence} BETWEEN 1 AND 9007199254740991`),
  check('agent_run_events_kind_check', sql`${table.kind} IN ('run_state','step_state','usage','result')`),
  check('agent_run_events_payload_check', sql`octet_length(${table.payload}::text) <= 16384`),
]);
export const agentQueueWorkspaces = pgTable('agent_queue_workspaces', {
  workspaceId: uuidColumn('workspace_id').primaryKey().references(() => identityWorkspaces.id), lastServed: bigint('last_served', { mode: 'bigint' }).notNull().default(0n),
}, (table) => [check('agent_queue_workspaces_last_served_check', sql`${table.lastServed} >= 0`)]);
export const agentQueueClock = pgTable('agent_queue_clock', {
  singleton: boolean('singleton').primaryKey().default(true), sequence: bigint('sequence', { mode: 'bigint' }).notNull().default(0n),
}, (table) => [check('agent_queue_clock_singleton_check', sql`${table.singleton}`), check('agent_queue_clock_sequence_check', sql`${table.sequence} >= 0`)]);
export const agentRunOperations = pgTable('agent_run_operations', {
  runId: uuidColumn('run_id').notNull().references(() => agentRuns.id), actorId: uuidColumn('actor_id').notNull().references(() => identityUsers.id),
  keyHash: text('key_hash').notNull(), inputHash: text('input_hash').notNull(), kind: text('kind').notNull(), resultEpoch: integer('result_epoch').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.actorId, table.keyHash] }),
  check('agent_run_operations_key_hash_check', sql`${table.keyHash} ~ '^[a-f0-9]{64}$'`), check('agent_run_operations_input_hash_check', sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_run_operations_kind_check', sql`${table.kind} IN ('cancel','resume')`), check('agent_run_operations_result_epoch_check', sql`${table.resultEpoch} >= 0`),
]);

export const agentBudgetAuthorizations = pgTable('agent_budget_authorizations', {
  id: text('id').primaryKey(), provider: text('provider').notNull(), state: text('state').notNull(),
  limitUsd: usd('limit_usd').notNull(), reservedUsd: usd('reserved_usd').notNull().default('0'), spentUsd: usd('spent_usd').notNull().default('0'),
  keyFingerprint: text('key_fingerprint').notNull(), authorityRef: text('authority_ref').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(), activatedAt: instant('activated_at'),
}, (table) => [
  uniqueIndex('agent_one_active_authorization').on(table.provider).where(sql`${table.state}='active'`),
  check('agent_budget_authorizations_id_check', sql`length(${table.id}) BETWEEN 1 AND 100`),
  check('agent_budget_authorizations_provider_check', sql`${table.provider}='openrouter'`),
  check('agent_budget_authorizations_state_check', sql`${table.state} IN ('inactive','active','closed')`),
  check('agent_budget_authorizations_limit_usd_check', sql`${table.limitUsd}>0 AND ${table.limitUsd}<=10`),
  check('agent_budget_authorizations_reserved_usd_check', sql`${table.reservedUsd}>=0 AND ${table.reservedUsd}<>'NaN'::numeric`),
  check('agent_budget_authorizations_spent_usd_check', sql`${table.spentUsd}>=0 AND ${table.spentUsd}<>'NaN'::numeric`),
  check('agent_budget_authorizations_key_fingerprint_check', sql`${table.keyFingerprint} ~ '^[a-f0-9]{64}$'`),
  check('agent_budget_authorizations_authority_ref_check', sql`length(${table.authorityRef}) BETWEEN 1 AND 200`),
  check('agent_budget_authorizations_activation_check', sql`${table.state}<>'active' OR ${table.activatedAt} IS NOT NULL`),
]);
export const agentModelOutputs = pgTable('agent_model_outputs', {
  usageId: uuidColumn('usage_id').primaryKey().references(() => agentRunUsage.id), payload: jsonb('payload').notNull(),
  outputHash: text('output_hash').notNull(), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  check('agent_model_outputs_payload_check', sql`jsonb_typeof(${table.payload})='object' AND octet_length(${table.payload}::text)<=131072`),
  check('agent_model_outputs_output_hash_check', sql`${table.outputHash} ~ '^[a-f0-9]{64}$'`),
]);
export const agentModelEndpoints = pgTable('agent_model_endpoints', {
  model: text('model').notNull(), endpoint: text('endpoint').notNull(), kind: text('kind').notNull(), state: text('state').notNull(),
  policyRevision: integer('policy_revision').notNull(), pricingSnapshot: jsonb('pricing_snapshot').notNull(), pricingHash: text('pricing_hash').notNull(),
  proofState: text('proof_state').notNull(), proofRef: text('proof_ref'), quarantineUsageId: uuidColumn('quarantine_usage_id').references(() => agentRunUsage.id),
  quarantinedAt: instant('quarantined_at'), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.model, table.endpoint, table.kind] }),
  check('agent_model_endpoints_model_check', sql`length(${table.model}) BETWEEN 1 AND 128`),
  check('agent_model_endpoints_endpoint_check', sql`length(${table.endpoint}) BETWEEN 1 AND 128`),
  check('agent_model_endpoints_kind_check', sql`${table.kind} IN ('text','image')`),
  check('agent_model_endpoints_state_check', sql`${table.state} IN ('candidate','enabled','disabled','quarantined')`),
  check('agent_model_endpoints_policy_revision_check', sql`${table.policyRevision}>0`),
  check('agent_model_endpoints_pricing_snapshot_check', sql`jsonb_typeof(${table.pricingSnapshot})='object' AND octet_length(${table.pricingSnapshot}::text)<=16384`),
  check('agent_model_endpoints_pricing_hash_check', sql`${table.pricingHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_model_endpoints_proof_state_check', sql`${table.proofState} IN ('unproven','passed')`),
  check('agent_model_endpoints_proof_ref_check', sql`length(${table.proofRef}) BETWEEN 1 AND 200`),
  check('agent_model_endpoints_enabled_check', sql`${table.state}<>'enabled' OR (${table.proofState}='passed' AND ${table.proofRef} IS NOT NULL)`),
  check('agent_model_endpoints_quarantine_check', sql`(${table.state}='quarantined')=(${table.quarantineUsageId} IS NOT NULL AND ${table.quarantinedAt} IS NOT NULL)`),
]);
