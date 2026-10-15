import { z } from 'zod';
import { ElementIdSchema, IdSchema, InstantSchema, RevisionSchema } from './primitives';

// The wire cursor is opaque; its decoded position is scoped to current access.
export const WorkspaceCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
export const WorkspaceCursorPositionSchema = z.strictObject({
  workspaceId: IdSchema,
  authzVersion: z.number().int().positive(),
  position: z.string().regex(/^(0|[1-9]\d{0,18})$/),
});
export const WorkspaceEventKindSchema = z.enum([
  'project.created', 'project.changed', 'project.access-changed',
  'source.changed', 'source.unavailable',
  'collection.changed',
  'artifact.created', 'artifact.changed', 'artifact.moved', 'artifact.archived',
  'artifact.trashed', 'artifact.restored', 'artifact.purged',
]);
export const WorkspaceEventPayloadSchema = z.strictObject({
  commandGroupId: IdSchema.optional(),
  changedTargetIds: z.array(ElementIdSchema).max(100).optional(),
  moreTargets: z.boolean().optional(),
  resolutionId: IdSchema.optional(),
  resolutionKind: z.enum(['import', 'correction', 'undo']).optional(),
});
export const WorkspaceEventSchema = z.strictObject({
  cursor: WorkspaceCursorSchema,
  projectId: IdSchema.optional(),
  kind: WorkspaceEventKindSchema,
  objectId: IdSchema,
  revision: RevisionSchema,
  payload: WorkspaceEventPayloadSchema,
  createdAt: InstantSchema,
});
export const WorkspaceEventPageSchema = z.strictObject({
  workspaceId: IdSchema,
  cursor: WorkspaceCursorSchema,
  events: z.array(WorkspaceEventSchema).max(100),
  hasMore: z.boolean(),
  resetRequired: z.boolean(),
});

export type WorkspaceCursorPosition = z.infer<typeof WorkspaceCursorPositionSchema>;
export type WorkspaceEventKind = z.infer<typeof WorkspaceEventKindSchema>;
export type WorkspaceEventPayload = z.infer<typeof WorkspaceEventPayloadSchema>;
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;
export type WorkspaceEventPage = z.infer<typeof WorkspaceEventPageSchema>;
