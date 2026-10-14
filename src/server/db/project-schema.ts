import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { identityUsers, identityWorkspaces } from './identity-schema';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  title: text('title').notNull(),
  goal: text('goal'),
  status: text('status').notNull().default('active'),
  revision: integer('revision').notNull().default(1),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  creationKey: uuid('creation_key').notNull(),
  creationBodyHash: text('creation_body_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('projects_workspace_id_id_key').on(table.workspaceId, table.id),
  unique('projects_creation_key').on(table.workspaceId, table.createdBy, table.creationKey),
  index('projects_workspace_updated_idx').on(table.workspaceId, table.updatedAt, table.id),
  check('projects_title_check', sql`length(${table.title}) BETWEEN 1 AND 240`),
  check('projects_goal_check', sql`${table.goal} IS NULL OR length(${table.goal}) <= 12000`),
  check('projects_status_check', sql`${table.status} IN ('active','archived','trashed')`),
  check('projects_revision_check', sql`${table.revision} > 0`),
  check('projects_creation_body_hash_check', sql`${table.creationBodyHash} ~ '^[a-f0-9]{64}$'`),
]);
