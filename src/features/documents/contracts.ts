import { z } from 'zod';
import { IdSchema, HashSchema } from '@/contracts/primitives';
import { SourceRefSchema } from '@/contracts/artifacts';
import { ArtifactContentSchema } from '@/features/artifacts/contracts';

export const DocumentImportRequestSchema = z.strictObject({
  workspaceId: IdSchema, sourceId: IdSchema, uploadId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(), action: z.enum(['preview', 'create']),
  title: z.string().trim().min(1).max(240).optional(), previewHash: HashSchema.optional(),
}).refine((value) => value.action !== 'create' || value.previewHash !== undefined);
export const DocumentImportLossSchema = z.strictObject({ code: z.enum(['layout', 'unsupported-content', 'unsafe-link', 'image-omitted', 'table-flattened', 'formatting', 'tracked-changes', 'headers-footers', 'footnotes', 'embedded-object']), count: z.number().int().positive() });
export const DocumentImportPreviewSchema = z.strictObject({
  title: z.string(), projectId: IdSchema, sourceRef: SourceRefSchema,
  content: ArtifactContentSchema.refine((value) => value.kind === 'document'),
  losses: z.array(DocumentImportLossSchema), previewHash: HashSchema,
});
export type DocumentImportPreview = z.infer<typeof DocumentImportPreviewSchema>;
