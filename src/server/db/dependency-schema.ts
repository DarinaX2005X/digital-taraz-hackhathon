import { foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { identityUsers, identityWorkspaces } from './identity-schema';
import { projects } from './project-schema';
import { artifactCommandGroups } from './artifact-schema';

export const dependencyOperations = pgTable('dependency_operations', {
  workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), actorId: uuid('actor_id').notNull().references(() => identityUsers.id), operationId: uuid('operation_id').notNull(), operation: text('operation').notNull(), bodyHash: text('body_hash').notNull(), result: jsonb('result').notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.actorId, t.operationId] })]);
export const dependencyCommandEffects = pgTable('dependency_command_effects', {
  workspaceId: uuid('workspace_id').notNull(), commandGroupId: uuid('command_group_id').notNull(), projectId: uuid('project_id').notNull(), effects: jsonb('effects').notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.commandGroupId, t.projectId] }), foreignKey({ columns: [t.workspaceId, t.commandGroupId], foreignColumns: [artifactCommandGroups.workspaceId, artifactCommandGroups.id] }), foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] })]);

export const dependencyGraphs = pgTable('dependency_graphs', {
  workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(), revision: integer('revision').notNull(), edges: jsonb('edges').notNull(), updatedBy: uuid('updated_by').notNull().references(() => identityUsers.id), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.projectId] }), foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] })]);
export const dependencyChangesets = pgTable('dependency_changesets', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(), createdBy: uuid('created_by').notNull().references(() => identityUsers.id), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), revision: integer('revision').notNull().default(0), state: text('state').notNull(), proposal: jsonb('proposal').notNull(), acceptedGroupIds: uuid('accepted_group_ids').array().notNull().default([]), rejectedGroupIds: uuid('rejected_group_ids').array().notNull().default([]), commandGroupId: uuid('command_group_id'),
}, (t) => [unique().on(t.workspaceId, t.id), foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id] }), foreignKey({ columns: [t.workspaceId, t.commandGroupId], foreignColumns: [artifactCommandGroups.workspaceId, artifactCommandGroups.id] }), index('dependency_changesets_project_idx').on(t.workspaceId, t.projectId, t.createdAt, t.id)]);
