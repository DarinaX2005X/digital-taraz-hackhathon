import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { identityUsers } from './identity-schema';
import { sourceVersions } from './source-schema';
import { sourceUploads } from './source-ingestion-schema';

export const sourceAssets = pgTable('source_assets', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), sourceId: uuid('source_id').notNull(),
  sourceVersionId: uuid('source_version_id').notNull(), uploadId: uuid('upload_id').notNull(),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id), producerKey: text('producer_key').notNull(),
  byteHash: text('byte_hash').notNull(), byteSize: integer('byte_size').notNull(), mediaType: text('media_type').notNull(),
  width: integer('width'), height: integer('height'), storageKey: text('storage_key').notNull(), state: text('state').notNull().default('pending'),
  name: text('name').notNull().default(''), kind: text('kind').notNull().default('image'), fontMetadata: jsonb('font_metadata'), license: jsonb('license').notNull().default({ permission: 'unknown', canEmbed: false }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.workspaceId, t.id), unique().on(t.workspaceId, t.sourceVersionId, t.producerKey),
  foreignKey({ columns: [t.workspaceId, t.sourceId, t.sourceVersionId], foreignColumns: [sourceVersions.workspaceId, sourceVersions.sourceId, sourceVersions.id] }),
  foreignKey({ columns: [t.workspaceId, t.sourceId, t.uploadId], foreignColumns: [sourceUploads.workspaceId, sourceUploads.sourceId, sourceUploads.id] }),
  index('source_assets_upload_idx').on(t.workspaceId, t.uploadId, t.id),
  check('source_assets_size_check', sql`${t.byteSize} BETWEEN 1 AND 20971520 AND (${t.kind}<>'font' OR ${t.byteSize}<=5242880)`),
  check('source_assets_dimensions_check', sql`${t.kind}='font' OR (${t.width} > 0 AND ${t.height} > 0 AND ${t.width}::bigint * ${t.height}::bigint <= 20000000)`),
]);
