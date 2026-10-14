import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { identityUsers, identityWorkspaces } from './identity-schema';
import { projects } from './project-schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const artifactChunks = pgTable('artifact_chunks', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  hash: text('hash').notNull(), data: jsonb('data').notNull(), byteSize: integer('byte_size').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.hash] }),
  check('artifact_chunks_hash_check', sql`${table.hash} ~ '^[a-f0-9]{64}$'`),
  check('artifact_chunks_size_check', sql`${table.byteSize} BETWEEN 1 AND 1048576`),
]);

export const artifactChunkEdges = pgTable('artifact_chunk_edges', {
  workspaceId: uuid('workspace_id').notNull(), parentHash: text('parent_hash').notNull(), childHash: text('child_hash').notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.parentHash, table.childHash] }),
  foreignKey({ name: 'artifact_chunk_edges_parent_fk', columns: [table.workspaceId, table.parentHash], foreignColumns: [artifactChunks.workspaceId, artifactChunks.hash] }).onDelete('cascade'),
  foreignKey({ name: 'artifact_chunk_edges_child_fk', columns: [table.workspaceId, table.childHash], foreignColumns: [artifactChunks.workspaceId, artifactChunks.hash] }),
  check('artifact_chunk_edges_not_self_check', sql`${table.parentHash} <> ${table.childHash}`),
]);

export const artifactContentManifests = pgTable('artifact_content_manifests', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), rootHash: text('root_hash').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('artifact_content_manifests_workspace_id_key').on(table.workspaceId, table.id),
  unique('artifact_content_manifests_workspace_hash_key').on(table.workspaceId, table.rootHash),
  unique('artifact_content_manifests_reference_key').on(table.workspaceId, table.id, table.rootHash),
  foreignKey({ name: 'artifact_content_manifests_root_fk', columns: [table.workspaceId, table.rootHash], foreignColumns: [artifactChunks.workspaceId, artifactChunks.hash] }),
]);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), projectId: uuid('project_id').notNull(),
  kind: text('kind').notNull(), schemaVersion: integer('schema_version').notNull(), currentRevision: integer('current_revision').notNull(),
  title: text('title').notNull(), status: text('status').notNull().default('draft'), accessClass: text('access_class').notNull().default('internal'),
  contentId: uuid('content_id').notNull(), contentHash: text('content_hash').notNull(),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id), createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
  trashedAt: instant('trashed_at'), trashPreviousStatus: text('trash_previous_status'),
}, (table) => [
  unique('artifacts_workspace_id_id_key').on(table.workspaceId, table.id),
  foreignKey({ name: 'artifacts_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  foreignKey({ name: 'artifacts_content_fk', columns: [table.workspaceId, table.contentId, table.contentHash], foreignColumns: [artifactContentManifests.workspaceId, artifactContentManifests.id, artifactContentManifests.rootHash] }),
  index('artifacts_project_updated_idx').on(table.workspaceId, table.projectId, table.updatedAt, table.id),
  index('artifacts_trash_idx').on(table.workspaceId, table.trashedAt),
  check('artifacts_kind_check', sql`${table.kind} IN ('document','table','design','plan')`),
  check('artifacts_schema_version_check', sql`${table.schemaVersion} > 0`),
  check('artifacts_revision_check', sql`${table.currentRevision} >= 0`),
  check('artifacts_title_check', sql`length(${table.title}) BETWEEN 1 AND 240`),
  check('artifacts_status_check', sql`${table.status} IN ('draft','in-review','approved','archived','trashed')`),
  check('artifacts_access_class_check', sql`${table.accessClass} IN ('internal','confidential')`),
  check('artifacts_trash_check', sql`(${table.status} = 'trashed' AND ${table.trashedAt} IS NOT NULL AND ${table.trashPreviousStatus} IS NOT NULL AND ${table.trashPreviousStatus} IN ('draft','in-review','approved','archived')) OR (${table.status} <> 'trashed' AND ${table.trashedAt} IS NULL AND ${table.trashPreviousStatus} IS NULL)`),
]);

export const artifactVersions = pgTable('artifact_versions', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), artifactId: uuid('artifact_id').notNull(), revision: integer('revision').notNull(),
  parentRevision: integer('parent_revision'), contentId: uuid('content_id').notNull(), contentHash: text('content_hash').notNull(), snapshotHash: text('snapshot_hash').notNull(),
  projectId: uuid('project_id').notNull(), title: text('title').notNull(), status: text('status').notNull(), schemaVersion: integer('schema_version').notNull(),
  reason: text('reason').notNull(), authorId: uuid('author_id').notNull().references(() => identityUsers.id), inputRevisions: jsonb('input_revisions').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('artifact_versions_revision_key').on(table.workspaceId, table.artifactId, table.revision),
  unique('artifact_versions_workspace_id_key').on(table.workspaceId, table.id),
  foreignKey({ name: 'artifact_versions_artifact_fk', columns: [table.workspaceId, table.artifactId], foreignColumns: [artifacts.workspaceId, artifacts.id] }).onDelete('cascade'),
  foreignKey({ name: 'artifact_versions_content_fk', columns: [table.workspaceId, table.contentId, table.contentHash], foreignColumns: [artifactContentManifests.workspaceId, artifactContentManifests.id, artifactContentManifests.rootHash] }),
  foreignKey({ name: 'artifact_versions_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  check('artifact_versions_revision_check', sql`${table.revision} >= 0 AND (${table.parentRevision} IS NULL OR ${table.parentRevision} < ${table.revision})`),
  check('artifact_versions_hash_check', sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
  check('artifact_versions_title_check', sql`length(${table.title}) BETWEEN 1 AND 240`),
  check('artifact_versions_status_check', sql`${table.status} IN ('draft','in-review','approved','archived','trashed')`),
  check('artifact_versions_schema_version_check', sql`${table.schemaVersion} > 0`),
  check('artifact_versions_reason_check', sql`length(${table.reason}) BETWEEN 1 AND 1000`),
  check('artifact_versions_input_revisions_check', sql`jsonb_typeof(${table.inputRevisions}) = 'object'`),
]);

export const artifactVersionPins = pgTable('artifact_version_pins', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), artifactId: uuid('artifact_id').notNull(), revision: integer('revision').notNull(),
  kind: text('kind').notNull(), retainerId: uuid('retainer_id').notNull(), holdingArtifactId: uuid('holding_artifact_id'), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('artifact_version_pins_retainer_key').on(table.workspaceId, table.kind, table.retainerId, table.artifactId, table.revision),
  foreignKey({ name: 'artifact_version_pins_version_fk', columns: [table.workspaceId, table.artifactId, table.revision], foreignColumns: [artifactVersions.workspaceId, artifactVersions.artifactId, artifactVersions.revision] }),
  foreignKey({ name: 'artifact_version_pins_holder_fk', columns: [table.workspaceId, table.holdingArtifactId], foreignColumns: [artifacts.workspaceId, artifacts.id] }).onDelete('cascade'),
  check('artifact_version_pins_kind_check', sql`${table.kind} IN ('branch','export','retained')`),
]);

