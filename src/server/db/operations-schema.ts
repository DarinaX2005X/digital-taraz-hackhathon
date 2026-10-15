import { sql } from 'drizzle-orm';

import { check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { SourceRef } from '@/contracts/artifacts';
import { identityMemberships, identityUsers, identityWorkspaces } from '@/server/db/identity-schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const workResources = pgTable('work_resources', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  displayName: text('display_name').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('active'),
  membershipId: uuid('membership_id'),
  timezone: text('timezone').notNull(),
  accessClass: text('access_class').notNull().default('internal'),
  notes: text('notes'),
  revision: integer('revision').notNull().default(1),
  currentAvailabilityVersionId: uuid('current_availability_version_id'),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('work_resources_workspace_id_id_key').on(table.workspaceId, table.id),
  foreignKey({ name: 'work_resources_membership_fk', columns: [table.workspaceId, table.membershipId], foreignColumns: [identityMemberships.workspaceId, identityMemberships.id] }),
  index('work_resources_list_idx').on(table.workspaceId, table.status, table.updatedAt, table.id),
  check('work_resources_name_check', sql`length(btrim(${table.displayName})) BETWEEN 1 AND 160`),
  check('work_resources_kind_check', sql`${table.kind} IN ('person','equipment','place','other')`),
  check('work_resources_status_check', sql`${table.status} IN ('active','archived')`),
  check('work_resources_access_check', sql`${table.accessClass} IN ('internal','confidential')`),
  check('work_resources_timezone_check', sql`length(${table.timezone}) BETWEEN 1 AND 80`),
  check('work_resources_revision_check', sql`${table.revision} > 0`),
  check('work_resources_notes_check', sql`${table.notes} IS NULL OR length(${table.notes}) <= 4000`),
]);

export const workResourceVersions = pgTable('work_resource_versions', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  resourceId: uuid('resource_id').notNull(),
  revision: integer('revision').notNull(),
  displayName: text('display_name').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  currentAvailabilityVersionId: uuid('current_availability_version_id'),
  membershipId: uuid('membership_id'),
  timezone: text('timezone').notNull(),
  accessClass: text('access_class').notNull(),
  notes: text('notes'),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('work_resource_versions_resource_revision_key').on(table.workspaceId, table.resourceId, table.revision),
  foreignKey({ name: 'work_resource_versions_resource_fk', columns: [table.workspaceId, table.resourceId], foreignColumns: [workResources.workspaceId, workResources.id] }),
  foreignKey({ name: 'work_resource_versions_membership_fk', columns: [table.workspaceId, table.membershipId], foreignColumns: [identityMemberships.workspaceId, identityMemberships.id] }),
  check('work_resource_versions_revision_check', sql`${table.revision} > 0`),
  check('work_resource_versions_name_check', sql`length(btrim(${table.displayName})) BETWEEN 1 AND 160`),
  check('work_resource_versions_kind_check', sql`${table.kind} IN ('person','equipment','place','other')`),
  check('work_resource_versions_status_check', sql`${table.status} IN ('active','archived')`),
  check('work_resource_versions_access_check', sql`${table.accessClass} IN ('internal','confidential')`),
]);

export const availabilityVersions = pgTable('availability_versions', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  resourceId: uuid('resource_id').notNull(),
  revision: integer('revision').notNull(),
  timezone: text('timezone').notNull(),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  sourceRefs: jsonb('source_refs').$type<SourceRef[]>().notNull().default(sql`'[]'::jsonb`),
  verifiedAt: instant('verified_at'),
  note: text('note'),
  createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  unique('availability_versions_workspace_id_id_key').on(table.workspaceId, table.id),
  unique('availability_versions_resource_revision_key').on(table.workspaceId, table.resourceId, table.revision),
  foreignKey({ name: 'availability_versions_resource_fk', columns: [table.workspaceId, table.resourceId], foreignColumns: [workResources.workspaceId, workResources.id] }),
  index('availability_versions_resource_idx').on(table.workspaceId, table.resourceId, table.revision),
  check('availability_versions_revision_check', sql`${table.revision} > 0`),
  check('availability_versions_effective_check', sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
  check('availability_versions_sources_check', sql`jsonb_typeof(${table.sourceRefs}) = 'array' AND jsonb_array_length(${table.sourceRefs}) <= 100`),
  check('availability_versions_note_check', sql`${table.note} IS NULL OR length(${table.note}) <= 4000`),
]);

export const availabilityWeekIntervals = pgTable('availability_week_intervals', {
  availabilityVersionId: uuid('availability_version_id').notNull().references(() => availabilityVersions.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  ordinal: integer('ordinal').notNull(),
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
}, (table) => [
  primaryKey({ columns: [table.availabilityVersionId, table.weekday, table.ordinal] }),
  check('availability_week_intervals_weekday_check', sql`${table.weekday} BETWEEN 1 AND 7`),
  check('availability_week_intervals_ordinal_check', sql`${table.ordinal} BETWEEN 0 AND 23`),
  check('availability_week_intervals_range_check', sql`${table.startMinute} BETWEEN 0 AND 1439 AND ${table.endMinute} BETWEEN 1 AND 1440 AND ${table.startMinute} < ${table.endMinute}`),
]);

export const availabilityExceptions = pgTable('availability_exceptions', {
  availabilityVersionId: uuid('availability_version_id').notNull().references(() => availabilityVersions.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  label: text('label'),
}, (table) => [
  primaryKey({ columns: [table.availabilityVersionId, table.date] }),
  check('availability_exceptions_label_check', sql`${table.label} IS NULL OR length(btrim(${table.label})) BETWEEN 1 AND 240`),
]);

export const availabilityExceptionIntervals = pgTable('availability_exception_intervals', {
  availabilityVersionId: uuid('availability_version_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  ordinal: integer('ordinal').notNull(),
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
}, (table) => [
  primaryKey({ columns: [table.availabilityVersionId, table.date, table.ordinal] }),
  foreignKey({ name: 'availability_exception_intervals_exception_fk', columns: [table.availabilityVersionId, table.date], foreignColumns: [availabilityExceptions.availabilityVersionId, availabilityExceptions.date] }).onDelete('cascade'),
  check('availability_exception_intervals_ordinal_check', sql`${table.ordinal} BETWEEN 0 AND 23`),
  check('availability_exception_intervals_range_check', sql`${table.startMinute} BETWEEN 0 AND 1439 AND ${table.endMinute} BETWEEN 1 AND 1440 AND ${table.startMinute} < ${table.endMinute}`),
]);

export const operationsIdempotency = pgTable('operations_idempotency', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id),
  actorId: uuid('actor_id').notNull().references(() => identityUsers.id),
  operationId: uuid('operation_id').notNull(),
  kind: text('kind').notNull(),
  bodyHash: text('body_hash').notNull(),
  result: jsonb('result').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  expiresAt: instant('expires_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.actorId, table.operationId] }),
  index('operations_idempotency_expiry_idx').on(table.expiresAt),
  check('operations_idempotency_kind_check', sql`length(${table.kind}) BETWEEN 1 AND 80`),
  check('operations_idempotency_hash_check', sql`${table.bodyHash} ~ '^[a-f0-9]{64}$'`),
  check('operations_idempotency_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
]);

