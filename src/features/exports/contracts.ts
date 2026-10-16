import { z } from 'zod';
import { IdSchema, RevisionSchema } from '../../contracts/primitives';

export const ExportFormatSchema = z.enum(['docx', 'pdf', 'xlsx', 'csv', 'png', 'jpeg', 'tirlik', 'ics']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export const ExportLayoutSchema = z.strictObject({
  pageSize: z.enum(['A4', 'Letter']).default('A4'), orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  marginMm: z.number().min(10).max(45).default(20), headerText: z.string().max(300).optional(), footerText: z.string().max(300).optional(), pageNumbers: z.boolean().default(true),
});
export const ExportOptionsSchema = z.strictObject({
  layout: ExportLayoutSchema.default({ pageSize: 'A4', orientation: 'portrait', marginMm: 20, pageNumbers: true }),
  sheetId: z.string().min(1).max(128).optional(), pageIds: z.array(z.string().min(1).max(128)).min(1).max(100).optional(),
  scale: z.number().min(0.25).max(4).default(1), transparent: z.boolean().default(false),
  replaceUnsupportedFonts: z.boolean().default(false), fontAssets: z.record(z.string().min(1).max(120), IdSchema).default({}),
});
export const ExportReleaseSchema = z.strictObject({
  projectId: IdSchema,
  title: z.string().trim().min(1).max(240),
  audience: z.string().trim().min(1).max(240),
  knownOmissions: z.array(z.string().trim().min(1).max(1000)).max(100),
}).refine((release) => new Set(release.knownOmissions).size === release.knownOmissions.length, {
  message: 'Known release omissions must be unique.',
});
export const CreateExportSchema = z.strictObject({
  workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive(), locale: z.enum(['ru', 'kk', 'en']),
  historicalDraft: z.boolean().default(false), privateFieldsPolicy: z.enum(['exclude-internal', 'include-authorized']).default('exclude-internal'),
  release: ExportReleaseSchema.optional(),
  items: z.array(z.strictObject({ artifactId: IdSchema, revision: RevisionSchema, formats: z.array(ExportFormatSchema).min(1).max(8), options: ExportOptionsSchema.default({ layout: { pageSize: 'A4', orientation: 'portrait', marginMm: 20, pageNumbers: true }, scale: 1, transparent: false, replaceUnsupportedFonts: false, fontAssets: {} }) })).min(1).max(20),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map((item) => item.artifactId)).size !== value.items.length || value.items.some((item) => new Set(item.formats).size !== item.formats.length || (item.options.pageIds && new Set(item.options.pageIds).size !== item.options.pageIds.length))) ctx.addIssue({ code: 'custom', message: 'Export selections must be unique.' });
});
export type CreateExport = z.infer<typeof CreateExportSchema>;
export type ExportRelease = z.infer<typeof ExportReleaseSchema>;
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;
export type ExportLocale = CreateExport['locale'];
export type PrivateFieldsPolicy = CreateExport['privateFieldsPolicy'];
export interface ExportWarning { code: string; targetId?: string; message?: string }
export interface ExportFile { id: string; artifactId: string; revision: number; format: ExportFormat; fileName: string; status: 'pending' | 'ready' | 'failed'; mediaType?: string; sha256?: string; byteSize?: number; errorKey?: string; warnings: ExportWarning[] }
export interface ExportBundle { fileName: string; sha256: string; byteSize: number }
export interface ExportJob { id: string; workspaceId: string; createdAt: string; historicalDraft: boolean; locale: ExportLocale; privateFieldsPolicy: PrivateFieldsPolicy; release?: ExportRelease; revisions: { artifactId: string; revision: number }[]; status: 'queued' | 'rendering' | 'partial' | 'ready' | 'failed' | 'cancelled'; files: ExportFile[]; bundle?: ExportBundle; manifestHash?: string; authzVersion: number; leaseExpiresAt?: string }
export const formatsForKind = { document: ['docx', 'pdf'], table: ['xlsx', 'csv'], design: ['png', 'jpeg', 'pdf', 'tirlik'], plan: ['xlsx', 'pdf', 'ics'] } as const satisfies Record<string, readonly ExportFormat[]>;
export const registeredExportKinds: readonly (keyof typeof formatsForKind)[] = ['document', 'table', 'design', 'plan'];
