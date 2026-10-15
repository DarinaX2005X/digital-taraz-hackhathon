import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { identityUsers, identityWorkspaces } from './identity-schema';
export const exportJobs = pgTable('export_jobs', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), createdBy: uuid('created_by').notNull().references(() => identityUsers.id), operationId: uuid('operation_id').notNull(), bodyHash: text('body_hash').notNull(),
  inputManifest: jsonb('input_manifest').notNull(), inputHash: text('input_hash').notNull(), status: text('status').notNull().default('queued'), files: jsonb('files').notNull(), finalManifest: jsonb('final_manifest'), finalHash: text('final_hash'), leaseId: uuid('lease_id'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [unique('export_jobs_operation_key').on(t.workspaceId, t.createdBy, t.operationId), unique('export_jobs_workspace_id_key').on(t.workspaceId, t.id), index('export_jobs_owner_recent_idx').on(t.workspaceId, t.createdBy, t.createdAt), check('export_jobs_status_check', sql`${t.status} IN ('queued','rendering','partial','ready','failed','cancelled')`)]);
export const exportFileCleanup = pgTable('export_file_cleanup', {
  storageKey: text('storage_key').primaryKey(), workspaceId: uuid('workspace_id').notNull(), jobId: uuid('job_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ columns: [t.workspaceId, t.jobId], foreignColumns: [exportJobs.workspaceId, exportJobs.id] })]);