export const artifactCommandGroups = pgTable('artifact_command_groups', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), id: uuid('id').notNull(), actorId: uuid('actor_id').notNull().references(() => identityUsers.id),
  bodyHash: text('body_hash').notNull(), origin: text('origin').notNull(), action: text('action').notNull().default('apply'), reason: text('reason').notNull(), changesetId: uuid('changeset_id'),
  committedRevisions: jsonb('committed_revisions').notNull(), isActive: boolean('is_active').notNull().default(true),
  undoneByGroupId: uuid('undone_by_group_id'), undoesGroupId: uuid('undoes_group_id'), redoesGroupId: uuid('redoes_group_id'), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  index('artifact_command_groups_recent_idx').on(table.workspaceId, table.createdAt, table.id),
  check('artifact_command_groups_hash_check', sql`${table.bodyHash} ~ '^[a-f0-9]{64}$'`),
  check('artifact_command_groups_origin_check', sql`${table.origin} IN ('human','ai','import')`),
  check('artifact_command_groups_action_check', sql`${table.action} IN ('apply','undo','redo')`),
  check('artifact_command_groups_reason_check', sql`length(${table.reason}) BETWEEN 1 AND 1000`),
  check('artifact_command_groups_revisions_check', sql`jsonb_typeof(${table.committedRevisions}) = 'object'`),
]);

