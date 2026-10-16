import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { LibraryLifecycleResult } from '../../contracts/library-lifecycle';
import { identityUsers, identityWorkspaces } from './identity-schema';
import { materialCollections } from './material-schema';
import { sources } from './source-schema';

export const librarySourceLifecycle = pgTable('library_source_lifecycle', {
  workspaceId: uuid('workspace_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  metadataRevision: integer('metadata_revision').notNull().default(1),
  lifecycleState: text('lifecycle_state').notNull().default('active'),
  restoreState: text('restore_state'),
  sourceState: text('source_state').notNull(),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').notNull().references(() => identityUsers.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'library_source_lifecycle_pkey', columns: [table.workspaceId, table.sourceId] }),
  foreignKey({ name: 'library_source_lifecycle_source_fk', columns: [table.workspaceId, table.sourceId], foreignColumns: [sources.workspaceId, sources.id] }).onDelete('cascade'),
  check('library_source_lifecycle_revision_check', sql`${table.metadataRevision} BETWEEN 1 AND 2147483647`),
  check('library_source_lifecycle_state_check', sql`${table.lifecycleState} IN ('active','archived','trashed')`),
  check('library_source_lifecycle_source_state_check', sql`${table.sourceState} IN ('pending','ready','unavailable')`),
  check('library_source_lifecycle_trash_check', sql`(
    ${table.lifecycleState} = 'trashed' AND ${table.restoreState} IN ('active','archived') AND ${table.trashedAt} IS NOT NULL
  ) OR (
    ${table.lifecycleState} IN ('active','archived') AND ${table.restoreState} IS NULL AND ${table.trashedAt} IS NULL
  )`),
  index('library_source_lifecycle_state_idx').on(table.workspaceId, table.lifecycleState, table.updatedAt, table.sourceId),
]);

export const libraryCollectionLifecycle = pgTable('library_collection_lifecycle', {
  workspaceId: uuid('workspace_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  metadataRevision: integer('metadata_revision').notNull().default(1),
  lifecycleState: text('lifecycle_state').notNull().default('active'),
  restoreState: text('restore_state'),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').notNull().references(() => identityUsers.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'library_collection_lifecycle_pkey', columns: [table.workspaceId, table.collectionId] }),
  foreignKey({ name: 'library_collection_lifecycle_collection_fk', columns: [table.workspaceId, table.collectionId], foreignColumns: [materialCollections.workspaceId, materialCollections.id] }).onDelete('cascade'),
  check('library_collection_lifecycle_revision_check', sql`${table.metadataRevision} BETWEEN 1 AND 2147483647`),
  check('library_collection_lifecycle_state_check', sql`${table.lifecycleState} IN ('active','archived','trashed')`),
  check('library_collection_lifecycle_trash_check', sql`(
    ${table.lifecycleState} = 'trashed' AND ${table.restoreState} IN ('active','archived') AND ${table.trashedAt} IS NOT NULL
  ) OR (
    ${table.lifecycleState} IN ('active','archived') AND ${table.restoreState} IS NULL AND ${table.trashedAt} IS NULL
  )`),
  index('library_collection_lifecycle_state_idx').on(table.workspaceId, table.lifecycleState, table.updatedAt, table.collectionId),
]);

export const libraryLifecycleOperations = pgTable('library_lifecycle_operations', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  actorId: uuid('actor_id').notNull().references(() => identityUsers.id),
  operationId: uuid('operation_id').notNull(),
  objectKind: text('object_kind').notNull(),
  sourceId: uuid('source_id'),
  collectionId: uuid('collection_id'),
  operation: text('operation').notNull(),
  bodyHash: text('body_hash').notNull(),
  result: jsonb('result').$type<LibraryLifecycleResult>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
}, (table) => [
  primaryKey({ name: 'library_lifecycle_operations_pkey', columns: [table.workspaceId, table.actorId, table.operationId] }),
  foreignKey({ name: 'library_lifecycle_operations_source_fk', columns: [table.workspaceId, table.sourceId], foreignColumns: [sources.workspaceId, sources.id] }).onDelete('cascade'),
  foreignKey({ name: 'library_lifecycle_operations_collection_fk', columns: [table.workspaceId, table.collectionId], foreignColumns: [materialCollections.workspaceId, materialCollections.id] }).onDelete('cascade'),
  check('library_lifecycle_operations_object_check', sql`(
    ${table.objectKind} = 'source' AND ${table.sourceId} IS NOT NULL AND ${table.collectionId} IS NULL
  ) OR (
    ${table.objectKind} = 'collection' AND ${table.sourceId} IS NULL AND ${table.collectionId} IS NOT NULL
  )`),
  check('library_lifecycle_operations_operation_check', sql`${table.operation} IN (
    'source.rename','source.move','source.duplicate','source.trash','source.restore',
    'collection.rename','collection.move','collection.duplicate','collection.trash','collection.restore'
  ) AND split_part(${table.operation}, '.', 1) = ${table.objectKind}`),
  check('library_lifecycle_operations_hash_check', sql`${table.bodyHash} ~ '^[a-f0-9]{64}$'`),
  check('library_lifecycle_operations_result_check', sql`jsonb_typeof(${table.result}) = 'object'`),
  check('library_lifecycle_operations_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  index('library_lifecycle_operations_expiry_idx').on(table.expiresAt),
]);
