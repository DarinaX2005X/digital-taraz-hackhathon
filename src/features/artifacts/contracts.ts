import { z } from 'zod';
import { ArtifactEnvelopeSchema, ArtifactKindSchema, ContentRefSchema, FieldBindingSchema, SourceRefSchema } from '../../contracts/artifacts';
import { CommandGroupInputSchema, RevisionVectorSchema } from '../../contracts/commands';
import { WorkspaceCursorSchema } from '../../contracts/events';
import { HashSchema, IdSchema, InstantSchema, RevisionSchema } from '../../contracts/primitives';
import { ArtifactContentSchema } from './domain/content-models';
import { TargetLocksSchema } from './domain/content-state';
import { ElementIdSchema } from '../../contracts/primitives';

export { ArtifactContentSchema } from './domain/content-models';
export type { ArtifactContent } from './domain/content-models';
export { TargetLockSchema, TargetLocksSchema } from './domain/content-state';
export const ArtifactAccessClassSchema = z.enum(['internal', 'confidential']);
export const ArtifactViewerSchema = z.strictObject({ userId: IdSchema, workspaceId: IdSchema, authzVersion: z.number().int().positive() });
export const ArtifactAccessRequestSchema = z.strictObject({ workspaceId: IdSchema, artifactIds: z.array(IdSchema).min(1).max(100) }).refine((value) => new Set(value.artifactIds).size === value.artifactIds.length);
export const ArtifactAccessResultSchema = z.strictObject({ viewer: ArtifactViewerSchema, authorizedArtifactIds: z.array(IdSchema).max(100), editableArtifactIds: z.array(IdSchema).max(100), unavailableArtifactIds: z.array(IdSchema).max(100) }).superRefine((result, context) => {
  const allowed = new Set(result.authorizedArtifactIds), denied = new Set(result.unavailableArtifactIds);
  if (allowed.size !== result.authorizedArtifactIds.length || denied.size !== result.unavailableArtifactIds.length || allowed.size + denied.size > 100 || [...denied].some((id) => allowed.has(id)) || new Set(result.editableArtifactIds).size !== result.editableArtifactIds.length || result.editableArtifactIds.some((id) => !allowed.has(id))) context.addIssue({ code: 'custom', message: 'Access decisions must be unique, disjoint and scoped to authorized artifacts.' });
});
export const ArtifactPermissionsSchema = z.strictObject({ edit: z.boolean(), rename: z.boolean(), duplicate: z.boolean(), move: z.boolean(), archive: z.boolean(), trash: z.boolean(), restore: z.boolean(), purge: z.boolean() });
export const ArtifactBranchParentSchema = z.strictObject({ artifactId: IdSchema, revision: RevisionSchema, versionId: IdSchema });
export const SourceFreshnessSchema = z.strictObject({
  sourceRef: SourceRefSchema,
  status: z.enum(['current', 'stale', 'unknown']),
  sourceStatus: z.enum(['current', 'stale', 'unknown']),
  factStatus: z.enum(['current', 'stale', 'unknown']).optional(),
  currentVersionId: IdSchema.optional(), currentRevision: RevisionSchema.optional(),
}).superRefine((freshness, context) => {
  if (freshness.sourceStatus === 'unknown' && (freshness.currentVersionId !== undefined || freshness.currentRevision !== undefined)) context.addIssue({ code: 'custom', message: 'An unknown source must not disclose a current head.' });
  if (freshness.status === 'current' && (freshness.sourceStatus !== 'current' || freshness.factStatus === 'unknown' || freshness.factStatus === 'stale')) context.addIssue({ code: 'custom', message: 'Every authoritative dimension must be current.' });
});
export const ArtifactVersionSchema = z.strictObject({
  id: IdSchema, artifactId: IdSchema, revision: RevisionSchema, parentRevision: RevisionSchema.nullable(),
  contentRef: ContentRefSchema, snapshotHash: HashSchema, title: z.string().min(1).max(240),
  reason: z.string().min(1).max(1000), authorId: IdSchema, authorName: z.string().min(1).max(160).optional(), createdAt: InstantSchema, inputRevisions: RevisionVectorSchema,
  branchParent: ArtifactBranchParentSchema.optional(), branchParentUnavailable: z.literal(true).optional(),
});
export const ArtifactHistoryGroupSchema = z.strictObject({
  commandGroupId: IdSchema, actorId: IdSchema, actorName: z.string().min(1).max(160).optional(), reason: z.string().min(1).max(1000), origin: z.enum(['human', 'ai', 'import']), createdAt: InstantSchema,
  state: z.enum(['active', 'undone']), committedRevisionVector: RevisionVectorSchema,
  artifacts: z.array(z.strictObject({ artifactId: IdSchema, title: z.string().min(1).max(240), kind: ArtifactKindSchema, committedRevision: RevisionSchema, currentRevision: RevisionSchema })).min(1).max(100),
  hasUnavailableArtifacts: z.boolean(), canUndo: z.boolean(), canRedo: z.boolean(),
  undoneByGroupId: IdSchema.optional(), undoesGroupId: IdSchema.optional(), redoesGroupId: IdSchema.optional(),
  expectedSourceRevisions: RevisionVectorSchema.optional(),
}).superRefine((group, context) => {
  const ids = new Set(group.artifacts.map((artifact) => artifact.artifactId));
  if (ids.size !== group.artifacts.length || Object.keys(group.committedRevisionVector).length !== ids.size || group.artifacts.some((artifact) => group.committedRevisionVector[artifact.artifactId] !== artifact.committedRevision)) context.addIssue({ code: 'custom', message: 'History revisions must match the visible artifacts exactly.' });
  if ((group.state === 'active' && group.canRedo) || (group.state === 'undone' && group.canUndo) || (group.hasUnavailableArtifacts && (group.canUndo || group.canRedo))) context.addIssue({ code: 'custom', message: 'The history state does not permit this action.' });
});
export const ArtifactHistorySchema = z.strictObject({ viewer: ArtifactViewerSchema, artifactId: IdSchema, groups: z.array(ArtifactHistoryGroupSchema).max(100), cursor: WorkspaceCursorSchema });
export const ArtifactSnapshotSchema = z.strictObject({
  viewer: ArtifactViewerSchema, artifact: ArtifactEnvelopeSchema, content: ArtifactContentSchema, version: ArtifactVersionSchema,
  permissions: ArtifactPermissionsSchema, sourceFreshness: z.array(SourceFreshnessSchema).max(1000), history: z.array(ArtifactHistoryGroupSchema).max(100), cursor: WorkspaceCursorSchema,
  locks: TargetLocksSchema.optional(), missingTargets: z.array(ElementIdSchema).max(10000).optional(),
}).superRefine((snapshot, context) => {
  if (snapshot.viewer.workspaceId !== snapshot.artifact.workspaceId || snapshot.version.artifactId !== snapshot.artifact.id || snapshot.version.revision !== snapshot.artifact.currentRevision || snapshot.content.kind !== snapshot.artifact.kind || snapshot.content.schemaVersion !== snapshot.artifact.schemaVersion || snapshot.version.contentRef.id !== snapshot.artifact.contentRef.id || snapshot.version.contentRef.hash !== snapshot.artifact.contentRef.hash) context.addIssue({ code: 'custom', message: 'Snapshot identity and revision must agree.' });
});
export const CommandReceiptSchema = z.strictObject({
  commandGroupId: IdSchema, committedRevisionVector: RevisionVectorSchema,
  artifacts: z.array(z.strictObject({ artifactId: IdSchema, revision: RevisionSchema, versionId: IdSchema, contentRef: ContentRefSchema })).min(1).max(100),
  cursor: WorkspaceCursorSchema, historyGroup: ArtifactHistoryGroupSchema,
}).superRefine((receipt, context) => {
  const ids = new Set(receipt.artifacts.map((artifact) => artifact.artifactId));
  const revisions = receipt.committedRevisionVector;
  const historyRevisions = receipt.historyGroup.committedRevisionVector;
  if (ids.size !== receipt.artifacts.length || Object.keys(revisions).length !== ids.size || receipt.artifacts.some((artifact) => revisions[artifact.artifactId] !== artifact.revision)) context.addIssue({ code: 'custom', message: 'The receipt must contain exactly the committed revision vector.' });
  if (receipt.commandGroupId !== receipt.historyGroup.commandGroupId || Object.keys(historyRevisions).length !== ids.size || [...ids].some((id) => historyRevisions[id] !== revisions[id])) context.addIssue({ code: 'custom', message: 'Receipt and history must describe the same committed group.' });
});
export const ArtifactCommandRequestSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive(), group: CommandGroupInputSchema });
export const ArtifactHistoryActionSchema = z.strictObject({
  workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive(), commandGroupId: IdSchema, targetCommandGroupId: IdSchema,
  expectedArtifactRevisions: RevisionVectorSchema, expectedSourceRevisions: RevisionVectorSchema,
});
export const CreateArtifactSchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema, expectedAuthzVersion: z.number().int().positive(), title: z.string().trim().min(1).max(240),
  content: ArtifactContentSchema, accessClass: ArtifactAccessClassSchema.default('internal'), sourceRefs: z.array(SourceRefSchema).max(1000).default([]), bindings: z.array(FieldBindingSchema).max(10000).default([]),
});
export const ArtifactMutationSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive(), baseRevision: RevisionSchema });
export const RenameArtifactSchema = ArtifactMutationSchema.extend({ title: z.string().trim().min(1).max(240) });
export const MoveArtifactSchema = ArtifactMutationSchema.extend({ projectId: IdSchema });
export const DuplicateArtifactSchema = ArtifactMutationSchema.extend({ projectId: IdSchema, title: z.string().trim().min(1).max(240), revision: RevisionSchema.optional() });
export const BranchArtifactSchema = ArtifactMutationSchema.extend({ projectId: IdSchema, title: z.string().trim().min(1).max(240), parentRevision: RevisionSchema, content: ArtifactContentSchema.optional() });
export const RestoreArtifactVersionSchema = ArtifactMutationSchema.extend({ revision: RevisionSchema, reason: z.string().trim().min(1).max(1000) });
export const PurgeArtifactSchema = ArtifactMutationSchema.extend({ confirmationTitle: z.string().min(1).max(240), immediate: z.boolean() });
export const ArtifactMutationResultSchema = z.strictObject({ viewer: ArtifactViewerSchema, artifact: ArtifactEnvelopeSchema, version: ArtifactVersionSchema, cursor: WorkspaceCursorSchema });
export const ArtifactVersionPageSchema = z.strictObject({ viewer: ArtifactViewerSchema, artifactId: IdSchema, versions: z.array(ArtifactVersionSchema).max(50), nextBeforeRevision: RevisionSchema.nullable() });
export const ArtifactVersionDetailSchema = z.strictObject({ viewer: ArtifactViewerSchema, artifact: ArtifactEnvelopeSchema, version: ArtifactVersionSchema, content: ArtifactContentSchema, sourceFreshness: z.array(SourceFreshnessSchema).max(1000), locks: TargetLocksSchema.optional(), missingTargets: z.array(ElementIdSchema).max(10000).optional(), headRevision: RevisionSchema.optional() }).superRefine((detail, context) => {
  if (detail.artifact.id !== detail.version.artifactId || detail.artifact.currentRevision !== detail.version.revision || detail.artifact.contentRef.id !== detail.version.contentRef.id || detail.artifact.contentRef.hash !== detail.version.contentRef.hash || detail.content.kind !== detail.artifact.kind) context.addIssue({ code: 'custom', message: 'Historical content and metadata must describe the selected version.' });
});
export const ArtifactPurgeResultSchema = z.strictObject({ viewer: ArtifactViewerSchema, artifactId: IdSchema, deletedAt: InstantSchema, cleanupPending: z.boolean(), cursor: WorkspaceCursorSchema });

