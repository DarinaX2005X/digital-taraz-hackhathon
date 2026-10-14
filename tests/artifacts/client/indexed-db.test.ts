import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openArtifactCache, ArtifactStorageError, type ArtifactCache } from "@/features/artifacts/client/indexed-db";
import { createArtifactPrivacy, PrivacyBoundaryError } from "@/features/artifacts/client/privacy";
import { authority, content, draft, ids, pending } from "./fixtures";

const caches: ArtifactCache[] = [];
afterEach(() => { for (const cache of caches.splice(0)) cache.close(); vi.restoreAllMocks(); });
async function setup(factory = new IDBFactory(), access = authority()) {
  const privacy = createArtifactPrivacy(access);
  const cache = await openArtifactCache(privacy, { factory });
  caches.push(cache);
  return { privacy, cache, factory };
}

describe("scoped IndexedDB drafts", () => {
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

  it("invalidates old cache connections and removes content on authz change", async () => {
    const first = await setup();
    await first.cache.putDraft(draft());
    const second = await setup(first.factory, authority({ authzVersion: 2 }));
    expect(await second.cache.getDraft(ids.artifact)).toBeUndefined();
    await expect(first.cache.getDraft(ids.artifact)).rejects.toBeInstanceOf(PrivacyBoundaryError);
    await expect(setup(first.factory, authority())).rejects.toBeInstanceOf(PrivacyBoundaryError);
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
