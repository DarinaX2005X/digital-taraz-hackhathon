import { z } from 'zod';
import { IdSchema, HashSchema } from '@/contracts/primitives';
import { DatasetQuerySchema } from '@/contracts/materials';

export const SheetImportRequestSchema = z.strictObject({
  action: z.enum(['preview', 'create']), workspaceId: IdSchema, sourceId: IdSchema, sourceVersionId: IdSchema,
  expectedAuthzVersion: z.number().int().positive(), title: z.string().trim().min(1).max(240).optional(), previewHash: HashSchema.optional(),
}).refine((input) => input.action !== 'create' || !!input.previewHash);
export const SheetMaterializeRequestSchema = DatasetQuerySchema.omit({ after: true, limit: true, includeMissing: true }).extend({
  revision: z.number().int().nonnegative(), expectedAuthzVersion: z.number().int().positive(), title: z.string().trim().min(1).max(240).optional(),
});
