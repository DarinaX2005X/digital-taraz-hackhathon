import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export * from './identity-schema';

export const demoTemplates = pgTable('demo_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique('demo_templates_key_key'),
  schemaVersion: integer('schema_version').notNull(),
  definition: jsonb('definition').$type<{ synthetic: true; title: string; description: string }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('demo_templates_schema_version_check', sql`${table.schemaVersion} > 0`),
  check('demo_templates_definition_check', sql`(${table.definition}->>'synthetic' = 'true') IS TRUE`),
]);

export const preflightHostingProbes = pgTable('preflight_hosting_probes', {
  probeId: uuid('probe_id').primaryKey(),
  workflowRunId: text('workflow_run_id').unique(),
  state: text('state').notNull().default('starting'),
  startDeploymentId: text('start_deployment_id').notNull(),
  resumeDeploymentId: text('resume_deployment_id'),
  beforeCount: integer('before_count').notNull().default(0),
  afterCount: integer('after_count').notNull().default(0),
  blobPath: text('blob_path'),
  blobSha256: text('blob_sha256'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('preflight_hosting_state_check', sql`${table.state} IN ('starting', 'waiting', 'completed', 'failed')`),
  check('preflight_hosting_before_check', sql`${table.beforeCount} BETWEEN 0 AND 1`),
  check('preflight_hosting_after_check', sql`${table.afterCount} BETWEEN 0 AND 1`),
  check('preflight_hosting_sha256_check', sql`${table.blobSha256} IS NULL OR ${table.blobSha256} ~ '^[a-f0-9]{64}$'`),
  index('preflight_hosting_probes_created_at_idx').on(table.createdAt),
]);
