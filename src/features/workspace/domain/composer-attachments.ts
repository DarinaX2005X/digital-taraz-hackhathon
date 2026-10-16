import { z } from 'zod';
import { SOURCE_MAX_BYTES, SourceFormatSchema, type InitSourceUpload, type SourceSummary } from '@/contracts/sources';
import { sourceFileFormat } from '@/features/sources/client/transport';

export const ComposerAttachmentSchema = z.strictObject({
  id: z.uuid(), operationKey: z.uuid(), title: z.string().trim().min(1).max(240),
  fileName: z.string().trim().min(1).max(240), size: z.number().int().min(1).max(SOURCE_MAX_BYTES),
  format: SourceFormatSchema,
  state: z.enum(['local', 'needs-file', 'uploading', 'processing', 'retry-processing', 'ready', 'needs-review', 'failed']),
  sourceId: z.uuid().optional(), uploadId: z.uuid().optional(), revision: z.number().int().positive().optional(),
  currentVersionId: z.uuid().optional(),
});
export type ComposerAttachment = z.infer<typeof ComposerAttachmentSchema>;

export type LocalFileDescriptor = Readonly<{ name: string; size: number }>;

export function addComposerFile(file: LocalFileDescriptor, id = crypto.randomUUID(), operationKey = crypto.randomUUID()): ComposerAttachment | undefined {
  const format = sourceFileFormat(file.name);
  if (!format || file.size < 1 || file.size > SOURCE_MAX_BYTES || file.name.length > 240) return;
  return ComposerAttachmentSchema.parse({ id, operationKey, title: file.name, fileName: file.name, size: file.size, format, state: 'local' });
}

export function restoreComposerAttachments(attachments: readonly ComposerAttachment[]): ComposerAttachment[] {
  return attachments.map((item) => {
    if (item.state === 'ready' || item.state === 'needs-review') return { ...item };
    if (item.uploadId && item.sourceId && ['processing', 'retry-processing', 'failed'].includes(item.state)) return { ...item, state: 'retry-processing' };
    return { ...item, state: 'needs-file' };
  });
}

export function matchesComposerFile(attachment: ComposerAttachment, file: LocalFileDescriptor) {
  return attachment.fileName === file.name && attachment.size === file.size && attachment.format === sourceFileFormat(file.name);
}

export function sourceUploadInput(attachment: ComposerAttachment, workspaceId: string, projectId: string): InitSourceUpload {
  return { workspaceId, projectId, expectedRevision: 0, title: attachment.title, fileName: attachment.fileName, size: attachment.size, format: attachment.format, accessClass: 'internal', options: { encoding: 'utf-8' } };
}

export function readyComposerSources(attachments: readonly ComposerAttachment[], sources: readonly SourceSummary[]): SourceSummary[] {
  return attachments.map((attachment) => {
    if (attachment.state !== 'ready' || !attachment.sourceId || !attachment.currentVersionId || !attachment.revision) throw new Error('composer-source-not-ready');
    const source = sources.find((item) => item.id === attachment.sourceId);
    if (!source || source.status !== 'ready' || source.currentVersionId !== attachment.currentVersionId || source.revision !== attachment.revision) throw new Error('composer-source-changed');
    return source;
  });
}
