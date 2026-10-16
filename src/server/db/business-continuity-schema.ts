import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { BusinessBrandKit, BusinessContextItem, WorkRuleDefinition } from '../../contracts/business-work';
import { artifacts, artifactVersions } from './artifact-schema';
import { identityUsers, identityWorkspaces } from './identity-schema';
import { projects } from './project-schema';
import { agentRuns } from './run-schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const businessContexts = pgTable('business_contexts', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  projectId: uuid('project_id'),
  scope: text('scope').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => identityUsers.id),
  title: text('title').notNull(),
  currentRevision: integer('current_revision').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('business_contexts_workspace_id_id_key').on(table.workspaceId, table.id),
  foreignKey({ name: 'business_contexts_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  index('business_contexts_workspace_status_updated_idx').on(table.workspaceId, table.status, table.updatedAt, table.id),
  index('business_contexts_project_idx').on(table.workspaceId, table.projectId, table.updatedAt, table.id),
  check('business_contexts_scope_check', sql`${table.scope} IN ('workspace','project')`),
  check('business_contexts_project_scope_check', sql`(${table.scope} = 'workspace' AND ${table.projectId} IS NULL) OR (${table.scope} = 'project' AND ${table.projectId} IS NOT NULL)`),
  check('business_contexts_title_check', sql`length(${table.title}) BETWEEN 1 AND 240`),
  check('business_contexts_revision_check', sql`${table.currentRevision} > 0`),
  check('business_contexts_status_check', sql`${table.status} IN ('active','archived')`),
]);