export type ArtifactViewer = z.infer<typeof ArtifactViewerSchema>;
export type ArtifactAccessRequest = z.infer<typeof ArtifactAccessRequestSchema>;
export type ArtifactAccessResult = z.infer<typeof ArtifactAccessResultSchema>;
export type ArtifactPermissions = z.infer<typeof ArtifactPermissionsSchema>;
export type SourceFreshness = z.infer<typeof SourceFreshnessSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
export type ArtifactHistoryGroup = z.infer<typeof ArtifactHistoryGroupSchema>;
export type ArtifactHistory = z.infer<typeof ArtifactHistorySchema>;
export type ArtifactSnapshot = z.infer<typeof ArtifactSnapshotSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;
export type ArtifactCommandRequest = z.infer<typeof ArtifactCommandRequestSchema>;
export type ArtifactHistoryAction = z.infer<typeof ArtifactHistoryActionSchema>;
export type CreateArtifact = z.infer<typeof CreateArtifactSchema>;
export type ArtifactMutation = z.infer<typeof ArtifactMutationSchema>;
export type ArtifactMutationResult = z.infer<typeof ArtifactMutationResultSchema>;
export type ArtifactVersionPage = z.infer<typeof ArtifactVersionPageSchema>;
export type ArtifactVersionDetail = z.infer<typeof ArtifactVersionDetailSchema>;
