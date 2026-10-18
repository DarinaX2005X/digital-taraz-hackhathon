import { z } from 'zod';
import { IdSchema, InstantSchema, RevisionSchema } from '../../contracts/primitives';
import { CreateExportSchema, ExportFormatSchema, ExportReleaseSchema } from '../exports/contracts';

const CreateProjectPackageReleaseSchema = ExportReleaseSchema.safeExtend({ basis: z.enum(['accepted', 'saved-draft']) });
export const ProjectPackageReleaseSchema = ExportReleaseSchema.safeExtend({ basis: z.enum(['accepted', 'saved-draft']).default('saved-draft') });
export const CreateProjectPackageSchema = CreateExportSchema.safeExtend({ release: CreateProjectPackageReleaseSchema }).superRefine((value, context) => {
  if ((value.release.basis === 'accepted') === value.historicalDraft) context.addIssue({ code: 'custom', path: ['historicalDraft'], message: 'Accepted packages must not be drafts, and saved drafts must be labelled as drafts.' });
});
export const ProjectPackageListInputSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema });

const PackageFileSchema = z.strictObject({
  id: IdSchema, artifactId: IdSchema, revision: RevisionSchema, format: ExportFormatSchema, fileName: z.string().min(1).max(300),
  status: z.enum(['pending', 'ready', 'failed']), mediaType: z.string().max(200).optional(), sha256: z.string().length(64).optional(),
  byteSize: z.number().int().nonnegative().optional(), errorKey: z.string().max(240).optional(),
  warnings: z.array(z.strictObject({ code: z.string().max(120), targetId: z.string().max(240).optional(), message: z.string().max(1000).optional() })).max(1000),
});
export const ProjectPackageSchema = z.strictObject({
  id: IdSchema, workspaceId: IdSchema, createdAt: InstantSchema, historicalDraft: z.boolean(), locale: z.enum(['ru', 'kk', 'en']),
  privateFieldsPolicy: z.enum(['exclude-internal', 'include-authorized']), release: ProjectPackageReleaseSchema,
  revisions: z.array(z.strictObject({ artifactId: IdSchema, revision: RevisionSchema, approval: z.strictObject({ decisionId: IdSchema, actorId: IdSchema, createdAt: InstantSchema }).optional() })).min(1).max(20),
  status: z.enum(['queued', 'rendering', 'partial', 'ready', 'failed', 'cancelled']), files: z.array(PackageFileSchema).max(200),
  bundle: z.strictObject({ fileName: z.string().min(1).max(300), sha256: z.string().length(64), byteSize: z.number().int().nonnegative() }).optional(),
  manifestHash: z.string().length(64).optional(), authzVersion: z.number().int().positive(), leaseExpiresAt: InstantSchema.optional(),
});
export const ProjectPackageListResultSchema = z.strictObject({ packages: z.array(ProjectPackageSchema).max(100), authzVersion: z.number().int().positive() });

export type CreateProjectPackage = z.infer<typeof CreateProjectPackageSchema>;
export type ProjectPackage = z.infer<typeof ProjectPackageSchema>;
export type ProjectPackageListResult = z.infer<typeof ProjectPackageListResultSchema>;
