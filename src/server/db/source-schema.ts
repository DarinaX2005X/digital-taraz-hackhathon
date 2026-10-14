import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { identityUsers, identityWorkspaces } from './identity-schema';
import { projects } from './project-schema';

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  projectId: uuid('project_id').notNull(),
  accessClass: text('access_class').notNull().default('internal'),
  state: text('state').notNull().default('pending'),
  currentVersionId: uuid('current_version_id'),
  currentRevision: integer('current_revision').notNull().default(0),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('sources_workspace_id_id_key').on(table.workspaceId, table.id),
  foreignKey({ name: 'sources_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  index('sources_project_idx').on(table.workspaceId, table.projectId, table.id),
  check('sources_access_class_check', sql`${table.accessClass} IN ('internal','confidential')`),
  check('sources_state_check', sql`${table.state} IN ('pending','ready','unavailable','trashed')`),
  check('sources_head_check', sql`(${table.currentVersionId} IS NULL AND ${table.currentRevision} = 0 AND ${table.state} <> 'ready') OR (${table.currentVersionId} IS NOT NULL AND ${table.currentRevision} > 0)`),
]);

export const sourceVersions = pgTable('source_versions', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  revision: integer('revision').notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('source_versions_source_id_key').on(table.workspaceId, table.sourceId, table.id),
  unique('source_versions_source_revision_key').on(table.workspaceId, table.sourceId, table.revision),
  unique('source_versions_head_key').on(table.workspaceId, table.sourceId, table.id, table.revision),
  foreignKey({ name: 'source_versions_source_fk', columns: [table.workspaceId, table.sourceId], foreignColumns: [sources.workspaceId, sources.id] }),
  check('source_versions_revision_check', sql`${table.revision} > 0`),
  check('source_versions_hash_check', sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
]);
