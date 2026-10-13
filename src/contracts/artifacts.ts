import { z } from 'zod';
import { ElementIdSchema, HashSchema, IdSchema, InstantSchema, RevisionSchema } from './primitives';

export const ArtifactKindSchema = z.enum(['table', 'document', 'design', 'plan']);
export const SourceRefSchema = z.strictObject({
  sourceId: IdSchema,
  sourceVersionId: IdSchema,
  revision: RevisionSchema,
  fragmentId: IdSchema.optional(),
  collectionId: IdSchema.optional(),
  recordId: IdSchema.optional(),
  fieldId: ElementIdSchema.optional(),
  factRevision: RevisionSchema.optional(),
}).refine((ref) => {
  const fields = [ref.collectionId, ref.recordId, ref.fieldId, ref.factRevision];
  return fields.every((field) => field === undefined) || fields.every((field) => field !== undefined);
}, { message: 'A record binding requires collection, record, field and fact revision.' });

export const FieldBindingSchema = z.strictObject({
  targetElementId: ElementIdSchema,
  sourceRef: SourceRefSchema,
  transformId: ElementIdSchema,
  updateMode: z.enum(['deterministic', 'propose', 'manual']),
  override: z.strictObject({ reason: z.string().min(1).max(1000), actorId: IdSchema, at: InstantSchema }).optional(),
  lock: z.strictObject({ reason: z.string().min(1).max(1000), actorId: IdSchema, at: InstantSchema }).optional(),
});

export const ContentRefSchema = z.strictObject({ id: IdSchema, hash: HashSchema });
export const ArtifactEnvelopeSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  kind: ArtifactKindSchema,
  schemaVersion: z.number().int().positive(),
  currentRevision: RevisionSchema,
  title: z.string().trim().min(1).max(240),
  status: z.enum(['draft', 'in-review', 'approved', 'archived', 'trashed']),
  contentRef: ContentRefSchema,
  sourceRefs: z.array(SourceRefSchema).max(1000),
  bindings: z.array(FieldBindingSchema).max(10000),
  createdBy: IdSchema,
  updatedAt: InstantSchema,
});
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactEnvelope = z.infer<typeof ArtifactEnvelopeSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type FieldBinding = z.infer<typeof FieldBindingSchema>;
