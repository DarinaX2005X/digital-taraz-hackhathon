import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openArtifactCache, ArtifactStorageError, type ArtifactCache } from "@/features/artifacts/client/indexed-db";
import { createArtifactPrivacy, PrivacyBoundaryError } from "@/features/artifacts/client/privacy";
import { createArtifactOperations, type ArtifactOperation } from "@/features/artifacts/client/operations";
import { authority, content, draft, ids, pending, snapshot } from "./fixtures";

const caches: ArtifactCache[] = [];
afterEach(() => { for (const cache of caches.splice(0)) cache.close(); vi.restoreAllMocks(); });
async function setup(factory = new IDBFactory(), access = authority()) {
  const privacy = createArtifactPrivacy(access);
  const cache = await openArtifactCache(privacy, { factory });
  caches.push(cache);
  return { privacy, cache, factory };
}

describe("scoped IndexedDB drafts", () => {
  it("upgrades version 1 without losing drafts or changing the original request authority", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const opening = factory.open("tirlik-artifact-drafts", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("authority", { keyPath: "partition" });
        for (const name of ["drafts", "pending", "history"]) opening.result.createObjectStore(name, { keyPath: "key" }).createIndex("partition", "partition");
      };
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const partition = `${ids.user}/${ids.workspace}`;
        const tx = db.transaction(["authority", "drafts", "pending"], "readwrite");
        tx.objectStore("authority").put({ partition, token: ids.command, authzVersion: 1, nextSequence: 1 });
        tx.objectStore("drafts").put({ key: [partition, ids.artifact], partition, authzVersion: 1, value: draft() });
        const legacy = pending(); delete legacy.expectedAuthzVersion;
        tx.objectStore("pending").put({ key: [partition, ids.group], partition, authzVersion: 1, value: legacy, sequence: 1 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const next = await setup(factory, authority({ authzVersion: 2 }));
    expect(await next.cache.getDraft(ids.artifact)).toEqual(draft());
    expect((await next.cache.listPending())[0]?.expectedAuthzVersion).toBe(1);
  });
  it("persists lifecycle intents unchanged across reopen and rejects ID reuse with another payload", async () => {
    const first = await setup();
    const operation: ArtifactOperation = { operationId: ids.group, artifactId: ids.artifact, kind: "rename", state: "uncertain", createdAt: "2026-10-14T00:00:00.000Z", body: { workspaceId: ids.workspace, expectedAuthzVersion: 1, baseRevision: 0, title: "Saved name" } };
    await first.cache.putOperation(operation);
    await expect(first.cache.putOperation({ ...operation, body: { ...operation.body, title: "Changed" } })).rejects.toMatchObject({ reason: "corrupt" });
    first.cache.close();
    const next = await setup(first.factory, authority({ authzVersion: 2 }));
    expect(await next.cache.listOperations(ids.artifact)).toEqual([operation]);
    await next.cache.removeOperation(ids.group);
    expect(await next.cache.listOperations(ids.artifact)).toEqual([]);
  });
  it("reopens confirmed history and rejects another actor", async () => {
    const first = await setup();
    const value = snapshot();
    const history = { viewer: value.viewer, artifactId: ids.artifact, groups: value.history, cursor: value.cursor };
    await first.cache.putHistory(history);
    first.cache.close();
    const second = await setup(first.factory);
    expect(await second.cache.getHistory(ids.artifact)).toEqual(history);
    await expect(second.cache.putHistory({ ...history, viewer: { ...history.viewer, userId: ids.otherUser } })).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("clears history on access changes and enforces last-100", async () => {
    const first = await setup();
    const value = snapshot();
    const history = { viewer: value.viewer, artifactId: ids.artifact, groups: value.history, cursor: value.cursor };
    await first.cache.putHistory(history);
    await expect(first.cache.putHistory({ ...history, groups: Array.from({ length: 101 }, () => history.groups[0]!) })).rejects.toThrow();
    const second = await setup(first.factory, authority({ authzVersion: 2 }));
    expect(await second.cache.getHistory(ids.artifact)).toBeUndefined();
    await expect(first.cache.getHistory(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("discards exact reviewed state atomically and preserves concurrent changes", async () => {
    const { cache } = await setup();
    await cache.putDraft(draft()); await cache.putPending(pending());
    await cache.discardReviewed([draft()], [pending()]);
    expect(await cache.getDraft(ids.artifact)).toBeUndefined();
    expect(await cache.listPending()).toEqual([]);
    await cache.putDraft(draft({ generation: 2 })); await cache.putPending(pending());
    await expect(cache.discardReviewed([draft()], [pending()])).rejects.toMatchObject({ reason: "blocked" });
    expect((await cache.getDraft(ids.artifact))?.generation).toBe(2);
    expect(await cache.listPending()).toEqual([pending()]);
  });
  it("filters unrelated groups for single-artifact recovery", async () => {
    const first = await setup(undefined, authority({ artifactIds: [ids.artifact, ids.otherArtifact] }));
    await first.cache.putPending(pending());
    first.privacy.resume(authority({ artifactIds: [ids.otherArtifact] }));
    expect(await first.cache.listPending(ids.otherArtifact)).toEqual([]);
    await expect(first.cache.listPending(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("commits a draft and unchanged pending payload across connection reopen", async () => {
    const first = await setup();
    await first.cache.putDraft(draft());
    await first.cache.putPending(pending({ state: "uncertain" }));
    first.cache.close();
    const second = await setup(first.factory);
    expect(await second.cache.getDraft(ids.artifact)).toEqual(draft());
    expect(await second.cache.listPending()).toEqual([pending({ state: "uncertain" })]);
  });

  it("preserves insertion order across reopen with equal timestamps and reverse lexical UUIDs", async () => {
    const first = await setup();
    const earlier = pending();
    earlier.group.commandGroupId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const later = pending();
    later.group.commandGroupId = "00000000-0000-4000-8000-000000000000";
    later.group.commands[0]!.commandId = crypto.randomUUID();
    later.group.commands[0]!.baseRevision = 1;
    later.group.expectedArtifactRevisions[ids.artifact] = 1;
    await first.cache.putPending(earlier);
    await first.cache.putPending(later);
    await first.cache.putPending({ ...earlier, state: "uncertain" });
    first.cache.close();
    const second = await setup(first.factory);
    expect((await second.cache.listPending()).map((entry) => entry.group.commandGroupId)).toEqual([earlier.group.commandGroupId, later.group.commandGroupId]);
  });

  it("cannot recover another user or workspace's records", async () => {
    const first = await setup();
    await first.cache.putDraft(draft());
    await first.cache.putPending(pending());
    for (const access of [authority({ userId: ids.otherUser }), authority({ workspaceId: ids.otherWorkspace })]) {
      const next = await setup(first.factory, access);
      expect(await next.cache.getDraft(ids.artifact)).toBeUndefined();
      expect(await next.cache.listPending()).toEqual([]);
    }
  });

  it("does not expose an artifact omitted by a fresh server authority", async () => {
    const { cache, privacy } = await setup();
    await cache.putDraft(draft());
    privacy.suspend();
    privacy.resume(authority({ artifactIds: [] }));
    await expect(cache.getDraft(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });

  it("invalidates old connections but retains drafts explicitly reauthorized at a newer version", async () => {
    const first = await setup();
    await first.cache.putDraft(draft());
    const second = await setup(first.factory, authority({ authzVersion: 2 }));
    expect(await second.cache.getDraft(ids.artifact)).toEqual(draft());
    await expect(first.cache.getDraft(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await expect(setup(first.factory, authority())).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("quarantines unlisted records on a partial authz refresh without discarding them", async () => {
    const first = await setup(undefined, authority({ artifactIds: [ids.artifact, ids.otherArtifact] }));
    await first.cache.putDraft(draft());
    await first.cache.putDraft(draft({ artifactId: ids.otherArtifact }));
    await first.cache.putPending(pending({ state: "uncertain" }));
    await first.cache.revalidate(authority({ authzVersion: 2, artifactIds: [ids.artifact] }));
    expect(await first.cache.getDraft(ids.artifact)).toEqual(draft());
    expect((await first.cache.listPending(ids.artifact))[0]?.expectedAuthzVersion).toBe(1);
    await expect(first.cache.getDraft(ids.otherArtifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    const later = await setup(first.factory, authority({ authzVersion: 2, artifactIds: [ids.otherArtifact] }));
    expect(await later.cache.getDraft(ids.otherArtifact)).toEqual(draft({ artifactId: ids.otherArtifact }));
  });
  it("purges explicitly denied records while retaining independently authorized work", async () => {
    const first = await setup(undefined, authority({ artifactIds: [ids.artifact, ids.otherArtifact] }));
    await first.cache.putDraft(draft());
    await first.cache.putDraft(draft({ artifactId: ids.otherArtifact }));
    await first.cache.putPending(pending());
    await first.cache.revalidate(authority({ authzVersion: 2, artifactIds: [ids.otherArtifact] }), [ids.artifact]);
    expect(await first.cache.getDraft(ids.otherArtifact)).toEqual(draft({ artifactId: ids.otherArtifact }));
    const later = await setup(first.factory, authority({ authzVersion: 3, artifactIds: [ids.artifact] }));
    expect(await later.cache.getDraft(ids.artifact)).toBeUndefined();
    expect(await later.cache.listPending(ids.artifact)).toEqual([]);
  });
  it("scope revocation clears affected records and invalidates old leases without clearing other work", async () => {
    const first = await setup(undefined, authority({ artifactIds: [ids.artifact, ids.otherArtifact] }));
    const otherTab = await setup(first.factory, authority({ artifactIds: [ids.artifact, ids.otherArtifact] }));
    await first.cache.putDraft(draft());
    await first.cache.putDraft(draft({ artifactId: ids.otherArtifact }));
    await first.cache.clearArtifacts([ids.artifact]);
    await expect(otherTab.cache.getDraft(ids.otherArtifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    const fresh = await setup(first.factory, authority({ artifactIds: [ids.artifact, ids.otherArtifact] }));
    expect(await fresh.cache.getDraft(ids.artifact)).toBeUndefined();
    expect(await fresh.cache.getDraft(ids.otherArtifact)).toEqual(draft({ artifactId: ids.otherArtifact }));
  });
  it("keeps other current connections valid during a same-version read revalidation", async () => {
    const first = await setup();
    const otherTab = await setup(first.factory);
    await first.cache.putDraft(draft());
    const oldLocalLease = first.privacy.capture();
    await first.cache.revalidate(authority());
    expect(() => first.privacy.assert(oldLocalLease)).toThrow(PrivacyBoundaryError);
    expect(await otherTab.cache.getDraft(ids.artifact)).toEqual(draft());
    await otherTab.cache.putDraft(draft({ generation: 2 }));
    expect((await first.cache.getDraft(ids.artifact))?.generation).toBe(2);
  });
  it("still invalidates other connections for explicit same-version denial", async () => {
    const access = authority({ artifactIds: [ids.artifact, ids.otherArtifact] });
    const first = await setup(undefined, access);
    const otherTab = await setup(first.factory, access);
    await first.cache.putDraft(draft());
    await first.cache.revalidate(authority({ artifactIds: [ids.otherArtifact] }), [ids.artifact]);
    await expect(otherTab.cache.getDraft(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
  it("recovers a multi-artifact undo from a secondary affected artifact", async () => {
    const first = await setup(undefined, authority({ artifactIds: [ids.artifact, ids.otherArtifact] }));
    const operation = { operationId: ids.group, artifactId: ids.artifact, kind: "undo" as const, state: "uncertain" as const, createdAt: "2026-10-14T00:00:00.000Z", body: { workspaceId: ids.workspace, expectedAuthzVersion: 1, commandGroupId: ids.group, targetCommandGroupId: ids.command, expectedArtifactRevisions: { [ids.artifact]: 2, [ids.otherArtifact]: 3 }, expectedSourceRevisions: {} } };
    await first.cache.putOperation(operation);
    const secondary = await setup(first.factory, authority({ authzVersion: 2, artifactIds: [ids.otherArtifact] }));
    expect(new Set(await secondary.cache.recoveryTargetIds(ids.otherArtifact))).toEqual(new Set([ids.artifact, ids.otherArtifact]));
    await expect(secondary.cache.listOperations(ids.otherArtifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await secondary.cache.revalidate(authority({ authzVersion: 2, artifactIds: [ids.artifact, ids.otherArtifact] }));
    expect(await secondary.cache.listOperations(ids.otherArtifact)).toEqual([operation]);
    expect(await secondary.cache.listOperations(ids.artifact)).toEqual([operation]);
    const execute = vi.fn();
    const controller = createArtifactOperations({ privacy: secondary.privacy, journal: secondary.cache, artifactId: ids.otherArtifact, execute });
    await controller.recover();
    expect(controller.getSnapshot().operation?.operationId).toBe(ids.group);
    await expect(controller.run({ operationId: ids.content, artifactId: ids.otherArtifact, kind: "rename", state: "ready", createdAt: "2026-10-14T00:00:00.000Z", body: { workspaceId: ids.workspace, expectedAuthzVersion: 2, baseRevision: 3, title: "Dependent change" } })).rejects.toThrow("pending");
    expect(execute).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("aborts a write and read captured before session expiry", async () => {
    const { cache, privacy } = await setup();
    const write = cache.putDraft(draft());
    privacy.suspend();
    await expect(write).rejects.toBeInstanceOf(PrivacyBoundaryError);
    privacy.resume(authority());
    expect(await cache.getDraft(ids.artifact)).toBeUndefined();
    await cache.putDraft(draft());
    const read = cache.getDraft(ids.artifact);
    privacy.suspend();
    await expect(read).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });

  it("explicit same-account resume does not authorize a different account", async () => {
    const { privacy, cache } = await setup();
    await cache.putDraft(draft());
    privacy.suspend();
    expect(() => privacy.resume(authority({ userId: ids.otherUser }))).toThrow(PrivacyBoundaryError);
    await expect(cache.getDraft(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    expect(privacy.state).toBe("closed");
  });

  it("keeps newest generation when old write finishes later and rejects changed payload for one ID", async () => {
    const { cache } = await setup();
    await cache.putDraft(draft({ generation: 2, content: content("newer") }));
    await cache.putDraft(draft({ generation: 1, content: content("older") }));
    expect((await cache.getDraft(ids.artifact))?.content).toEqual(content("newer"));
    await expect(cache.putDraft(draft({ generation: 2, content: content("changed same generation") }))).rejects.toBeInstanceOf(ArtifactStorageError);
    await cache.putPending(pending());
    const changed = pending();
    changed.group.commands[0]!.reason = "Changed command";
    await expect(cache.putPending(changed)).rejects.toBeInstanceOf(ArtifactStorageError);
    expect(await cache.listPending()).toEqual([pending()]);
  });

  it("clears one revoked workspace and invalidates another open tab", async () => {
    const first = await setup();
    const otherTab = await setup(first.factory);
    const otherWorkspace = await setup(first.factory, authority({ workspaceId: ids.otherWorkspace }));
    await first.cache.putDraft(draft());
    await otherWorkspace.cache.putDraft(draft());
    await first.cache.clearPrivate();
    await expect(otherTab.cache.getDraft(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    expect(await otherWorkspace.cache.getDraft(ids.artifact)).toEqual(draft());
    const reopened = await setup(first.factory);
    expect(await reopened.cache.getDraft(ids.artifact)).toBeUndefined();
  });

  it("confirmed signout removes all user workspaces while preserving another user's data", async () => {
    const first = await setup();
    const workspace = await setup(first.factory, authority({ workspaceId: ids.otherWorkspace }));
    const other = await setup(first.factory, authority({ userId: ids.otherUser }));
    await first.cache.putDraft(draft());
    await workspace.cache.putDraft(draft());
    await other.cache.putDraft(draft());
    await first.cache.clearUserPrivate();
    await expect(workspace.cache.getDraft(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    expect(await other.cache.getDraft(ids.artifact)).toEqual(draft());
    const reopened = await setup(first.factory, authority({ workspaceId: ids.otherWorkspace }));
    expect(await reopened.cache.getDraft(ids.artifact)).toBeUndefined();
  });

  it("reports unavailable and quota failures without inventing a saved draft", async () => {
    await expect(openArtifactCache(createArtifactPrivacy(authority()))).rejects.toMatchObject({ reason: "unavailable" });
    const { cache } = await setup();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("storage full", "QuotaExceededError"); });
    await expect(cache.putDraft(draft())).rejects.toMatchObject({ reason: "quota" });
    expect(await cache.getDraft(ids.artifact)).toBeUndefined();
  });

  it("rejects a queued group whose affected material is no longer permitted", async () => {
    const { cache, privacy } = await setup();
    await cache.putPending(pending());
    privacy.resume(authority({ artifactIds: [] }));
    await expect(cache.listPending()).rejects.toBeInstanceOf(PrivacyBoundaryError);
  });
});
