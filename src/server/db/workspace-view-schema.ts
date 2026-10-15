import { foreignKey, index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { identityUsers } from './identity-schema';
import { projects } from './project-schema';
import { artifacts } from './artifact-schema';

export const workspaceProjectViews = pgTable('workspace_project_views', {
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  userId: uuid('user_id').notNull().references(() => identityUsers.id, { onDelete: 'cascade' }),
  selectedArtifactId: uuid('selected_artifact_id'),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.projectId, table.userId] }),
  foreignKey({ columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }).onDelete('cascade'),
  // SQL owns column-scoped SET NULL; Drizzle cannot express that FK action.
  foreignKey({ columns: [table.workspaceId, table.selectedArtifactId], foreignColumns: [artifacts.workspaceId, artifacts.id] }),
  index('workspace_project_views_recent_idx').on(table.workspaceId, table.userId, table.lastOpenedAt.desc(), table.projectId.desc()),
]);
