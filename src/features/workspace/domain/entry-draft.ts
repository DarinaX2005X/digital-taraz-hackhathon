import { z } from 'zod';
import { CreateProjectSchema } from '../contracts';
import { ComposerAttachmentSchema } from './composer-attachments';
import { TaskRequestSchema } from './task-request';

export const EntryDraftSchema = z.strictObject({
  title: z.string().max(240), goal: z.string().max(12000), workspaceName: z.string().max(100), selectedWorkspace: z.union([z.uuid(), z.literal('')]),
  projectRequest: z.strictObject({ intent: z.string().max(14000), key: z.uuid(), input: CreateProjectSchema }).optional(),
  workspaceRequest: z.strictObject({ name: z.string().min(1).max(100), key: z.uuid() }).optional(),
  confirmedWorkspaceId: z.uuid().optional(),
  confirmedProjectId: z.uuid().optional(),
  attachments: z.array(ComposerAttachmentSchema).max(20).optional(),
  runRequest: TaskRequestSchema.optional(),
  manualTitle: z.string().max(240).optional(), manualKind: z.enum(['document', 'table', 'design', 'plan']).optional(),
});
export type EntryDraft = z.infer<typeof EntryDraftSchema>;
export const entryDraftKey = (ownerId: string, intentToken?: string) => `tirlik.entry-draft.v1:${ownerId}:${intentToken ?? 'direct'}`;
export function readEntryDraft(raw: string | null): EntryDraft | undefined {
  if (!raw || raw.length > 100000) return;
  try { const result = EntryDraftSchema.safeParse(JSON.parse(raw)); return result.success ? result.data : undefined; } catch { return; }
}
