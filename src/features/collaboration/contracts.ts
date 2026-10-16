import { z } from 'zod';
import { ElementIdSchema, IdSchema, InstantSchema, RevisionSchema } from '../../contracts/primitives';
import { AccessScopeSchema, AuthzVersionSchema, ScopeListSchema } from '../identity/contracts';

export const CollaborationTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('artifact') }),
  z.strictObject({ kind: z.literal('element'), elementId: ElementIdSchema }),
  z.strictObject({
    kind: z.literal('text-selection'),
    elementId: ElementIdSchema,
    anchor: z.number().int().nonnegative().max(10_000_000),
    focus: z.number().int().nonnegative().max(10_000_000),
    quote: z.string().max(2_000),
    quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]).superRefine((target, context) => {
  if (target.kind === 'text-selection') {
    if (target.anchor === target.focus) context.addIssue({ code: 'custom', message: 'A text selection must not be empty.' });
  }
});

export const ArtifactVersionCommentSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  artifactId: IdSchema,
  artifactRevision: RevisionSchema,
  parentId: IdSchema.nullable(),
  target: CollaborationTargetSchema,
  body: z.string().min(1).max(8_000),
  authorId: IdSchema,
  state: z.enum(['open', 'resolved']),
  resolvedBy: IdSchema.nullable(),
  resolvedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});

export const ArtifactVersionDecisionSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  artifactId: IdSchema,
  artifactRevision: RevisionSchema,
  decision: z.enum(['approved', 'changes_requested']),
  note: z.string().max(8_000),
  actorId: IdSchema,
  createdAt: InstantSchema,
});

export const CollaborationPermissionsSchema = z.strictObject({
  comment: z.boolean(),
  resolve: z.boolean(),
  requestChanges: z.boolean(),
  approve: z.boolean(),
});

const ArtifactVersionAddressSchema = z.strictObject({
  workspaceId: IdSchema,
  projectId: IdSchema,
  artifactId: IdSchema,
  artifactRevision: RevisionSchema,
});

export const ReadCollaborationSchema = ArtifactVersionAddressSchema;
export const CreateCommentSchema = ArtifactVersionAddressSchema.extend({
  parentId: IdSchema.nullable().default(null),
  target: CollaborationTargetSchema,
  body: z.string().trim().min(1).max(8_000),
  expectedAuthzVersion: AuthzVersionSchema,
});
export const ResolveCommentSchema = z.strictObject({
  workspaceId: IdSchema,
  expectedAuthzVersion: AuthzVersionSchema,
  resolved: z.boolean(),
});
export const CreateDecisionSchema = ArtifactVersionAddressSchema.extend({
  decision: z.enum(['approved', 'changes_requested']),
  note: z.string().trim().max(8_000).default(''),
  expectedAuthzVersion: AuthzVersionSchema,
});

export const CollaborationThreadSchema = z.strictObject({
  artifactId: IdSchema,
  artifactRevision: RevisionSchema,
  comments: z.array(ArtifactVersionCommentSchema).max(2_000),
  decisions: z.array(ArtifactVersionDecisionSchema).max(2_000),
  latestDecision: ArtifactVersionDecisionSchema.nullable(),
  permissions: CollaborationPermissionsSchema,
  authzVersion: AuthzVersionSchema,
});

export const ProjectAccessEntrySchema = z.strictObject({
  userId: IdSchema,
  name: z.string().min(1).max(120),
  email: z.email().max(254),
  membershipRole: z.enum(['owner', 'editor', 'reviewer']),
  membershipScopes: ScopeListSchema,
  projectScopes: ScopeListSchema.nullable(),
  effectiveScopes: z.array(AccessScopeSchema).max(6),
  canManage: z.boolean(),
});

export const ProjectAccessListSchema = z.strictObject({
  workspaceId: IdSchema,
  projectId: IdSchema,
  members: z.array(ProjectAccessEntrySchema).max(1_000),
  authzVersion: AuthzVersionSchema,
  canManage: z.boolean(),
});

export const ReadProjectAccessSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema });
export const SetProjectAccessSchema = z.strictObject({
  workspaceId: IdSchema,
  projectId: IdSchema,
  userId: IdSchema,
  scopes: ScopeListSchema.nullable(),
  expectedAuthzVersion: AuthzVersionSchema,
});

export type CollaborationTarget = z.infer<typeof CollaborationTargetSchema>;
export type ArtifactVersionComment = z.infer<typeof ArtifactVersionCommentSchema>;
export type ArtifactVersionDecision = z.infer<typeof ArtifactVersionDecisionSchema>;
export type CollaborationThread = z.infer<typeof CollaborationThreadSchema>;
export type ProjectAccessList = z.infer<typeof ProjectAccessListSchema>;
