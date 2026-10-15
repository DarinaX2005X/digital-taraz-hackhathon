import { z } from 'zod';
import { WorkspaceCursorSchema } from '../../contracts/events';
import { IdSchema, InstantSchema } from '../../contracts/primitives';
import { AuthzVersionSchema, ScopeListSchema } from '../identity/contracts';

export const ProjectSchema = z.strictObject({
  id: IdSchema, workspaceId: IdSchema, title: z.string().min(1).max(240), goal: z.string().max(12000).nullable(),
  status: z.enum(['active', 'archived', 'trashed']), revision: z.number().int().positive(), createdBy: IdSchema, createdAt: InstantSchema, updatedAt: InstantSchema,
});
export const CreateProjectSchema = z.strictObject({ workspaceId: IdSchema, title: z.string().trim().min(1).max(240), goal: z.string().trim().max(12000).nullable().default(null), expectedAuthzVersion: AuthzVersionSchema });
export const ProjectResultSchema = z.strictObject({ project: ProjectSchema, authzVersion: AuthzVersionSchema, cursor: WorkspaceCursorSchema, canEdit: z.boolean().optional() });
export const UpdateProjectSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: AuthzVersionSchema, expectedRevision: z.number().int().positive(), title: z.string().trim().min(1).max(240), goal: z.string().max(12000).nullable() });
export const ProjectLifecycleSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: AuthzVersionSchema, expectedRevision: z.number().int().positive() });
export const SetProjectGrantSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema, userId: IdSchema, scopes: ScopeListSchema.nullable(), expectedAuthzVersion: AuthzVersionSchema });
export const ProjectGrantResultSchema = z.strictObject({ projectId: IdSchema, userId: IdSchema, scopes: ScopeListSchema.nullable(), authzVersion: AuthzVersionSchema, cursor: WorkspaceCursorSchema });
export const ProjectListInputSchema = z.strictObject({ workspaceId: IdSchema, status: z.enum(['active', 'archived', 'trashed']).default('active'), order: z.enum(['updated', 'recent']).default('updated'), query: z.string().trim().max(200).default(''), after: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(), limit: z.number().int().min(1).max(50).default(30) });
export const ProjectListResultSchema = z.strictObject({ projects: z.array(ProjectSchema).max(50), authzVersion: AuthzVersionSchema, cursor: WorkspaceCursorSchema, nextAfter: z.string().nullable() });

export type Project = z.infer<typeof ProjectSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type ProjectResult = z.infer<typeof ProjectResultSchema>;
export type ProjectListInput = z.infer<typeof ProjectListInputSchema>;
export type ProjectListResult = z.infer<typeof ProjectListResultSchema>;
