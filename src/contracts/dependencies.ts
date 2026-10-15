import { z } from 'zod';
import { SourceRefSchema } from './artifacts';
import { RevisionVectorSchema, CommandOperationSchema } from './commands';
import { HashSchema, IdSchema, InstantSchema, RevisionSchema } from './primitives';

import { DependencyEdgeSchema, DependencyTargetSchema } from './dependency-edges';
export * from './dependency-edges';

export const DependencyGraphSchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema, revision: RevisionSchema,
  edges: z.array(DependencyEdgeSchema).max(1000),
});
export const RegisterDependenciesSchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema, expectedAuthzVersion: z.number().int().positive(),
  expectedGraphRevision: RevisionSchema.optional(), edges: z.array(DependencyEdgeSchema).min(1).max(1000),
});
export const DependencyReadSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema });
export const PrepareChangesSchema = DependencyReadSchema.extend({ expectedAuthzVersion: z.number().int().positive() });
export const DependencyIssueSchema = z.enum(['ready', 'unchanged', 'locked', 'overridden', 'manual', 'missing-input', 'missing-target', 'invalid-input', 'upstream-blocked']);
export const DependencyChangeSchema = z.strictObject({
  edgeId: IdSchema, groupId: IdSchema, target: DependencyTargetSchema, title: z.string().max(240), label: z.string().max(240),
  state: DependencyIssueSchema, before: z.json(), after: z.json().optional(),
  beforeHash: HashSchema.nullable(), reason: z.string().max(1000),
  operations: z.array(CommandOperationSchema).max(3), sourceRefs: z.array(SourceRefSchema).max(100),
});
export const DependencyProposalSchema = z.strictObject({
  preparedAt: InstantSchema,
  graphRevision: RevisionSchema, expectedArtifactRevisions: RevisionVectorSchema, expectedSourceRevisions: RevisionVectorSchema,
  sourceRefs: z.array(SourceRefSchema).max(10000),
  changes: z.array(DependencyChangeSchema).max(1000),
});
export const ChangeSetSchema = z.strictObject({
  id: IdSchema, workspaceId: IdSchema, projectId: IdSchema, createdBy: IdSchema, createdAt: InstantSchema,
  revision: RevisionSchema, state: z.enum(['ready', 'partially-applied', 'applied', 'rejected']),
  proposal: DependencyProposalSchema, acceptedGroupIds: z.array(IdSchema).max(1000), rejectedGroupIds: z.array(IdSchema).max(1000),
  commandGroupId: IdSchema.optional(),
});
export const ReviewChangesSchema = DependencyReadSchema.extend({
  expectedAuthzVersion: z.number().int().positive(), expectedRevision: RevisionSchema,
  groupIds: z.array(IdSchema).min(1).max(1000),
}).refine((body) => new Set(body.groupIds).size === body.groupIds.length, { message: 'Selected groups must be unique.' });
export type DependencyGraph = z.infer<typeof DependencyGraphSchema>;
export type DependencyChange = z.infer<typeof DependencyChangeSchema>;
export type DependencyProposal = z.infer<typeof DependencyProposalSchema>;
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
