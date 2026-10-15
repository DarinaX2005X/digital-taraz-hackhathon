import { z } from 'zod';
import { IdSchema } from '@/contracts/primitives';
import { WorkspaceEventPageSchema } from '@/contracts/events';
import { CreateProjectSchema, ProjectListInputSchema, ProjectListResultSchema, ProjectResultSchema, UpdateProjectSchema, ProjectLifecycleSchema } from '../contracts';
import { ProjectViewSchema, RecordProjectViewSchema } from '../view-contracts';

export class WorkspaceRequestError extends Error {
  constructor(readonly status: number) { super(`workspace-request-${status}`); }
}
export type WorkspaceRequestOptions = { userId: string; signal?: AbortSignal };

export async function workspaceRequest<T>(url: string, schema: z.ZodType<T>, options: WorkspaceRequestOptions, mutation?: { body: unknown; key: string }): Promise<T> {
  IdSchema.parse(options.userId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20000);
  let status = 0;
  try {
    const response = await fetch(url, { method: mutation ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Tirlik-User-Id': options.userId, ...(mutation ? { 'Content-Type': 'application/json', 'Idempotency-Key': IdSchema.parse(mutation.key) } : {}) },
      ...(mutation ? { body: JSON.stringify(mutation.body) } : {}),
    });
    status = response.status;
    if (!response.ok) { void response.body?.cancel(); throw new WorkspaceRequestError(status); }
    if (Number(response.headers.get('content-length')) > 1024 * 1024) { void response.body?.cancel(); throw new WorkspaceRequestError(502); }
    const reader = response.body?.getReader();
    if (!reader) throw new WorkspaceRequestError(502);
    const decoder = new TextDecoder(); let text = '', bytes = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 1024 * 1024) { await reader.cancel(); throw new WorkspaceRequestError(502); } text += decoder.decode(part.value, { stream: true }); }
    } finally { reader.releaseLock(); }
    if (controller.signal.aborted) throw new WorkspaceRequestError(status);
    return schema.parse(JSON.parse(text + decoder.decode()));
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof WorkspaceRequestError) throw error;
    throw new WorkspaceRequestError(status >= 400 ? status : 0);
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}

export const workspaceClient = {
  async list(input: z.input<typeof ProjectListInputSchema>, opts: WorkspaceRequestOptions) {
    const parsed = ProjectListInputSchema.parse(input);
    const query = new URLSearchParams(Object.entries(parsed).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    const result = await workspaceRequest(`/api/projects?${query}`, ProjectListResultSchema, opts);
    if (result.projects.some((item) => item.workspaceId !== parsed.workspaceId)) throw new WorkspaceRequestError(403);
    return result;
  },
  async read(workspaceId: string, projectId: string, opts: WorkspaceRequestOptions) {
    const result = await workspaceRequest(`/api/projects/${IdSchema.parse(projectId)}?workspaceId=${IdSchema.parse(workspaceId)}`, ProjectResultSchema, opts);
    if (result.project.id !== projectId || result.project.workspaceId !== workspaceId) throw new WorkspaceRequestError(403);
    return result;
  },
  async create(input: z.input<typeof CreateProjectSchema>, key: string, opts: WorkspaceRequestOptions) {
    const body = CreateProjectSchema.parse(input);
    const result = await workspaceRequest('/api/projects', ProjectResultSchema, opts, { body, key });
    if (result.project.workspaceId !== body.workspaceId) throw new WorkspaceRequestError(403);
    return result;
  },
  async mutate(projectId: string, action: 'update' | 'archive' | 'restore', input: unknown, key: string, opts: WorkspaceRequestOptions) {
    const body = (action === 'update' ? UpdateProjectSchema : ProjectLifecycleSchema).parse(input);
    const result = await workspaceRequest(`/api/projects/${IdSchema.parse(projectId)}/${action}`, ProjectResultSchema, opts, { body, key });
    if (result.project.id !== projectId || result.project.workspaceId !== body.workspaceId) throw new WorkspaceRequestError(403);
    return result;
  },
  async view(workspaceId: string, projectId: string, opts: WorkspaceRequestOptions) {
    const result = await workspaceRequest(`/api/projects/${IdSchema.parse(projectId)}/view?workspaceId=${IdSchema.parse(workspaceId)}`, ProjectViewSchema, opts);
    if (result.projectId !== projectId || result.workspaceId !== workspaceId) throw new WorkspaceRequestError(403);
    return result;
  },
  async recordView(projectId: string, input: z.input<typeof RecordProjectViewSchema>, opts: WorkspaceRequestOptions) {
    const body = RecordProjectViewSchema.parse(input);
    const result = await workspaceRequest(`/api/projects/${IdSchema.parse(projectId)}/view`, ProjectViewSchema, opts, { body, key: crypto.randomUUID() });
    if (result.projectId !== projectId || result.workspaceId !== body.workspaceId || result.selectedArtifactId !== (body.selectedArtifactId ?? null)) throw new WorkspaceRequestError(403);
    return result;
  },
  events(workspaceId: string, cursor: string, opts: WorkspaceRequestOptions) { return workspaceRequest(`/api/workspace-events?${new URLSearchParams({ workspaceId: IdSchema.parse(workspaceId), cursor, limit: '100' })}`, WorkspaceEventPageSchema, opts); },
};
