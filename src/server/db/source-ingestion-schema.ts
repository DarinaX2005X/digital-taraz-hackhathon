import { foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { identityUsers } from './identity-schema';
import { sources, sourceVersions } from './source-schema';

export const sourceDetails = pgTable('source_details', {
  sourceId: uuid('source_id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), title: text('title').notNull(),
}, (t) => [foreignKey({ columns: [t.workspaceId, t.sourceId], foreignColumns: [sources.workspaceId, sources.id] })]);
export const sourceUploads = pgTable('source_uploads', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), sourceId: uuid('source_id').notNull(),
  actorId: uuid('actor_id').notNull().references(() => identityUsers.id), operationId: uuid('operation_id').notNull(), bodyHash: text('body_hash').notNull(),
  expectedRevision: integer('expected_revision').notNull(), reservedVersionId: uuid('reserved_version_id').notNull().unique(), publishedVersionId: uuid('published_version_id'),
  fileName: text('file_name').notNull(), declaredSize: integer('declared_size').notNull(), mediaType: text('media_type').notNull(), format: text('format').notNull(),
  options: jsonb('options').notNull().default({}), status: text('status').notNull().default('pending'),
  tokenHash: text('token_hash').notNull(), tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  originalKey: text('original_key'), byteHash: text('byte_hash'), byteSize: integer('byte_size'), manifest: jsonb('manifest'), errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.workspaceId, t.actorId, t.operationId), unique().on(t.workspaceId, t.sourceId, t.id),
  foreignKey({ columns: [t.workspaceId, t.sourceId], foreignColumns: [sources.workspaceId, sources.id] }),
  foreignKey({ columns: [t.workspaceId, t.sourceId, t.publishedVersionId], foreignColumns: [sourceVersions.workspaceId, sourceVersions.sourceId, sourceVersions.id] }),
  index('source_uploads_source_idx').on(t.workspaceId, t.sourceId, t.createdAt, t.id), index('source_uploads_cleanup_idx').on(t.status, t.updatedAt, t.id),
]);
export const sourceChunks = pgTable('source_chunks', {
  uploadId: uuid('upload_id').notNull().references(() => sourceUploads.id), ordinal: integer('ordinal').notNull(), hash: text('hash').notNull(), content: jsonb('content').notNull(),
}, (t) => [primaryKey({ columns: [t.uploadId, t.ordinal] })]);
export const sourcePages = pgTable('source_pages', {
  uploadId: uuid('upload_id').notNull().references(() => sourceUploads.id), page: integer('page').notNull(), state: text('state').notNull(), runId: uuid('run_id'), diagnostics: jsonb('diagnostics').notNull().default([]),
}, (t) => [primaryKey({ columns: [t.uploadId, t.page] })]);
