import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { artifactSubmit, createArtifactClient } from "@/features/artifacts/client/transport";
import { createArtifactPrivacy, PrivacyBoundaryError } from "@/features/artifacts/client/privacy";
import { openArtifactCache } from "@/features/artifacts/client/indexed-db";
import { createArtifactAutosave } from "@/features/artifacts/client/autosave";
import { authority, draft, group, ids, receipt, snapshot } from "./fixtures";

const viewer = snapshot().viewer;
const command = () => ({ workspaceId: ids.workspace, expectedAuthzVersion: 1, group: group() });
const fakeFetch = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);
afterEach(() => vi.useRealTimers());

describe("artifact HTTP boundary", () => {
  it("reads a scoped relative endpoint with private response controls", async () => {
    const fetcher = fakeFetch(Response.json(snapshot()));
    await createArtifactClient({ fetch: fetcher }).snapshot(ids.artifact, { viewer }, ids.project);
    expect(fetcher).toHaveBeenCalledWith(`/api/artifacts/${ids.artifact}?workspaceId=${ids.workspace}`, expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", referrerPolicy: "no-referrer", headers: { Accept: "application/json", "X-Tirlik-User-Id": ids.user } }));
  });
  it("maps a validated canonical path into an isolated session endpoint", async () => {
    const fetcher = fakeFetch(Response.json(snapshot()));
    const prefix = `/api/demo/sessions/${ids.group}`;
    await createArtifactClient({ fetch: fetcher, resolvePath: (path) => `${prefix}${path.slice(4)}` }).snapshot(ids.artifact, { viewer }, ids.project);
    expect(fetcher).toHaveBeenCalledWith(`${prefix}/artifacts/${ids.artifact}?workspaceId=${ids.workspace}`, expect.any(Object));
  });
  it("posts the immutable group ID as idempotency key", async () => {
    const fetcher = fakeFetch(Response.json(receipt()));
    const client = createArtifactClient({ fetch: fetcher });
    await artifactSubmit(client)(command(), { signal: new AbortController().signal, expectedUserId: ids.user, idempotencyKey: ids.group });
    expect(fetcher).toHaveBeenCalledWith("/api/artifacts/commands", expect.objectContaining({ method: "POST", body: JSON.stringify(command()), headers: expect.objectContaining({ "Idempotency-Key": ids.group, "X-Tirlik-User-Id": ids.user, "Content-Type": "application/json" }) }));
    expect(() => artifactSubmit(client)(command(), { signal: new AbortController().signal, expectedUserId: ids.user, idempotencyKey: ids.command })).toThrow(TypeError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched actor, workspace, authority, artifact and project", async () => {
    for (const change of [(value: ReturnType<typeof snapshot>) => { value.viewer.userId = ids.otherUser; }, (value: ReturnType<typeof snapshot>) => { value.viewer.authzVersion = 2; }, (value: ReturnType<typeof snapshot>) => { value.viewer.workspaceId = ids.otherWorkspace; value.artifact.workspaceId = ids.otherWorkspace; }, (value: ReturnType<typeof snapshot>) => { value.artifact.id = ids.otherArtifact; value.version.artifactId = ids.otherArtifact; }, (value: ReturnType<typeof snapshot>) => { value.artifact.projectId = ids.otherWorkspace; }]) {
      const value = snapshot(); change(value);
      await expect(createArtifactClient({ fetch: fakeFetch(Response.json(value)) }).snapshot(ids.artifact, { viewer }, ids.project)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    }
  });
  it("validates authority and path IDs before network access", async () => {
    const fetcher = fakeFetch(Response.json(receipt()));
    const client = createArtifactClient({ fetch: fetcher });
    await expect(client.apply({ ...command(), workspaceId: ids.otherWorkspace }, { viewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await expect(client.snapshot("../private", { viewer })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains only a C4 failure and bounded retry interval", async () => {
    const envelope = { code: "CONFLICT", messageKey: "artifacts.errors.conflict", fieldErrors: {}, retryable: false, requestId: crypto.randomUUID() };
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(envelope, { status: 409, headers: { "Retry-After": "99999" } })) }).apply(command(), { viewer })).rejects.toMatchObject({ kind: "server", status: 409, envelope, retryAfterSeconds: 3600 });
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json({ secret: "never show raw body" }, { status: 500 })) }).apply(command(), { viewer })).rejects.toMatchObject({ kind: "server", status: 500, envelope: undefined });
  });
  it.each([401, 403, 404])("preserves privacy status %s for a malformed body", async (status) => {
    await expect(createArtifactClient({ fetch: fakeFetch(new Response("secret upstream text", { status })) }).snapshot(ids.artifact, { viewer })).rejects.toMatchObject({ kind: "invalid-response", status, message: "artifacts.errors.invalid-response" });
  });
  it("bounds declared and streamed response bytes", async () => {
    for (const response of [Response.json(snapshot(), { headers: { "Content-Length": "1000000" } }), new Response("a".repeat(1024))]) {
      await expect(createArtifactClient({ fetch: fakeFetch(response), maxResponseBytes: 100 }).snapshot(ids.artifact, { viewer })).rejects.toMatchObject({ kind: "invalid-response" });
    }
  });
  it("cancels an oversized declared body before rejecting it", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "Content-Length": "1000" } });
    await expect(createArtifactClient({ fetch: fakeFetch(response), maxResponseBytes: 100 }).snapshot(ids.artifact, { viewer })).rejects.toMatchObject({ kind: "invalid-response" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404])("keeps known privacy status %s when its body times out", async (status) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status });
    const task = createArtifactClient({ fetch: fakeFetch(response), timeoutMs: 25 }).snapshot(ids.artifact, { viewer });
    const assertion = expect(task).rejects.toMatchObject({ kind: "timeout", status });
    await vi.advanceTimersByTimeAsync(25); await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("clears autosave private state after forbidden headers with a stalled body", async () => {
    const factory = new IDBFactory();
    const privacy = createArtifactPrivacy(authority());
    const cache = await openArtifactCache(privacy, { factory });
    const client = createArtifactClient({ fetch: fakeFetch(new Response(new ReadableStream(), { status: 403 })), timeoutMs: 5 });
    const autosave = createArtifactAutosave({ cache, privacy, submit: artifactSubmit(client) });
    try {
      await autosave.writeDraft(draft());
      await autosave.enqueue(group(), { [ids.artifact]: 1 });
      expect(autosave.getSnapshot().status).toBe("access-changed");
      const reopened = await openArtifactCache(createArtifactPrivacy(authority()), { factory });
      try { expect(await reopened.getDraft(ids.artifact)).toBeUndefined(); } finally { reopened.close(); }
    } finally { autosave.dispose(); cache.close(); }
  });
  it("rejects same-target lifecycle responses for a different artifact or mismatched content", async () => {
    for (const change of [(result: ReturnType<typeof snapshot>) => { result.artifact.id = ids.otherArtifact; result.version.artifactId = ids.otherArtifact; }, (result: ReturnType<typeof snapshot>) => { result.version.contentRef = { ...result.version.contentRef, id: ids.version }; }]) {
      const value = structuredClone(snapshot()); change(value);
      const result = { viewer, artifact: value.artifact, version: value.version, cursor: value.cursor };
      await expect(createArtifactClient({ fetch: fakeFetch(Response.json(result)) }).rename(ids.artifact, { workspaceId: ids.workspace, expectedAuthzVersion: 1, baseRevision: 0, title: "Offer" }, ids.command, { viewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
    }
  });
  it("correlates created and duplicate kind/project, and deleted target", async () => {
    const value = snapshot();
    const result = { viewer, artifact: value.artifact, version: value.version, cursor: value.cursor };
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(result)) }).create({ workspaceId: ids.workspace, expectedAuthzVersion: 1, projectId: ids.otherWorkspace, title: "Offer", content: value.content }, ids.command, { viewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(result)) }).duplicate(ids.otherArtifact, { workspaceId: ids.workspace, expectedAuthzVersion: 1, projectId: ids.project, title: "Offer", baseRevision: 0 }, ids.command, { viewer }, "table")).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json({ viewer, artifactId: ids.otherArtifact, deletedAt: "2026-10-14T00:00:00.000Z", cleanupPending: false, cursor: "1" })) }).purge(ids.artifact, { workspaceId: ids.workspace, expectedAuthzVersion: 1, baseRevision: 0, confirmationTitle: "Offer", immediate: true }, ids.command, { viewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("correlates command receipts even outside the autosave adapter", async () => {
    for (const change of [(result: ReturnType<typeof receipt>) => { result.commandGroupId = ids.command; result.historyGroup.commandGroupId = ids.command; }, (result: ReturnType<typeof receipt>) => { result.historyGroup.actorId = ids.otherUser; }, (result: ReturnType<typeof receipt>) => { result.artifacts[0]!.revision = 2; result.committedRevisionVector[ids.artifact] = 2; result.historyGroup.committedRevisionVector[ids.artifact] = 2; result.historyGroup.artifacts[0]!.committedRevision = 2; }]) {
      const result = receipt(); change(result);
      await expect(createArtifactClient({ fetch: fakeFetch(Response.json(result)) }).apply(command(), { viewer })).rejects.toMatchObject({ kind: "invalid-response" });
    }
  });
  it("checks the inverse target on a history receipt", async () => {
    const value = receipt();
    const input = { workspaceId: ids.workspace, expectedAuthzVersion: 1, commandGroupId: ids.group, targetCommandGroupId: ids.command, expectedArtifactRevisions: { [ids.artifact]: 0 }, expectedSourceRevisions: {} };
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(value)) }).historyAction("undo", input, { viewer })).rejects.toMatchObject({ kind: "invalid-response" });
    value.historyGroup.undoesGroupId = ids.command;
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(value)) }).historyAction("undo", input, { viewer })).resolves.toEqual(value);
  });
  it("bounds a nonresponsive fetch without retrying a mutation", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const task = createArtifactClient({ fetch: fetcher, timeoutMs: 25 }).apply(command(), { viewer });
    const assertion = expect(task).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("aborts a hanging stream without turning cancellation into retry", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const task = createArtifactClient({ fetch: fakeFetch(new Response(new ReadableStream({ cancel }))) }).snapshot(ids.artifact, { viewer, signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("never accepts a different version revision", async () => {
    const value = snapshot();
    const detail = { viewer, artifact: value.artifact, version: value.version, content: value.content, sourceFreshness: [] };
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(detail)) }).version(ids.artifact, 0, { viewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("reads bounded access without an idempotency key and correlates every requested ID", async () => {
    const value = { viewer, authorizedArtifactIds: [ids.artifact], editableArtifactIds: [ids.artifact], unavailableArtifactIds: [ids.otherArtifact] };
    const fetcher = fakeFetch(Response.json(value));
    await expect(createArtifactClient({ fetch: fetcher }).access([ids.artifact, ids.otherArtifact], { viewer })).resolves.toEqual(value);
    expect(fetcher).toHaveBeenCalledWith("/api/artifacts/access", expect.objectContaining({ method: "POST", headers: expect.not.objectContaining({ "Idempotency-Key": expect.anything() }) }));
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(value)) }).access([ids.artifact], { viewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("allows authority advancement only during explicit fresh reads", async () => {
    const value = snapshot(); value.viewer.authzVersion = 2;
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(value)) }).snapshot(ids.artifact, { viewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await expect(createArtifactClient({ fetch: fakeFetch(Response.json(value)) }).snapshot(ids.artifact, { viewer, allowAuthorityAdvance: true })).resolves.toEqual(value);
  });
  it("keeps an old mutation body unchanged only for an explicit known-operation replay", async () => {
    const fetcher = fakeFetch(Response.json(receipt()));
    const client = createArtifactClient({ fetch: fetcher });
    const nextViewer = { ...viewer, authzVersion: 2 };
    await expect(client.apply(command(), { viewer: nextViewer })).rejects.toBeInstanceOf(PrivacyBoundaryError);
    expect(fetcher).not.toHaveBeenCalled();
    await client.apply(command(), { viewer: nextViewer, replayExpectedAuthzVersion: 1 });
    expect(fetcher).toHaveBeenCalledWith("/api/artifacts/commands", expect.objectContaining({ body: JSON.stringify(command()) }));
  });
});