export const artifactCommands = pgTable('artifact_commands', {
  workspaceId: uuid('workspace_id').notNull(), id: uuid('id').notNull(), groupId: uuid('group_id').notNull(), artifactId: uuid('artifact_id').notNull(),
  baseRevision: integer('base_revision').notNull(), revision: integer('revision').notNull(),
  operations: jsonb('operations').notNull(), inverseOperations: jsonb('inverse_operations').notNull(), beforeHashes: jsonb('before_hashes').notNull(), afterHashes: jsonb('after_hashes').notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique('artifact_commands_group_artifact_key').on(table.workspaceId, table.groupId, table.artifactId),
  foreignKey({ name: 'artifact_commands_group_fk', columns: [table.workspaceId, table.groupId], foreignColumns: [artifactCommandGroups.workspaceId, artifactCommandGroups.id] }),
  foreignKey({ name: 'artifact_commands_artifact_fk', columns: [table.workspaceId, table.artifactId], foreignColumns: [artifacts.workspaceId, artifacts.id] }).onDelete('cascade'),
  foreignKey({ name: 'artifact_commands_revision_fk', columns: [table.workspaceId, table.artifactId, table.revision], foreignColumns: [artifactVersions.workspaceId, artifactVersions.artifactId, artifactVersions.revision] }).onDelete('cascade'),
  index('artifact_commands_history_idx').on(table.workspaceId, table.artifactId, table.revision),
  check('artifact_commands_revision_check', sql`${table.baseRevision} >= 0 AND ${table.revision} = ${table.baseRevision} + 1`),
  check('artifact_commands_arrays_check', sql`jsonb_typeof(${table.operations}) = 'array' AND jsonb_typeof(${table.inverseOperations}) = 'array' AND jsonb_typeof(${table.beforeHashes}) = 'object' AND jsonb_typeof(${table.afterHashes}) = 'object'`),
]);

export const artifactOperationReceipts = pgTable('artifact_operation_receipts', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), actorId: uuid('actor_id').notNull().references(() => identityUsers.id), operationId: uuid('operation_id').notNull(),
  kind: text('kind').notNull(), bodyHash: text('body_hash').notNull(), result: jsonb('result').notNull(), createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.actorId, table.operationId] }),
  check('artifact_operation_receipts_hash_check', sql`${table.bodyHash} ~ '^[a-f0-9]{64}$'`),
]);

export const artifactTombstones = pgTable('artifact_tombstones', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), artifactId: uuid('artifact_id').notNull(),
  deletedBy: uuid('deleted_by').notNull().references(() => identityUsers.id), deletedAt: instant('deleted_at').notNull().defaultNow(),
  cleanupState: text('cleanup_state').notNull().default('pending'), cleanupAttempts: integer('cleanup_attempts').notNull().default(0), cleanupAfter: instant('cleanup_after').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.artifactId] }),
  check('artifact_tombstones_state_check', sql`${table.cleanupState} IN ('pending','complete')`),
  check('artifact_tombstones_attempts_check', sql`${table.cleanupAttempts} >= 0`),
  index('artifact_tombstones_cleanup_idx').on(table.cleanupState, table.cleanupAfter),
]);

export const workspaceEventHeads = pgTable('workspace_event_heads', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => identityWorkspaces.id),
  cursor: bigint('cursor', { mode: 'bigint' }).notNull().default(0n), retainedAfter: bigint('retained_after', { mode: 'bigint' }).notNull().default(0n),
}, (table) => [check('workspace_event_heads_cursor_check', sql`${table.cursor} >= ${table.retainedAfter} AND ${table.retainedAfter} >= 0`)]);

export const workspaceEvents = pgTable('workspace_events', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), cursor: bigint('cursor', { mode: 'bigint' }).notNull(),
  projectId: uuid('project_id').notNull(), accessClass: text('access_class').notNull().default('internal'),
  kind: text('kind').notNull(), objectId: uuid('object_id').notNull(), revision: integer('revision').notNull(), payload: jsonb('payload').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.cursor] }),
  foreignKey({ name: 'workspace_events_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  index('workspace_events_retention_idx').on(table.createdAt),
  check('workspace_events_cursor_check', sql`${table.cursor} > 0 AND ${table.revision} >= 0`),
  check('workspace_events_access_class_check', sql`${table.accessClass} IN ('internal','confidential')`),
  check('workspace_events_payload_check', sql`jsonb_typeof(${table.payload}) = 'object' AND octet_length(${table.payload}::text) <= 32768`),
]);
