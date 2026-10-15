import { z } from 'zod';
import { IdSchema, InstantSchema, HashSchema } from './primitives';

export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const SourceFormatSchema = z.enum(['text', 'csv', 'tsv', 'xlsx', 'docx', 'pdf', 'png', 'jpeg', 'webp']);
export const SourceUploadStatusSchema = z.enum(['pending', 'uploading', 'uploaded', 'processing', 'ready', 'partial', 'failed', 'cancelled']);
export const SourceOptionsSchema = z.strictObject({ delimiter: z.enum([',', ';', '\t']).optional(), encoding: z.enum(['utf-8', 'windows-1251']).default('utf-8') });
export const InitSourceUploadSchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema, sourceId: IdSchema.optional(),
  expectedRevision: z.number().int().nonnegative().default(0),
  title: z.string().trim().min(1).max(240), fileName: z.string().trim().min(1).max(240),
  size: z.number().int().min(1).max(SOURCE_MAX_BYTES), format: SourceFormatSchema,
  accessClass: z.enum(['internal', 'confidential']).default('internal'), options: SourceOptionsSchema.default({ encoding: 'utf-8' }),
});
export const SourceSummarySchema = z.strictObject({
  id: IdSchema, workspaceId: IdSchema, projectId: IdSchema, title: z.string(), accessClass: z.enum(['internal', 'confidential']),
  revision: z.number().int().nonnegative(), currentVersionId: IdSchema.nullable(),
  status: SourceUploadStatusSchema, format: SourceFormatSchema, fileName: z.string(), byteSize: z.number().int(),
  createdAt: InstantSchema, updatedAt: InstantSchema,
});
export const SourceListSchema = z.strictObject({ sources: z.array(SourceSummarySchema), nextCursor: z.string().nullable() });
const LibraryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
export const SourceLibraryQuerySchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema.optional(), query: z.string().trim().max(120).optional(), format: SourceFormatSchema.optional(),
  from: LibraryDateSchema.optional(), to: LibraryDateSchema.optional(), limit: z.number().int().min(1).max(50).default(30), after: z.string().max(1024).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to);
export type SourceLibraryQuery = z.input<typeof SourceLibraryQuerySchema>;
export const SourceFragmentSchema = z.strictObject({
  id: z.string().min(1), page: z.number().int().positive().optional(), sheet: z.string().optional(),
  row: z.number().int().positive().optional(), values: z.array(z.string()).max(100).optional(), text: z.string().optional(),
  formulas: z.record(z.string(), z.string()).optional(), review: z.enum(['observed', 'needs-review']).default('observed'),
});
export const SourceChunkSchema = z.strictObject({ fragments: z.array(SourceFragmentSchema).max(500) });
export const SourceManifestSchema = z.strictObject({
  parserVersion: z.literal('tirlik-source-1'), policyVersion: z.literal('bounded-1'), format: SourceFormatSchema,
  byteHash: HashSchema, options: SourceOptionsSchema, chunkHashes: z.array(HashSchema).max(4000),
  fragmentCount: z.number().int().nonnegative(), rowCount: z.number().int().nonnegative(), pageCount: z.number().int().nonnegative(),
  sheets: z.array(z.string()), diagnostics: z.array(z.string()), complete: z.boolean(),
});
export type SourceFormat = z.infer<typeof SourceFormatSchema>;
export type SourceSummary = z.infer<typeof SourceSummarySchema>;
export type SourceOptions = z.infer<typeof SourceOptionsSchema>;
export type SourceFragment = z.infer<typeof SourceFragmentSchema>;
export type SourceChunk = z.infer<typeof SourceChunkSchema>;
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
export type InitSourceUpload = z.infer<typeof InitSourceUploadSchema>;
export const SourceUploadSchema = z.strictObject({
  id: IdSchema, sourceId: IdSchema, versionId: IdSchema.nullable(), status: SourceUploadStatusSchema, format: SourceFormatSchema,
  fileName: z.string(), byteSize: z.number().int(), byteHash: HashSchema.nullable(), manifest: SourceManifestSchema.nullable(), errorCode: z.string().nullable(),
  createdAt: InstantSchema, updatedAt: InstantSchema,
});
export const SourceInitResultSchema = z.strictObject({ upload: SourceUploadSchema, token: z.string().nullable() });
export const SourceUploadResultSchema = z.strictObject({ upload: SourceUploadSchema });
export const SourceDetailSchema = z.strictObject({ source: SourceSummarySchema, uploads: z.array(SourceUploadSchema).max(100), canEdit: z.boolean(), editableUploadIds: z.array(IdSchema).max(100) });
export const SourcePreviewSchema = z.strictObject({ upload: SourceUploadSchema, chunk: SourceChunkSchema, ordinal: z.number().int(), chunkCount: z.number().int() });
export type SourceUpload = z.infer<typeof SourceUploadSchema>;
export type SourceDetail = z.infer<typeof SourceDetailSchema>;
export type SourcePreview = z.infer<typeof SourcePreviewSchema>;
