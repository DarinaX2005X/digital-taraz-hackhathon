import { z } from "zod";
import { ErrorEnvelopeSchema } from "@/contracts/errors";
import { ArtifactKindSchema, type ArtifactKind } from "@/contracts/artifacts";
import { IdSchema, RevisionSchema } from "@/contracts/primitives";
import {
  ArtifactAccessRequestSchema, ArtifactAccessResultSchema, ArtifactCommandRequestSchema, ArtifactHistoryActionSchema, ArtifactHistorySchema, ArtifactListInputSchema, ArtifactListResultSchema,
  ArtifactMutationResultSchema, ArtifactMutationSchema, ArtifactPurgeResultSchema,
  ArtifactSnapshotSchema, ArtifactVersionDetailSchema, ArtifactVersionPageSchema,
  ArtifactViewerSchema, BranchArtifactSchema, CommandReceiptSchema, CreateArtifactSchema, DuplicateArtifactSchema,
  MoveArtifactSchema, PurgeArtifactSchema, RenameArtifactSchema, RestoreArtifactVersionSchema,
  type ArtifactViewer, type ArtifactMutationResult, type CommandReceipt,
} from "../contracts";
import { ArtifactSubmissionError, type ArtifactSubmit } from "./autosave";
import { PrivacyBoundaryError } from "./privacy";
import { ProjectListInputSchema, ProjectListResultSchema } from "@/features/workspace/contracts";
import { WorkspaceCursorSchema, WorkspaceEventPageSchema } from "@/contracts/events";

export class ArtifactRequestError extends ArtifactSubmissionError {
  constructor(kind: ArtifactSubmissionError["kind"], status = 0, envelope?: z.infer<typeof ErrorEnvelopeSchema>, readonly retryAfterSeconds?: number) {
    super(kind, envelope, status);
    this.name = "ArtifactRequestError";
  }
}

export type ArtifactRequestOptions = { viewer: ArtifactViewer; signal?: AbortSignal; allowAuthorityAdvance?: boolean; replayExpectedAuthzVersion?: number };
export type ArtifactClientOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Maps a validated canonical API path to an isolated transport endpoint. */
  resolvePath?: (path: string) => string;
};
const integer = (value: number, maximum = Number.MAX_SAFE_INTEGER) => z.number().int().min(0).max(maximum).parse(value);

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : undefined;
}

