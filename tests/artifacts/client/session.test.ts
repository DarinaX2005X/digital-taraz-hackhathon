import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createArtifactSession } from "@/features/artifacts/client/session";
import { ArtifactRequestError, createArtifactClient, type ArtifactClient } from "@/features/artifacts/client/transport";
import { openArtifactCache } from "@/features/artifacts/client/indexed-db";
import { createArtifactPrivacy, PrivacyBoundaryError } from "@/features/artifacts/client/privacy";
import { buildArtifactOperation, createActionDraft } from "@/features/artifacts/ui/action-dialog";
import type { ArtifactVersionDetail } from "@/features/artifacts/contracts";
import { authority, draft, ids, pending, snapshot } from "./fixtures";

function client() {
  const initial = snapshot();
  return {
    ...createArtifactClient({ fetch: vi.fn<typeof fetch>() }),
    snapshot: vi.fn<ArtifactClient["snapshot"]>().mockResolvedValue(initial),
    access: vi.fn<ArtifactClient["access"]>(async (artifactIds, options) => ({ viewer: options.viewer, authorizedArtifactIds: artifactIds, editableArtifactIds: artifactIds, unavailableArtifactIds: [] })),
    versions: vi.fn<ArtifactClient["versions"]>().mockResolvedValue({ viewer: initial.viewer, artifactId: ids.artifact, versions: [initial.version], nextBeforeRevision: null }),
    apply: vi.fn<ArtifactClient["apply"]>(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function detail(): ArtifactVersionDetail { const value = snapshot(); return { viewer: value.viewer, artifact: value.artifact, version: value.version, content: value.content, sourceFreshness: [] }; }

describe("artifact session privacy and recovery", () => {
  it("hides private state on a confirmed 401 and notifies the account gate", async () => {
    const api = client(), expired = vi.fn();
    const session = createArtifactSession({ initial: snapshot(), client: api, cache: { factory: new IDBFactory() }, onAuthenticationRequired: expired });
    try {
      await session.initialize();
      api.snapshot.mockRejectedValue(new ArtifactRequestError("server", 401));
      await session.refresh();
      expect(session.getSnapshot()).toMatchObject({ phase: "authentication-required", drafts: [], pending: [], versions: [] });
      expect(session.getSnapshot().snapshot).toBeUndefined();
      expect(expired).toHaveBeenCalledOnce();
    } finally { session.dispose(); }
  });
  it("ignores a late privacy failure from an earlier session generation", async () => {
    let reject!: (error: Error) => void;
    const late = new Promise<ArtifactVersionDetail>((_, fail) => { reject = fail; });
    const api = { ...client(), version: vi.fn<ArtifactClient["version"]>().mockReturnValue(late) };
    const session = createArtifactSession({ initial: snapshot(), client: api, cache: { factory: new IDBFactory() } });
    try {
      await session.initialize();
      const reading = session.selectVersion(0);
      session.suspend(); await session.resume();
      reject(new PrivacyBoundaryError()); await reading;
      expect(session.getSnapshot().phase).toBe("ready");
      expect(session.getSnapshot().snapshot?.artifact.id).toBe(ids.artifact);
    } finally { session.dispose(); }
  });
  it("masks the view when another connection invalidates private cache authority", async () => {
    const factory = new IDBFactory();
    const session = createArtifactSession({ initial: snapshot(), client: client(), cache: { factory } });
    try {
      await session.initialize();
      const other = await openArtifactCache(createArtifactPrivacy(authority()), { factory });
      await other.clearUserPrivate(); other.close();
      await expect(session.writeDraft(draft())).rejects.toBeInstanceOf(PrivacyBoundaryError);
      expect(session.getSnapshot().phase).toBe("access-changed");
      expect(session.getSnapshot().snapshot).toBeUndefined();
      expect(session.getSnapshot().drafts).toEqual([]);
    } finally { session.dispose(); }
  });
  it("branches only the exact reviewed draft and retains it until explicit discard", async () => {
    const api = { ...client(), branch: vi.fn<ArtifactClient["branch"]>().mockResolvedValue({ viewer: snapshot().viewer, artifact: { ...snapshot().artifact, id: ids.otherArtifact }, version: { ...snapshot().version, artifactId: ids.otherArtifact }, cursor: "2" }) };
    const session = createArtifactSession({ initial: snapshot(), client: api, cache: { factory: new IDBFactory() } });
    try {
      await session.initialize(); await session.writeDraft(draft());
      const action = { kind: "branch" as const, snapshot: snapshot(), localContent: draft().content, localParentRevision: draft().baseRevision };
      const operation = buildArtifactOperation(action, createActionDraft(action));
      await expect(session.run(operation)).rejects.toThrow("artifacts.errors.pending");
      await session.branchReviewedDraft(operation, draft());
      expect(api.branch).toHaveBeenCalledOnce();
      expect(session.getSnapshot().drafts).toEqual([draft()]);
      await session.writeDraft(draft({ generation: 2 }));
      await expect(session.branchReviewedDraft({ ...operation, operationId: crypto.randomUUID() }, draft())).rejects.toThrow("artifacts.recovery.changed");
      await expect(session.discardReviewed({ drafts: [draft()], pending: [] })).rejects.toMatchObject({ reason: "blocked" });
      expect(session.getSnapshot().drafts[0]?.generation).toBe(2);
    } finally { session.dispose(); }
  });
  it("recovers a durable draft and outbox without automatically posting", async () => {
    const factory = new IDBFactory();
    const cache = await openArtifactCache(createArtifactPrivacy(authority()), { factory });
    await cache.putDraft(draft()); await cache.putPending(pending()); cache.close();
    const api = client();
    const session = createArtifactSession({ initial: snapshot(), client: api, cache: { factory } });
    try {
      await session.initialize();
      expect(session.getSnapshot()).toMatchObject({ storageReady: true, drafts: [draft()], pending: [pending()] });
      expect(api.apply).not.toHaveBeenCalled();
      expect(await session.discardReviewed()).toBe(false);
    } finally { session.dispose(); }
  });
  it("allows a reviewed draft branch from an archived material that permits duplication", async () => {
    const factory = new IDBFactory();
    const cache = await openArtifactCache(createArtifactPrivacy(authority()), { factory });
    await cache.putDraft(draft()); cache.close();
    const initial = snapshot(); initial.artifact.status = "archived"; initial.permissions.edit = false;
    const api = { ...client(), branch: vi.fn<ArtifactClient["branch"]>().mockResolvedValue({ viewer: initial.viewer, artifact: { ...initial.artifact, id: ids.otherArtifact }, version: { ...initial.version, artifactId: ids.otherArtifact }, cursor: "2" }) };
    api.snapshot.mockResolvedValue(initial);
    const session = createArtifactSession({ initial, client: api, cache: { factory } });
    try {
      await session.initialize();
      const action = { kind: "branch" as const, snapshot: initial, localContent: draft().content, localParentRevision: draft().baseRevision };
      await session.branchReviewedDraft(buildArtifactOperation(action, createActionDraft(action)), draft());
      expect(api.branch).toHaveBeenCalledOnce();
      expect(session.getSnapshot().drafts).toEqual([draft()]);
    } finally { session.dispose(); }
  });
  it("keeps old request authority across a harmless permission epoch advance", async () => {
    const factory = new IDBFactory();
    const cache = await openArtifactCache(createArtifactPrivacy(authority()), { factory });
    await cache.putDraft(draft()); await cache.putPending(pending()); cache.close();
    const api = client();
    const session = createArtifactSession({ initial: snapshot(), client: api, cache: { factory } });
    try {
      await session.initialize();
      const next = snapshot(); next.viewer.authzVersion = 2; api.snapshot.mockResolvedValue(next);
      await session.refresh();
      expect(session.getSnapshot().snapshot?.viewer.authzVersion).toBe(2);
      expect(session.getSnapshot().pending[0]?.expectedAuthzVersion).toBe(1);
      expect(session.getSnapshot().drafts).toEqual([draft()]);
      expect(api.apply).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });
  it("hides all private views on suspension and restores only after explicit fresh read", async () => {
    const api = client();
    const session = createArtifactSession({ initial: snapshot(), client: api, cache: { factory: new IDBFactory() } });
    try {
      await session.initialize(); await session.writeDraft(draft()); session.suspend();
      expect(session.getSnapshot()).toMatchObject({ phase: "authentication-required", drafts: [], versions: [], pending: [] });
      expect(session.getSnapshot().snapshot).toBeUndefined();
      expect(api.snapshot).not.toHaveBeenCalled();
      await session.resume();
      expect(api.snapshot).toHaveBeenCalledOnce();
      expect(session.getSnapshot().drafts).toEqual([draft()]);
      expect(api.apply).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });
  it("does not publish a late private response after the identity epoch changes", async () => {
    let active = true;
    const pendingRead = deferred<ArtifactVersionDetail>();
    const api = { ...client(), version: vi.fn<ArtifactClient["version"]>().mockReturnValue(pendingRead.promise) };
    const session = createArtifactSession({ initial: snapshot(), client: api, cache: { factory: new IDBFactory() }, isIdentityCurrent: () => active });
    try {
      await session.initialize();
      const reading = session.selectVersion(1);
      active = false; pendingRead.resolve(detail()); await reading;
      expect(session.getSnapshot().phase).toBe("authentication-required");
      expect(session.getSnapshot().selectedVersion).toBeUndefined();
      expect(session.getSnapshot().snapshot).toBeUndefined();
    } finally { session.dispose(); }
  });
  it("clears every previous-user partition on account switch", async () => {
    const factory = new IDBFactory();
    const session = createArtifactSession({ initial: snapshot(), client: client(), cache: { factory } });
    try {
      await session.initialize(); await session.writeDraft(draft());
      expect(await session.switchAccount()).toBe(true);
      const cache = await openArtifactCache(createArtifactPrivacy(authority()), { factory });
      try { expect(await cache.getDraft(ids.artifact)).toBeUndefined(); } finally { cache.close(); }
      expect(session.getSnapshot().snapshot).toBeUndefined();
    } finally { session.dispose(); }
  });
});
