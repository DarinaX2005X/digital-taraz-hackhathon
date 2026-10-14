import { describe, expect, it, vi } from "vitest";
import { createArtifactOperations, type ArtifactOperation, type ArtifactOperationJournal } from "@/features/artifacts/client/operations";
import { createArtifactPrivacy } from "@/features/artifacts/client/privacy";
import { ArtifactRequestError } from "@/features/artifacts/client/transport";
import { authority, ids } from "./fixtures";

function operation(): ArtifactOperation {
  return { operationId: ids.group, artifactId: ids.artifact, kind: "rename", state: "ready", createdAt: "2026-10-14T00:00:00.000Z", body: { workspaceId: ids.workspace, expectedAuthzVersion: 1, baseRevision: 0, title: "New title" } };
}
function journal() {
  const records = new Map<string, ArtifactOperation>();
  return { records, putOperation: vi.fn(async (entry: ArtifactOperation) => { records.set(entry.operationId, structuredClone(entry)); }), listOperations: vi.fn(async () => [...records.values()].map((entry) => structuredClone(entry))), removeOperation: vi.fn(async (id: string) => { records.delete(id); }) } satisfies ArtifactOperationJournal & { records: Map<string, ArtifactOperation> };
}

describe("explicit history and lifecycle operations", () => {
  it("persists an uncertain intent before contacting the service and clears only after confirmation", async () => {
    const store = journal();
    const privacy = createArtifactPrivacy(authority());
    const execute = vi.fn(async () => { expect(store.records.get(ids.group)?.state).toBe("uncertain"); return "receipt"; });
    const confirmed = vi.fn();
    const controller = createArtifactOperations({ privacy, journal: store, artifactId: ids.artifact, execute, onConfirmed: confirmed });
    expect(await controller.run(operation())).toBe("receipt");
    expect(store.records.size).toBe(0);
    expect(confirmed).toHaveBeenCalledWith(operation(), "receipt");
    expect(controller.getSnapshot().phase).toBe("idle");
    controller.dispose();
  });
  it("never auto-replays recovered or ambiguous operations and uses the same body on explicit retry", async () => {
    const store = journal();
    const execute = vi.fn().mockRejectedValueOnce(new ArtifactRequestError("timeout")).mockResolvedValue("receipt");
    const privacy = createArtifactPrivacy(authority());
    const first = createArtifactOperations({ privacy, journal: store, artifactId: ids.artifact, execute });
    await first.run(operation());
    expect(first.getSnapshot().phase).toBe("uncertain");
    await expect(first.run({ ...operation(), operationId: ids.command })).rejects.toThrow("pending");
    first.dispose();
    privacy.resume(authority({ authzVersion: 2 }));
    const second = createArtifactOperations({ privacy, journal: store, artifactId: ids.artifact, execute });
    await second.recover();
    expect(execute).toHaveBeenCalledTimes(1);
    await second.retry();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0].body).toEqual(execute.mock.calls[0]?.[0].body);
    expect(execute.mock.calls[1]?.[0].operationId).toBe(ids.group);
    expect(execute.mock.calls[1]?.[2]).toBe(true);
    second.dispose();
  });
  it("requires a reviewed new operation after a definite conflict", async () => {
    const store = journal();
    const execute = vi.fn().mockRejectedValue(new ArtifactRequestError("server", 409, { code: "CONFLICT", messageKey: "artifacts.errors.conflict", retryable: false, requestId: ids.command }));
    const controller = createArtifactOperations({ privacy: createArtifactPrivacy(authority()), journal: store, artifactId: ids.artifact, execute });
    await controller.run(operation());
    expect(controller.getSnapshot().phase).toBe("rejected");
    await controller.retry();
    expect(execute).toHaveBeenCalledOnce();
    expect(await controller.dismissRejected()).toBe(true);
    expect(store.records.size).toBe(0);
    controller.dispose();
  });
  it("suspends on 401 without sending again after same-user authentication", async () => {
    const privacy = createArtifactPrivacy(authority());
    const execute = vi.fn().mockRejectedValue(new ArtifactRequestError("invalid-response", 401));
    const controller = createArtifactOperations({ privacy, journal: journal(), artifactId: ids.artifact, execute });
    await controller.run(operation());
    expect(privacy.state).toBe("suspended");
    privacy.resume(authority());
    expect(execute).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe("authentication-required");
    controller.dispose();
  });
  it("closes access and requests private cleanup even for malformed denial", async () => {
    const privacy = createArtifactPrivacy(authority());
    const onRevoked = vi.fn(async () => undefined);
    const controller = createArtifactOperations({ privacy, journal: journal(), artifactId: ids.artifact, execute: async () => { throw new ArtifactRequestError("invalid-response", 403); }, onRevoked });
    await controller.run(operation());
    expect(privacy.state).toBe("closed");
    expect(controller.getSnapshot()).toEqual({ phase: "access-changed" });
    expect(onRevoked).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it("ignores late completion after disposal and retains the recoverable journal entry", async () => {
    let release!: (value: string) => void;
    let started!: () => void;
    const begun = new Promise<void>((resolve) => { started = resolve; });
    const delayed = new Promise<string>((resolve) => { release = resolve; });
    const store = journal();
    const confirmed = vi.fn();
    const controller = createArtifactOperations({ privacy: createArtifactPrivacy(authority()), journal: store, artifactId: ids.artifact, execute: async () => { started(); return delayed; }, onConfirmed: confirmed });
    const pending = controller.run(operation());
    await begun; controller.dispose(); release("receipt"); await pending;
    expect(confirmed).not.toHaveBeenCalled();
    expect(store.records.has(ids.group)).toBe(true);
    expect(controller.getSnapshot()).toEqual({ phase: "access-changed" });
  });
  it("requires explicit reconciliation of each recovered operation in durable order", async () => {
    const store = journal();
    const first = { ...operation(), state: "uncertain" as const };
    const second = { ...operation(), operationId: ids.command, state: "uncertain" as const };
    await store.putOperation(first); await store.putOperation(second);
    const execute = vi.fn<(operation: ArtifactOperation) => Promise<string>>(async () => "receipt");
    const controller = createArtifactOperations({ privacy: createArtifactPrivacy(authority()), journal: store, artifactId: ids.artifact, execute });
    await controller.recover();
    expect(execute).not.toHaveBeenCalled();
    await controller.retry();
    expect(execute).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ phase: "uncertain", operation: { operationId: ids.command } });
    await expect(controller.run(operation())).rejects.toThrow("pending");
    await controller.retry();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((call) => call[0].operationId)).toEqual([ids.group, ids.command]);
    expect(controller.getSnapshot().phase).toBe("idle");
    controller.dispose();
  });
  it("reveals the next operation after dismissing a definite rejection", async () => {
    const store = journal();
    await store.putOperation({ ...operation(), state: "rejected" });
    await store.putOperation({ ...operation(), operationId: ids.command, state: "uncertain" });
    const execute = vi.fn();
    const controller = createArtifactOperations({ privacy: createArtifactPrivacy(authority()), journal: store, artifactId: ids.artifact, execute });
    await controller.recover();
    expect(await controller.dismissRejected()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "uncertain", operation: { operationId: ids.command } });
    expect(execute).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("checks the durable journal again before accepting a new intent", async () => {
    const store = journal();
    const execute = vi.fn();
    const controller = createArtifactOperations({ privacy: createArtifactPrivacy(authority()), journal: store, artifactId: ids.artifact, execute });
    await controller.recover();
    await store.putOperation({ ...operation(), state: "uncertain" });
    await expect(controller.run({ ...operation(), operationId: ids.command })).rejects.toThrow("pending");
    expect(execute).not.toHaveBeenCalled();
    expect(controller.getSnapshot().operation?.operationId).toBe(ids.group);
    controller.dispose();
  });
  it("blocks after a post-ack journal read failure without resubmitting the acknowledged operation", async () => {
    const store = journal();
    store.listOperations.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("unavailable"));
    const execute = vi.fn(async () => "receipt");
    const confirmed = vi.fn();
    const controller = createArtifactOperations({ privacy: createArtifactPrivacy(authority()), journal: store, artifactId: ids.artifact, execute, onConfirmed: confirmed });
    expect(await controller.run(operation())).toBe("receipt");
    expect(store.records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({ phase: "storage-error" });
    expect(confirmed).toHaveBeenCalledOnce();
    await expect(controller.run(operation())).rejects.toThrow("pending");
    await controller.retry();
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(execute).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it("ignores a delayed journal read after disposal and same-user authority renewal", async () => {
    const store = journal();
    let resolve!: (records: ArtifactOperation[]) => void;
    store.listOperations.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const privacy = createArtifactPrivacy(authority());
    const old = createArtifactOperations({ privacy, journal: store, artifactId: ids.artifact, execute: vi.fn() });
    const published = vi.fn(); old.subscribe(published);
    const recovering = old.recover(); old.dispose();
    privacy.resume(authority({ authzVersion: 2 }));
    const fresh = createArtifactOperations({ privacy, journal: store, artifactId: ids.artifact, execute: vi.fn() });
    await fresh.recover(); resolve([]); await recovering;
    expect(privacy.state).toBe("active");
    expect(fresh.getSnapshot().phase).toBe("idle");
    expect(published).not.toHaveBeenCalled();
    expect(old.getSnapshot()).toEqual({ phase: "access-changed" });
    fresh.dispose();
  });
  it("ignores a delayed journal write after disposal and same-user authority renewal", async () => {
    const store = journal();
    let resolve!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((done) => { started = done; });
    store.putOperation.mockImplementationOnce(() => { started(); return new Promise<void>((done) => { resolve = done; }); });
    const privacy = createArtifactPrivacy(authority());
    const execute = vi.fn();
    const old = createArtifactOperations({ privacy, journal: store, artifactId: ids.artifact, execute });
    const writing = old.run(operation());
    await begun; old.dispose(); privacy.resume(authority({ authzVersion: 2 }));
    const fresh = createArtifactOperations({ privacy, journal: store, artifactId: ids.artifact, execute });
    await fresh.recover(); resolve(); await writing;
    expect(privacy.state).toBe("active");
    expect(fresh.getSnapshot().phase).toBe("idle");
    expect(execute).not.toHaveBeenCalled();
    expect(old.getSnapshot()).toEqual({ phase: "access-changed" });
    fresh.dispose();
  });
});
