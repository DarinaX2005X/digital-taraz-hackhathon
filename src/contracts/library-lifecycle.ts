import { z } from 'zod';
import { HashSchema, IdSchema, InstantSchema, RevisionSchema } from './primitives';

export const LibraryObjectKindSchema = z.enum(['source', 'collection']);
export const LibraryLifecycleStateSchema = z.enum(['active', 'archived', 'trashed']);
export const LibraryLifecycleActionSchema = z.enum(['rename', 'move', 'duplicate', 'trash', 'restore']);
export const LibraryLifecycleOperationSchema = z.enum([
  'source.rename', 'source.move', 'source.duplicate', 'source.trash', 'source.restore',
  'collection.rename', 'collection.move', 'collection.duplicate', 'collection.trash', 'collection.restore',
]);
export const LibraryMetadataRevisionSchema = z.number().int().min(1).max(2_147_483_647);

const LibraryLifecycleCommandBaseSchema = z.strictObject({
  objectKind: LibraryObjectKindSchema,
  workspaceId: IdSchema,
  objectId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(),
  expectedMetadataRevision: LibraryMetadataRevisionSchema,
});

export const RenameLibraryItemCommandSchema = LibraryLifecycleCommandBaseSchema.extend({
  action: z.literal('rename'),
  title: z.string().trim().min(1).max(240),
});
export const MoveLibraryItemCommandSchema = LibraryLifecycleCommandBaseSchema.extend({
  action: z.literal('move'),
  destinationProjectId: IdSchema,
});
export const DuplicateLibraryItemCommandSchema = LibraryLifecycleCommandBaseSchema.extend({
  action: z.literal('duplicate'),
  destinationProjectId: IdSchema,
  title: z.string().trim().min(1).max(240),
  // A duplicate gets a new object identity and an independent head. The server
  // may share immutable bytes/chunks only after authorizing both projects in
  // the same workspace; later metadata/content changes never follow the origin.
  contentPolicy: z.literal('fork-current'),
});
export const TrashLibraryItemCommandSchema = LibraryLifecycleCommandBaseSchema.extend({ action: z.literal('trash') });
export const RestoreLibraryItemCommandSchema = LibraryLifecycleCommandBaseSchema.extend({ action: z.literal('restore') });

export const LibraryLifecycleCommandSchema = z.discriminatedUnion('action', [
  RenameLibraryItemCommandSchema,
  MoveLibraryItemCommandSchema,
  DuplicateLibraryItemCommandSchema,
  TrashLibraryItemCommandSchema,
  RestoreLibraryItemCommandSchema,
]);

export const LibraryLifecycleMutationRequestSchema = z.strictObject({
  operationId: IdSchema,
  command: LibraryLifecycleCommandSchema,
});

export const LibraryItemMetadataSchema = z.strictObject({
  kind: LibraryObjectKindSchema,
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1).max(240),
  lifecycleState: LibraryLifecycleStateSchema,
  metadataRevision: LibraryMetadataRevisionSchema,
  contentRevision: RevisionSchema,
  trashedAt: InstantSchema.nullable(),
  restoreState: LibraryLifecycleStateSchema.exclude(['trashed']).nullable(),
  updatedAt: InstantSchema,
});

export const LibraryLifecycleReceiptSchema = z.strictObject({
  operationId: IdSchema,
  operation: LibraryLifecycleOperationSchema,
  bodyHash: HashSchema,
  committedAt: InstantSchema,
  expiresAt: InstantSchema,
});

export const LibraryLifecycleResultSchema = z.strictObject({
  item: LibraryItemMetadataSchema,
  previous: LibraryItemMetadataSchema.nullable(),
  changed: z.boolean(),
  receipt: LibraryLifecycleReceiptSchema,
});

export const LibraryLifecycleConflictSchema = z.strictObject({
  kind: z.literal('metadata-revision'),
  objectKind: LibraryObjectKindSchema,
  objectId: IdSchema,
  expectedMetadataRevision: LibraryMetadataRevisionSchema,
  currentMetadataRevision: LibraryMetadataRevisionSchema,
  current: LibraryItemMetadataSchema,
});

export function libraryLifecycleOperation(kind: LibraryObjectKind, action: LibraryLifecycleAction): LibraryLifecycleOperation {
  return LibraryLifecycleOperationSchema.parse(`${kind}.${action}`);
}

export type LibraryObjectKind = z.infer<typeof LibraryObjectKindSchema>;
export type LibraryLifecycleState = z.infer<typeof LibraryLifecycleStateSchema>;
export type LibraryLifecycleAction = z.infer<typeof LibraryLifecycleActionSchema>;
export type LibraryLifecycleOperation = z.infer<typeof LibraryLifecycleOperationSchema>;
export type LibraryLifecycleCommand = z.infer<typeof LibraryLifecycleCommandSchema>;
export type LibraryLifecycleMutationRequest = z.infer<typeof LibraryLifecycleMutationRequestSchema>;
export type LibraryItemMetadata = z.infer<typeof LibraryItemMetadataSchema>;
export type LibraryLifecycleReceipt = z.infer<typeof LibraryLifecycleReceiptSchema>;
export type LibraryLifecycleResult = z.infer<typeof LibraryLifecycleResultSchema>;
export type LibraryLifecycleConflict = z.infer<typeof LibraryLifecycleConflictSchema>;
