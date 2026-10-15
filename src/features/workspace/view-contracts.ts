import { z } from 'zod';
import { IdSchema, InstantSchema } from '@/contracts/primitives';
import { AuthzVersionSchema } from '@/features/identity/contracts';

export const ProjectViewSchema = z.strictObject({ projectId: IdSchema, workspaceId: IdSchema, selectedArtifactId: IdSchema.nullable(), lastOpenedAt: InstantSchema.nullable() });
export const RecordProjectViewSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: AuthzVersionSchema, selectedArtifactId: IdSchema.nullable().optional() });
export type ProjectView = z.infer<typeof ProjectViewSchema>;
