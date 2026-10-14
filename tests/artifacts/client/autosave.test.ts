import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEnvelope } from "@/contracts/errors";
import type { CommandReceipt } from "@/features/artifacts/contracts";
import { ArtifactSubmissionError, createArtifactAutosave, type ArtifactAutosave, type ArtifactSubmit } from "@/features/artifacts/client/autosave";
import { openArtifactCache, type ArtifactCache } from "@/features/artifacts/client/indexed-db";
import { createArtifactPrivacy } from "@/features/artifacts/client/privacy";
import { createCommandGrouping } from "@/features/artifacts/client/grouping";
import { authority, content, draft, group, ids, pending, receipt } from "./fixtures";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup(submit: ArtifactSubmit = async (request) => receipt(request.group), factory = new IDBFactory()) {
  const privacy = createArtifactPrivacy(authority());
  const cache = await openArtifactCache(privacy, { factory });
  const confirmed = vi.fn();
  const autosave = createArtifactAutosave({ privacy, cache, submit, onConfirmed: confirmed });
  cleanup.push(() => { autosave.dispose(); cache.close(); });
  return { autosave, cache, privacy, factory, confirmed };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function serverFailure(code: ErrorEnvelope["code"]): ArtifactSubmissionError {
  return new ArtifactSubmissionError("server", { code, messageKey: "artifacts.errors.conflict", retryable: false, requestId: ids.command, ...(code === "CONFLICT" ? { conflictRefs: [{ kind: "target", objectId: ids.artifact, targetId: "paragraph-1", reason: "before-hash", expectedHash: "a".repeat(64), currentHash: "b".repeat(64) }] as ErrorEnvelope["conflictRefs"] } : {}) });
}

async function enqueue(autosave: ArtifactAutosave) {
  await autosave.writeDraft(draft());
  await autosave.enqueue(group(), { [ids.artifact]: 1 });
}

describe("durable autosave outbox", () => {
  it("waits for the actual server receipt and commits local cleanup atomically", async () => {
    const response = deferred<CommandReceipt>();
    const started = deferred<void>();
    const submit = vi.fn<ArtifactSubmit>(async () => { started.resolve(); return response.promise; });
    const { autosave, cache, confirmed } = await setup(submit);
    const saving = enqueue(autosave);
    await started.promise;
    expect(autosave.getSnapshot().status).toBe("saving");
    expect(await cache.listPending()).toHaveLength(1);
    expect(await cache.getDraft(ids.artifact)).toEqual(draft());
    response.resolve(receipt());
    await saving;
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", dirtyCount: 0, pendingCount: 0 });
    expect(await cache.getDraft(ids.artifact)).toBeUndefined();
    expect(await cache.listPending()).toEqual([]);
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[1]).toMatchObject({ expectedUserId: ids.user, idempotencyKey: ids.group });
  });

  it("keeps a newer draft when an earlier generation is acknowledged", async () => {
    const response = deferred<CommandReceipt>();
    const started = deferred<void>();
    const { autosave, cache } = await setup(async () => { started.resolve(); return response.promise; });
    const saving = enqueue(autosave);
    await started.promise;
    const newer = draft({ generation: 2, content: content("My later words") });
    await autosave.writeDraft(newer);
    response.resolve(receipt());
    await saving;
    expect(await cache.getDraft(ids.artifact)).toEqual(newer);
    expect(autosave.getSnapshot()).toMatchObject({ status: "local-only", dirtyCount: 1 });
    expect(await autosave.flush()).toBe(false);
  });

  it.each(["network", "timeout", "invalid-response"] as const)("requires explicit retry after %s and preserves exact command IDs and payload", async (kind) => {
    const submit = vi.fn<ArtifactSubmit>().mockRejectedValueOnce(new ArtifactSubmissionError(kind)).mockImplementation(async (request) => receipt(request.group));
    const { autosave, cache } = await setup(submit);
    await enqueue(autosave);
    expect(autosave.getSnapshot().status).toBe("uncertain");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await autosave.flush()).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    await autosave.retry();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0]).toEqual(submit.mock.calls[0]?.[0]);
    expect(submit.mock.calls[1]?.[1].idempotencyKey).toBe(ids.group);
    expect(await cache.listPending()).toEqual([]);
  });

  it("persists changed input as a new command while the ambiguous old command remains immutable", async () => {
    const submit = vi.fn<ArtifactSubmit>().mockRejectedValue(new ArtifactSubmissionError("network"));
    const { autosave, cache } = await setup(submit);
    await enqueue(autosave);
    const changed = group({ commandGroupId: crypto.randomUUID() });
    changed.commands[0]!.commandId = crypto.randomUUID();
    changed.commands[0]!.operations[0]!.value = { text: "Later words" };
    await autosave.writeDraft(draft({ generation: 2, content: content("Later words") }));
    await autosave.enqueue(changed, { [ids.artifact]: 2 });
    expect((await cache.listPending()).map((entry) => entry.group)).toEqual([group(), changed]);
    const invalidReuse = structuredClone(changed);
    invalidReuse.commandGroupId = ids.group;
    await expect(autosave.enqueue(invalidReuse, { [ids.artifact]: 2 })).rejects.toThrow("reused");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("retains local content and authorized conflict references without a blind overwrite", async () => {
    const submit = vi.fn<ArtifactSubmit>().mockRejectedValue(serverFailure("CONFLICT"));
    const { autosave, cache } = await setup(submit);
    await enqueue(autosave);
    expect(autosave.getSnapshot().status).toBe("conflict");
    expect((await cache.listPending())[0]?.conflict?.conflictRefs?.[0]?.currentHash).toBe("b".repeat(64));
    expect(await cache.getDraft(ids.artifact)).toEqual(draft());
    await autosave.retry();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await autosave.flush()).toBe(false);
  });

  it("requires same-account reauthentication and a separate explicit retry after 401", async () => {
    const submit = vi.fn<ArtifactSubmit>().mockRejectedValueOnce(serverFailure("UNAUTHENTICATED")).mockImplementation(async (request) => receipt(request.group));
    const { autosave, privacy } = await setup(submit);
    await enqueue(autosave);
    expect(privacy.state).toBe("suspended");
    expect(autosave.getSnapshot().status).toBe("authentication-required");
    await expect(autosave.retry()).rejects.toThrow("accessChanged");
    autosave.resumeAfterAuthentication(authority());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await autosave.flush()).toBe(false);
    await autosave.retry();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("does not resume the old outbox under a different account", async () => {
    const submit = vi.fn<ArtifactSubmit>().mockRejectedValue(serverFailure("UNAUTHENTICATED"));
    const { autosave, privacy } = await setup(submit);
    await enqueue(autosave);
    expect(() => autosave.resumeAfterAuthentication(authority({ userId: ids.otherUser }))).toThrow("accessChanged");
    expect(privacy.state).toBe("closed");
    expect(autosave.getSnapshot()).toMatchObject({ status: "access-changed", pendingCount: 0, dirtyCount: 0 });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("requires fresh authorization reconciliation when the same account's role version changes", async () => {
    const { autosave, privacy } = await setup(async () => { throw serverFailure("UNAUTHENTICATED"); });
    await enqueue(autosave);
    expect(() => autosave.resumeAfterAuthentication(authority({ authzVersion: 2 }))).toThrow("accessChanged");
    expect(privacy.state).toBe("closed");
    expect(autosave.getSnapshot().status).toBe("access-changed");
  });

  it("treats a cross-connection revocation token as access loss, not a retryable storage error", async () => {
    const first = await setup();
    const other = await setup(undefined, first.factory);
    await other.cache.clearPrivate();
    await first.autosave.enqueue(group(), { [ids.artifact]: 1 });
    expect(first.privacy.state).toBe("closed");
    expect(first.autosave.getSnapshot().status).toBe("access-changed");
  });

  it.each(["FORBIDDEN", "NOT_FOUND"] as const)("clears private cache on %s and cannot rehydrate a delayed response", async (code) => {
    const { autosave, privacy, factory } = await setup(async () => { throw serverFailure(code); });
    await enqueue(autosave);
    expect(privacy.state).toBe("closed");
    expect(autosave.getSnapshot().status).toBe("access-changed");
    const reopened = await setup(undefined, factory);
    expect(await reopened.cache.getDraft(ids.artifact)).toBeUndefined();
    expect(await reopened.cache.listPending()).toEqual([]);
  });

  it("ignores a response arriving after confirmed signout, including confirmation callbacks", async () => {
    const response = deferred<CommandReceipt>();
    const started = deferred<void>();
    const { autosave, confirmed, factory } = await setup(async () => { started.resolve(); return response.promise; });
    const saving = enqueue(autosave);
    await started.promise;
    expect(await autosave.prepareConfirmedSignOut("discard")).toBe(true);
    expect(await autosave.confirmedSignedOut()).toBe(true);
    response.resolve(receipt());
    await saving;
    expect(confirmed).not.toHaveBeenCalled();
    const reopened = await setup(undefined, factory);
    expect(await reopened.cache.listPending()).toEqual([]);
    expect(await reopened.cache.getDraft(ids.artifact)).toBeUndefined();
  });

  it("prevents signout/export flush from treating a local-only draft as server saved", async () => {
    const { autosave, cache } = await setup();
    await autosave.writeDraft(draft());
    expect(await autosave.prepareConfirmedSignOut("save")).toBe(false);
    expect(await autosave.flush()).toBe(false);
    expect(await cache.getDraft(ids.artifact)).toEqual(draft());
  });

  it("reopens uncertain pending commands and standalone drafts without automatic replay", async () => {
    const first = await setup();
    await first.cache.putDraft(draft({ generation: 2 }));
    await first.cache.putPending(pending({ state: "uncertain" }));
    first.cache.close();
    const submit = vi.fn<ArtifactSubmit>().mockImplementation(async (request) => receipt(request.group));
    const reopened = await setup(submit, first.factory);
    await reopened.autosave.recover();
    expect(submit).not.toHaveBeenCalled();
    expect(reopened.autosave.getSnapshot()).toMatchObject({ status: "local-only", dirtyCount: 1, pendingCount: 1 });
    await reopened.autosave.retry();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(reopened.autosave.getSnapshot()).toMatchObject({ status: "local-only", dirtyCount: 1 });
    expect((await reopened.cache.getDraft(ids.artifact))?.generation).toBe(2);
  });

  it("replays recovered same-millisecond groups in durable insertion order, not UUID order", async () => {
    const first = await setup();
    const earlier = pending();
    earlier.group.commandGroupId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const later = pending({ draftGenerations: { [ids.artifact]: 2 } });
    later.group.commandGroupId = "00000000-0000-4000-8000-000000000000";
    later.group.commands[0]!.commandId = crypto.randomUUID();
    later.group.commands[0]!.baseRevision = 1;
    later.group.expectedArtifactRevisions[ids.artifact] = 1;
    await first.cache.putPending(earlier);
    await first.cache.putPending(later);
    await first.cache.putDraft(draft({ generation: 2 }));
    first.cache.close();
    let expectedBase = 0;
    const submit = vi.fn<ArtifactSubmit>(async (request) => {
      expect(request.group.commands[0]?.baseRevision).toBe(expectedBase++);
      return receipt(request.group);
    });
    const reopened = await setup(submit, first.factory);
    await reopened.autosave.recover();
    await reopened.autosave.retry();
    expect(submit.mock.calls.map(([request]) => request.group.commandGroupId)).toEqual([earlier.group.commandGroupId, later.group.commandGroupId]);
    expect(reopened.autosave.getSnapshot().status).toBe("saved");
  });

  it("does not call the server when durable queue storage fails", async () => {
    const submit = vi.fn<ArtifactSubmit>();
    const { autosave, cache } = await setup(submit);
    await autosave.writeDraft(draft());
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    await autosave.enqueue(group(), { [ids.artifact]: 1 });
    expect(autosave.getSnapshot().status).toBe("storage-error");
    expect(submit).not.toHaveBeenCalled();
    expect(await cache.getDraft(ids.artifact)).toEqual(draft());
  });

  it("never labels a failed local draft write as locally persisted", async () => {
    const { autosave } = await setup();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    await expect(autosave.writeDraft(draft())).rejects.toMatchObject({ reason: "quota" });
    expect(autosave.getSnapshot()).toMatchObject({ status: "storage-error", locallyPersisted: false });
  });

  it("rejects a receipt for another group instead of cleaning up the draft", async () => {
    const wrong = receipt();
    wrong.commandGroupId = crypto.randomUUID();
    const { autosave, cache, confirmed } = await setup(async () => wrong);
    await enqueue(autosave);
    expect(autosave.getSnapshot().status).toBe("uncertain");
    expect(await cache.getDraft(ids.artifact)).toEqual(draft());
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("connects the real 700 ms grouping timer to durable autosave and flush", async () => {
    const privacy = createArtifactPrivacy(authority());
    const cache: ArtifactCache = await openArtifactCache(privacy, { factory: new IDBFactory() });
    const submit = vi.fn<ArtifactSubmit>().mockImplementation(async (request) => receipt(request.group));
    const grouping = createCommandGrouping({ onReady: (command) => { void autosave.enqueue(command, { [ids.artifact]: 1 }); } });
    const autosave: ArtifactAutosave = createArtifactAutosave({ privacy, cache, submit, flushGroups: () => { grouping.flush(); } });
    cleanup.push(() => { grouping.dispose(); autosave.dispose(); cache.close(); });
    await autosave.writeDraft(draft());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const raw = group();
    grouping.stage(raw, "typing", "paragraph-1");
    vi.advanceTimersByTime(699);
    expect(submit).not.toHaveBeenCalled();
    expect(grouping.pending).toBe(true);
    expect(await autosave.flush()).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