async function readJson(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("Content-Length")) > maximum) {
    void response.body?.cancel().catch(() => undefined);
    throw new ArtifactRequestError("invalid-response", response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ArtifactRequestError("invalid-response", response.status);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) throw new ArtifactRequestError("invalid-response", response.status);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export function createArtifactClient(options: ArtifactClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxResponseBytes = options.maxResponseBytes ?? 32 * 1024 * 1024;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) throw new TypeError("Invalid request limits.");

  function query(path: string, viewer: ArtifactViewer, values: Record<string, string | number | undefined> = {}) {
    const parameters = new URLSearchParams({ workspaceId: viewer.workspaceId });
    for (const [key, value] of Object.entries(values)) if (value !== undefined) parameters.set(key, String(value));
    return `${path}?${parameters.toString()}`;
  }

  async function request<T>(path: string, schema: z.ZodType<T>, opts: ArtifactRequestOptions, mutation?: { body: unknown; key?: string; readOnly?: true }): Promise<T> {
    const viewer = ArtifactViewerSchema.parse(opts.viewer);
    if (!/^\/api\/(?:artifacts(?:\/[^?#]*)?|projects|workspace-events)(?:\?[^#]*)?$/.test(path)) throw new ArtifactRequestError("invalid-response");
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    let rejectInterrupted: (reason: Error) => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
    const onInterrupted = () => rejectInterrupted(new DOMException("Aborted", "AbortError"));
    controller.signal.addEventListener("abort", onInterrupted, { once: true });
    let timedOut = false;
    const abort = () => controller.abort();
    opts.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let responseStatus = 0;
    try {
      const response = await Promise.race([fetcher(options.resolvePath?.(path) ?? path, {
        method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Accept: "application/json", "X-Tirlik-User-Id": viewer.userId, ...(mutation ? { "Content-Type": "application/json", ...(!mutation.readOnly ? { "Idempotency-Key": IdSchema.parse(mutation.key) } : {}) } : {}) },
        ...(mutation ? { body: JSON.stringify(mutation.body) } : {}), signal: controller.signal,
      }), interrupted]);
      responseStatus = response.status;
      const data = await Promise.race([readJson(response, maxResponseBytes, controller.signal), interrupted]);
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!response.ok) {
        const envelope = ErrorEnvelopeSchema.safeParse(data);
        throw new ArtifactRequestError("server", response.status, envelope.success ? envelope.data : undefined, retryAfter(response.headers.get("Retry-After")));
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new ArtifactRequestError("invalid-response", response.status);
      if (typeof parsed.data === "object" && parsed.data !== null && "viewer" in parsed.data) {
        const returned = ArtifactViewerSchema.parse(parsed.data.viewer);
        const allowedAdvance = (!mutation || mutation.readOnly) && opts.allowAuthorityAdvance === true && returned.authzVersion > viewer.authzVersion;
        if (returned.userId !== viewer.userId || returned.workspaceId !== viewer.workspaceId || (returned.authzVersion !== viewer.authzVersion && !allowedAdvance)) throw new PrivacyBoundaryError();
      }
      return parsed.data;
    } catch (error) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (timedOut) throw new ArtifactRequestError("timeout", responseStatus);
      if (error instanceof ArtifactSubmissionError || error instanceof PrivacyBoundaryError) throw error;
      throw new ArtifactRequestError(responseStatus ? "invalid-response" : "network", responseStatus);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onInterrupted);
      opts.signal?.removeEventListener("abort", abort);
    }
  }

  function validate<T extends { workspaceId: string; expectedAuthzVersion: number }>(schema: z.ZodType<T>, input: unknown, opts: ArtifactRequestOptions): T {
    const value = schema.parse(input);
    const viewer = ArtifactViewerSchema.parse(opts.viewer);
    const explicitReplay = opts.replayExpectedAuthzVersion === value.expectedAuthzVersion && value.expectedAuthzVersion < viewer.authzVersion;
    if (value.workspaceId !== viewer.workspaceId || (value.expectedAuthzVersion !== viewer.authzVersion && !explicitReplay)) throw new PrivacyBoundaryError();
    return value;
  }

  function correlatedMutation(result: ArtifactMutationResult, opts: ArtifactRequestOptions, expected: { id?: string; differentId?: string; projectId?: string; kind?: ArtifactKind } = {}) {
    const { artifact, version } = result;
    if (artifact.workspaceId !== opts.viewer.workspaceId || artifact.id !== version.artifactId || artifact.currentRevision !== version.revision
      || artifact.contentRef.id !== version.contentRef.id || artifact.contentRef.hash !== version.contentRef.hash || artifact.title !== version.title
      || (expected.id !== undefined && artifact.id !== expected.id) || artifact.id === expected.differentId
      || (expected.projectId !== undefined && artifact.projectId !== expected.projectId) || (expected.kind !== undefined && artifact.kind !== expected.kind)) throw new PrivacyBoundaryError();
    return result;
  }

  function correlatedReceipt(result: CommandReceipt, opts: ArtifactRequestOptions, groupId: string, previousRevisions: Record<string, number>) {
    const ids = Object.keys(previousRevisions);
    if (result.commandGroupId !== groupId || result.historyGroup.actorId !== opts.viewer.userId || result.artifacts.length !== ids.length
      || ids.some((id) => result.committedRevisionVector[id] !== previousRevisions[id]! + 1)) throw new ArtifactRequestError("invalid-response");
    return result;
  }

  async function lifecycle<T extends z.infer<typeof ArtifactMutationSchema>>(id: string, action: string, schema: z.ZodType<T>, input: unknown, key: string, opts: ArtifactRequestOptions) {
    const target = IdSchema.parse(id);
    const value = validate(schema, input, opts);
    const result = await request(`/api/artifacts/${target}/${action}`, ArtifactMutationResultSchema, opts, { body: value, key });
    return correlatedMutation(result, opts, { id: target, ...("projectId" in value ? { projectId: IdSchema.parse(value.projectId) } : {}) });
  }

  return {
    async list(input: z.input<typeof ArtifactListInputSchema>, opts: ArtifactRequestOptions) {
      const value = ArtifactListInputSchema.parse(input);
      if (value.workspaceId !== opts.viewer.workspaceId) throw new PrivacyBoundaryError();
      const result = await request(query('/api/artifacts', opts.viewer, { projectId: value.projectId, status: value.status, kind: value.kind, query: value.query, after: value.after, limit: value.limit }), ArtifactListResultSchema, opts);
      if (result.artifacts.some((item) => item.workspaceId !== value.workspaceId || item.projectId !== value.projectId)) throw new PrivacyBoundaryError();
      return result;
    },
    async events(cursor: string, opts: ArtifactRequestOptions) {
      const result = await request(query("/api/workspace-events", opts.viewer, { cursor: WorkspaceCursorSchema.parse(cursor), limit: 100 }), WorkspaceEventPageSchema, opts);
      if (result.workspaceId !== opts.viewer.workspaceId) throw new PrivacyBoundaryError();
      return result;
    },
    async projects(opts: ArtifactRequestOptions, page: { query?: string; after?: string } = {}) {
      const input = ProjectListInputSchema.parse({ ...page, workspaceId: opts.viewer.workspaceId, limit: 50 });
      const result = await request(query("/api/projects", opts.viewer, { query: input.query, after: input.after, limit: input.limit }), ProjectListResultSchema, opts);
      if (result.authzVersion !== opts.viewer.authzVersion || result.projects.some((project) => project.workspaceId !== opts.viewer.workspaceId)) throw new PrivacyBoundaryError();
      return result;
    },
    async access(artifactIds: string[], opts: ArtifactRequestOptions) {
      const input = ArtifactAccessRequestSchema.parse({ workspaceId: opts.viewer.workspaceId, artifactIds });
      const result = await request("/api/artifacts/access", ArtifactAccessResultSchema, opts, { body: input, readOnly: true });
      const returned = [...result.authorizedArtifactIds, ...result.unavailableArtifactIds];
      if (returned.length !== input.artifactIds.length || new Set(returned).size !== returned.length || returned.some((id) => !input.artifactIds.includes(id)) || result.editableArtifactIds.some((id) => !result.authorizedArtifactIds.includes(id))) throw new PrivacyBoundaryError();
      return result;
    },
    async snapshot(artifactId: string, opts: ArtifactRequestOptions, expectedProjectId?: string) {
      const id = IdSchema.parse(artifactId);
      const result = await request(query(`/api/artifacts/${id}`, opts.viewer), ArtifactSnapshotSchema, opts);
      if (result.artifact.id !== id || (expectedProjectId !== undefined && result.artifact.projectId !== IdSchema.parse(expectedProjectId))) throw new PrivacyBoundaryError();
      return result;
    },
    async history(artifactId: string, opts: ArtifactRequestOptions) {
      const id = IdSchema.parse(artifactId);
      const result = await request(query(`/api/artifacts/${id}/history`, opts.viewer), ArtifactHistorySchema, opts);
      if (result.artifactId !== id) throw new PrivacyBoundaryError();
      return result;
    },
    async versions(artifactId: string, opts: ArtifactRequestOptions, page: { beforeRevision?: number; limit?: number } = {}) {
      const id = IdSchema.parse(artifactId);
      const result = await request(query(`/api/artifacts/${id}/versions`, opts.viewer, { beforeRevision: page.beforeRevision === undefined ? undefined : RevisionSchema.parse(page.beforeRevision), limit: page.limit === undefined ? undefined : z.number().int().min(1).max(50).parse(page.limit) }), ArtifactVersionPageSchema, opts);
      if (result.artifactId !== id || result.versions.some((version) => version.artifactId !== id)) throw new PrivacyBoundaryError();
      return result;
    },
    async version(artifactId: string, revision: number, opts: ArtifactRequestOptions) {
      const id = IdSchema.parse(artifactId);
      const result = await request(query(`/api/artifacts/${id}/versions/${integer(revision)}`, opts.viewer), ArtifactVersionDetailSchema, opts);
      if (result.artifact.id !== id || result.version.artifactId !== id || result.version.revision !== revision || result.artifact.workspaceId !== opts.viewer.workspaceId || result.content.kind !== result.artifact.kind || result.content.schemaVersion !== result.artifact.schemaVersion) throw new PrivacyBoundaryError();
      return result;
    },
    create: async (input: z.input<typeof CreateArtifactSchema>, key: string, opts: ArtifactRequestOptions) => {
      const value = validate(CreateArtifactSchema, input, opts);
      return correlatedMutation(await request("/api/artifacts", ArtifactMutationResultSchema, opts, { body: value, key }), opts, { projectId: value.projectId, kind: value.content.kind });
    },
    apply: async (input: z.input<typeof ArtifactCommandRequestSchema>, opts: ArtifactRequestOptions) => {
      const value = validate(ArtifactCommandRequestSchema, input, opts);
      return correlatedReceipt(await request("/api/artifacts/commands", CommandReceiptSchema, opts, { body: value, key: value.group.commandGroupId }), opts, value.group.commandGroupId, value.group.expectedArtifactRevisions);
    },
    historyAction: async (action: "undo" | "redo", input: z.input<typeof ArtifactHistoryActionSchema>, opts: ArtifactRequestOptions) => {
      const value = validate(ArtifactHistoryActionSchema, input, opts);
      const result = correlatedReceipt(await request(`/api/artifacts/history/${z.enum(["undo", "redo"]).parse(action)}`, CommandReceiptSchema, opts, { body: value, key: value.commandGroupId }), opts, value.commandGroupId, value.expectedArtifactRevisions);
      if ((action === "undo" ? result.historyGroup.undoesGroupId : result.historyGroup.redoesGroupId) !== value.targetCommandGroupId) throw new ArtifactRequestError("invalid-response");
      return result;
    },
    rename: (id: string, input: z.input<typeof RenameArtifactSchema>, key: string, opts: ArtifactRequestOptions) => lifecycle(id, "rename", RenameArtifactSchema, input, key, opts),
    move: (id: string, input: z.input<typeof MoveArtifactSchema>, key: string, opts: ArtifactRequestOptions) => lifecycle(id, "move", MoveArtifactSchema, input, key, opts),
    archive: (id: string, input: z.input<typeof ArtifactMutationSchema>, key: string, opts: ArtifactRequestOptions) => lifecycle(id, "archive", ArtifactMutationSchema, input, key, opts),
    trash: (id: string, input: z.input<typeof ArtifactMutationSchema>, key: string, opts: ArtifactRequestOptions) => lifecycle(id, "trash", ArtifactMutationSchema, input, key, opts),
    restore: (id: string, input: z.input<typeof ArtifactMutationSchema>, key: string, opts: ArtifactRequestOptions) => lifecycle(id, "restore", ArtifactMutationSchema, input, key, opts),
    duplicate: async (id: string, input: z.input<typeof DuplicateArtifactSchema>, key: string, opts: ArtifactRequestOptions, expectedKind: ArtifactKind) => {
      const target = IdSchema.parse(id);
      const kind = ArtifactKindSchema.parse(expectedKind);
      const value = validate(DuplicateArtifactSchema, input, opts);
      return correlatedMutation(await request(`/api/artifacts/${target}/duplicate`, ArtifactMutationResultSchema, opts, { body: value, key }), opts, { differentId: target, projectId: value.projectId, kind });
    },
    branch: async (id: string, input: z.input<typeof BranchArtifactSchema>, key: string, opts: ArtifactRequestOptions, expectedKind: ArtifactKind) => {
      const target = IdSchema.parse(id);
      const kind = ArtifactKindSchema.parse(expectedKind);
      const value = validate(BranchArtifactSchema, input, opts);
      const result = correlatedMutation(await request(`/api/artifacts/${target}/branches`, ArtifactMutationResultSchema, opts, { body: value, key }), opts, { differentId: target, projectId: value.projectId, kind });
      if (result.version.branchParent?.artifactId !== target || result.version.branchParent.revision !== value.parentRevision) throw new ArtifactRequestError("invalid-response");
      return result;
    },
    restoreVersion: (id: string, input: z.input<typeof RestoreArtifactVersionSchema>, key: string, opts: ArtifactRequestOptions) => lifecycle(id, "restore-version", RestoreArtifactVersionSchema, input, key, opts),
    purge: async (id: string, input: z.input<typeof PurgeArtifactSchema>, key: string, opts: ArtifactRequestOptions) => {
      const target = IdSchema.parse(id);
      const result = await request(`/api/artifacts/${target}/purge`, ArtifactPurgeResultSchema, opts, { body: validate(PurgeArtifactSchema, input, opts), key });
      if (result.artifactId !== target) throw new PrivacyBoundaryError();
      return result;
    },
  };
}

export type ArtifactClient = ReturnType<typeof createArtifactClient>;
export const artifactClient = createArtifactClient();
export function artifactSubmit(client: ArtifactClient): ArtifactSubmit {
  return (input, opts) => {
    if (input.group.commandGroupId !== opts.idempotencyKey) throw new TypeError("The idempotency key must match its command group.");
    const currentAuthzVersion = opts.currentAuthzVersion ?? input.expectedAuthzVersion;
    return client.apply(input, { viewer: { userId: opts.expectedUserId, workspaceId: input.workspaceId, authzVersion: currentAuthzVersion }, signal: opts.signal, ...(input.expectedAuthzVersion < currentAuthzVersion ? { replayExpectedAuthzVersion: input.expectedAuthzVersion } : {}) });
  };
}
