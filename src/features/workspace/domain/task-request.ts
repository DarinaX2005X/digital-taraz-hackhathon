import { z } from 'zod';
import { CreateRunSchema, type CreateRun, type RunInputRef } from '@/contracts/runs';
import type { SourceSummary } from '@/contracts/sources';
import type { Locale } from '@/i18n';

export const TaskRequestSchema = z.strictObject({
  key: z.uuid(), input: CreateRunSchema, createdAt: z.number().int().nonnegative(),
});
export type TaskRequest = z.infer<typeof TaskRequestSchema>;

export function taskRequestKey(ownerId: string, projectId: string) {
  return `tirlik.task-request.v1:${ownerId}:${projectId}`;
}

export function readTaskRequest(raw: string | null, workspaceId: string, projectId: string, now = Date.now()): TaskRequest | undefined {
  if (!raw || raw.length > 100_000) return;
  try {
    const result = TaskRequestSchema.safeParse(JSON.parse(raw));
    if (!result.success || result.data.input.projectId !== projectId || result.data.input.workspaceId !== workspaceId || result.data.createdAt > now) return;
    return result.data;
  } catch { return; }
}

export function selectedSourceRefs(sources: readonly SourceSummary[], selected: readonly string[], pinned: readonly RunInputRef[] = []): RunInputRef[] {
  return [...new Set(selected)].map((id) => {
    const version = pinned.find((ref) => ref.kind === 'source' && ref.id === id);
    if (version) return { ...version };
    const source = sources.find((item) => item.id === id);
    if (!source || source.status !== 'ready' || !source.currentVersionId || source.revision < 1) throw new Error('source-unavailable');
    return { kind: 'source', id: source.id, revision: source.revision };
  });
}

export function prepareTaskRequest(input: { workspaceId: string; projectId: string; goal: string; locale: Locale; sources: readonly SourceSummary[]; selected: readonly string[]; pinned?: readonly RunInputRef[] }, key = crypto.randomUUID(), now = Date.now()): TaskRequest {
  const body: CreateRun = CreateRunSchema.parse({ workspaceId: input.workspaceId, projectId: input.projectId, goal: input.goal, locale: input.locale, capabilityId: 'business.goal', capabilityVersion: 1, inputRefs: selectedSourceRefs(input.sources, input.selected, input.pinned) });
  return { key, input: body, createdAt: now };
}
