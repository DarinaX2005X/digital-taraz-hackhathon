import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type { RunInputRef } from '@/contracts/runs';
import { identityUsers, identityWorkspaces } from './identity-schema';
import { projects } from './project-schema';

export const demoExecutionScopes = pgTable('demo_execution_scopes', {
  id: uuid('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  startKeyHash: text('start_key_hash').notNull(),
  locale: text('locale').notNull(),
  actorId: uuid('actor_id').notNull().references(() => identityUsers.id),
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  projectId: uuid('project_id').notNull(),
  revision: integer('revision').notNull().default(0),
  inputRefs: jsonb('input_refs').$type<RunInputRef[]>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('demo_execution_scopes_token_hash_key').on(table.tokenHash),
  unique('demo_execution_scopes_start_key_hash_key').on(table.startKeyHash),
  unique('demo_execution_scopes_workspace_id_key').on(table.workspaceId),
  unique('demo_execution_scopes_project_id_key').on(table.projectId),
  index('demo_execution_scopes_expiry_idx').on(table.expiresAt),
  check('demo_execution_scopes_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check('demo_execution_scopes_start_key_hash_check', sql`${table.startKeyHash} ~ '^[a-f0-9]{64}$'`),
  check('demo_execution_scopes_locale_check', sql`${table.locale} IN ('ru','kk','en')`),
  check('demo_execution_scopes_revision_check', sql`${table.revision} >= 0`),
  check('demo_execution_scopes_inputs_check', sql`jsonb_typeof(${table.inputRefs})='array' AND jsonb_array_length(${table.inputRefs}) BETWEEN 1 AND 100`),
  check('demo_execution_scopes_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  foreignKey({ name: 'demo_execution_scopes_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
]);

export const demoExecutionOperations = pgTable('demo_execution_operations', {
  sessionId: uuid('session_id').notNull().references(() => demoExecutionScopes.id),
  kind: text('kind').notNull(),
  keyHash: text('key_hash').notNull(),
  bodyHash: text('body_hash').notNull(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.kind, table.keyHash] }),
  check('demo_execution_operations_kind_check', sql`${table.kind} IN ('run','copy','resume')`),
  check('demo_execution_operations_key_hash_check', sql`${table.keyHash} ~ '^[a-f0-9]{64}$'`),
  check('demo_execution_operations_body_hash_check', sql`${table.bodyHash} ~ '^[a-f0-9]{64}$'`),
  check('demo_execution_operations_result_check', sql`jsonb_typeof(${table.result})='object' AND octet_length(${table.result}::text)<=65536`),
]);