export const businessContextVersions = pgTable('business_context_versions', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  contextId: uuid('context_id').notNull(),
  revision: integer('revision').notNull(),
  scope: text('scope').notNull(),
  projectId: uuid('project_id'),
  ownerId: uuid('owner_id').notNull().references(() => identityUsers.id),
  title: text('title').notNull(),
  items: jsonb('items').$type<BusinessContextItem[]>().notNull(),
  brandKit: jsonb('brand_kit').$type<BusinessBrandKit>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('business_context_versions_revision_key').on(table.workspaceId, table.contextId, table.revision),
  foreignKey({ name: 'business_context_versions_context_fk', columns: [table.workspaceId, table.contextId], foreignColumns: [businessContexts.workspaceId, businessContexts.id] }).onDelete('cascade'),
  foreignKey({ name: 'business_context_versions_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  index('business_context_versions_list_idx').on(table.workspaceId, table.contextId, table.revision),
  check('business_context_versions_revision_check', sql`${table.revision} > 0`),
  check('business_context_versions_scope_check', sql`${table.scope} IN ('workspace','project')`),
  check('business_context_versions_project_scope_check', sql`(${table.scope} = 'workspace' AND ${table.projectId} IS NULL) OR (${table.scope} = 'project' AND ${table.projectId} IS NOT NULL)`),
  check('business_context_versions_title_check', sql`length(${table.title}) BETWEEN 1 AND 240`),
  check('business_context_versions_items_check', sql`jsonb_typeof(${table.items}) = 'array' AND octet_length(${table.items}::text) <= 131072`),
  check('business_context_versions_brand_kit_check', sql`jsonb_typeof(${table.brandKit}) = 'object' AND octet_length(${table.brandKit}::text) <= 131072`),
  check('business_context_versions_reason_check', sql`length(${table.reason}) BETWEEN 1 AND 1000`),
]);

export const artifactVersionComments = pgTable('artifact_version_comments', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  artifactId: uuid('artifact_id').notNull(),
  artifactRevision: integer('artifact_revision').notNull(),
  parentId: uuid('parent_id'),
  target: jsonb('target').$type<Record<string, unknown>>().notNull(),
  body: text('body').notNull(),
  authorId: uuid('author_id').notNull().references(() => identityUsers.id),
  state: text('state').notNull().default('open'),
  resolvedBy: uuid('resolved_by').references(() => identityUsers.id),
  resolvedAt: instant('resolved_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('artifact_version_comments_workspace_id_id_key').on(table.workspaceId, table.id),
  foreignKey({ name: 'artifact_version_comments_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ name: 'artifact_version_comments_version_fk', columns: [table.workspaceId, table.artifactId, table.artifactRevision], foreignColumns: [artifactVersions.workspaceId, artifactVersions.artifactId, artifactVersions.revision] }).onDelete('cascade'),
  foreignKey({ name: 'artifact_version_comments_parent_fk', columns: [table.workspaceId, table.parentId], foreignColumns: [table.workspaceId, table.id] }).onDelete('cascade'),
  index('artifact_version_comments_version_state_created_idx').on(table.workspaceId, table.artifactId, table.artifactRevision, table.state, table.createdAt, table.id),
  index('artifact_version_comments_author_idx').on(table.authorId, table.createdAt, table.id),
  check('artifact_version_comments_revision_check', sql`${table.artifactRevision} >= 0`),
  check('artifact_version_comments_target_check', sql`jsonb_typeof(${table.target}) = 'object' AND octet_length(${table.target}::text) <= 16384`),
  check('artifact_version_comments_body_check', sql`length(${table.body}) BETWEEN 1 AND 8000`),
  check('artifact_version_comments_state_check', sql`${table.state} IN ('open','resolved')`),
  check('artifact_version_comments_resolution_check', sql`(${table.state} = 'open' AND ${table.resolvedBy} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.state} = 'resolved' AND ${table.resolvedBy} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`),
]);

export const artifactVersionDecisions = pgTable('artifact_version_decisions', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  artifactId: uuid('artifact_id').notNull(),
  artifactRevision: integer('artifact_revision').notNull(),
  decision: text('decision').notNull(),
  note: text('note').notNull().default(''),
  actorId: uuid('actor_id').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: 'artifact_version_decisions_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ name: 'artifact_version_decisions_version_fk', columns: [table.workspaceId, table.artifactId, table.artifactRevision], foreignColumns: [artifactVersions.workspaceId, artifactVersions.artifactId, artifactVersions.revision] }).onDelete('cascade'),
  index('artifact_version_decisions_version_created_idx').on(table.workspaceId, table.artifactId, table.artifactRevision, table.createdAt, table.id),
  index('artifact_version_decisions_actor_idx').on(table.actorId, table.createdAt, table.id),
  check('artifact_version_decisions_revision_check', sql`${table.artifactRevision} >= 0`),
  check('artifact_version_decisions_decision_check', sql`${table.decision} IN ('approved','changes_requested')`),
  check('artifact_version_decisions_note_check', sql`length(${table.note}) <= 8000`),
]);

export const workRules = pgTable('work_rules', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  projectId: uuid('project_id').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => identityUsers.id),
  title: text('title').notNull(),
  state: text('state').notNull().default('paused'),
  currentVersion: integer('current_version').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('work_rules_workspace_id_id_key').on(table.workspaceId, table.id),
  foreignKey({ name: 'work_rules_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  index('work_rules_project_state_updated_idx').on(table.workspaceId, table.projectId, table.state, table.updatedAt, table.id),
  index('work_rules_owner_idx').on(table.ownerId, table.updatedAt, table.id),
  check('work_rules_title_check', sql`length(${table.title}) BETWEEN 1 AND 240`),
  check('work_rules_state_check', sql`${table.state} IN ('enabled','paused','disabled')`),
  check('work_rules_current_version_check', sql`${table.currentVersion} > 0`),
]);

export const workRuleVersions = pgTable('work_rule_versions', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  ruleId: uuid('rule_id').notNull(),
  version: integer('version').notNull(),
  definition: jsonb('definition').$type<WorkRuleDefinition>().notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('work_rule_versions_version_key').on(table.workspaceId, table.ruleId, table.version),
  foreignKey({ name: 'work_rule_versions_rule_fk', columns: [table.workspaceId, table.ruleId], foreignColumns: [workRules.workspaceId, workRules.id] }),
  index('work_rule_versions_list_idx').on(table.workspaceId, table.ruleId, table.version),
  check('work_rule_versions_version_check', sql`${table.version} > 0`),
  check('work_rule_versions_definition_check', sql`jsonb_typeof(${table.definition}) = 'object' AND octet_length(${table.definition}::text) <= 131072`),
  check('work_rule_versions_reason_check', sql`length(${table.reason}) BETWEEN 1 AND 1000`),
]);

export const workOccurrences = pgTable('work_occurrences', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  ruleId: uuid('rule_id').notNull(),
  ruleVersion: integer('rule_version').notNull(),
  trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull(),
  state: text('state').notNull(),
  runId: uuid('run_id'),
  branchId: uuid('branch_id'),
  reasonCode: text('reason_code'),
  restartedFrom: uuid('restarted_from'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
  completedAt: instant('completed_at'),
}, (table) => [
  unique('work_occurrences_rule_version_id_key').on(table.ruleId, table.ruleVersion, table.id),
  foreignKey({ name: 'work_occurrences_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ name: 'work_occurrences_rule_version_fk', columns: [table.workspaceId, table.ruleId, table.ruleVersion], foreignColumns: [workRuleVersions.workspaceId, workRuleVersions.ruleId, workRuleVersions.version] }),
  foreignKey({ name: 'work_occurrences_run_fk', columns: [table.workspaceId, table.runId], foreignColumns: [agentRuns.workspaceId, agentRuns.id] }),
  foreignKey({ name: 'work_occurrences_branch_fk', columns: [table.branchId], foreignColumns: [artifacts.id] }).onDelete('set null'),
  foreignKey({ name: 'work_occurrences_restart_fk', columns: [table.restartedFrom], foreignColumns: [table.id] }),
  index('work_occurrences_rule_created_idx').on(table.workspaceId, table.ruleId, table.createdAt, table.id),
  index('work_occurrences_state_updated_idx').on(table.workspaceId, table.state, table.updatedAt, table.id),
  check('work_occurrences_rule_version_check', sql`${table.ruleVersion} > 0`),
  check('work_occurrences_trigger_check', sql`jsonb_typeof(${table.trigger}) = 'object' AND octet_length(${table.trigger}::text) <= 32768`),
  check('work_occurrences_state_check', sql`${table.state} IN ('queued','running','waiting_input','paused','review_ready','completed','failed','cancelled')`),
  check('work_occurrences_reason_code_check', sql`${table.reasonCode} IS NULL OR ${table.reasonCode} ~ '^[a-z][a-z0-9_.-]{0,119}$'`),
  check('work_occurrences_completion_check', sql`(${table.state} IN ('completed','failed','cancelled')) = (${table.completedAt} IS NOT NULL)`),
]);

export const outcomeObservations = pgTable('outcome_observations', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  occurrenceId: uuid('occurrence_id'),
  runId: uuid('run_id'),
  artifactId: uuid('artifact_id'),
  artifactRevision: integer('artifact_revision'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  metricKey: text('metric_key').notNull(),
  label: text('label').notNull(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
  note: text('note').notNull().default(''),
  recordedBy: uuid('recorded_by').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: 'outcome_observations_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ name: 'outcome_observations_occurrence_fk', columns: [table.occurrenceId], foreignColumns: [workOccurrences.id] }),
  foreignKey({ name: 'outcome_observations_run_fk', columns: [table.workspaceId, table.runId], foreignColumns: [agentRuns.workspaceId, agentRuns.id] }),
  foreignKey({ name: 'outcome_observations_artifact_version_fk', columns: [table.workspaceId, table.artifactId, table.artifactRevision], foreignColumns: [artifactVersions.workspaceId, artifactVersions.artifactId, artifactVersions.revision] }),
  index('outcome_observations_project_period_idx').on(table.workspaceId, table.projectId, table.periodStart, table.periodEnd, table.id),
  check('outcome_observations_period_check', sql`${table.periodStart} <= ${table.periodEnd}`),
  check('outcome_observations_artifact_pair_check', sql`(${table.artifactId} IS NULL) = (${table.artifactRevision} IS NULL)`),
  check('outcome_observations_subject_check', sql`${table.occurrenceId} IS NOT NULL OR ${table.runId} IS NOT NULL OR ${table.artifactId} IS NOT NULL`),
  check('outcome_observations_metric_key_check', sql`${table.metricKey} ~ '^[a-z][a-z0-9_.-]{0,119}$'`),
  check('outcome_observations_label_check', sql`length(${table.label}) BETWEEN 1 AND 240`),
  check('outcome_observations_value_check', sql`jsonb_typeof(${table.value}) = 'object' AND octet_length(${table.value}::text) <= 32768`),
  check('outcome_observations_evidence_check', sql`jsonb_typeof(${table.evidence}) = 'object' AND octet_length(${table.evidence}::text) <= 32768`),
  check('outcome_observations_note_check', sql`length(${table.note}) <= 4000`),
]);

export const businessContinuityOperations = pgTable('business_continuity_operations', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  actorId: uuid('actor_id').notNull().references(() => identityUsers.id),
  operationId: uuid('operation_id').notNull(),
  kind: text('kind').notNull(),
  bodyHash: text('body_hash').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.actorId, table.operationId] }),
  index('business_continuity_operations_created_idx').on(table.workspaceId, table.createdAt, table.operationId),
  check('business_continuity_operations_kind_check', sql`${table.kind} IN ('context','comment','resolve','decision','project-grant','rule','occurrence','outcome')`),
  check('business_continuity_operations_body_hash_check', sql`${table.bodyHash} ~ '^[a-f0-9]{64}$'`),
  check('business_continuity_operations_result_check', sql`jsonb_typeof(${table.result}) = 'object' AND octet_length(${table.result}::text) <= 262144`),
]);
