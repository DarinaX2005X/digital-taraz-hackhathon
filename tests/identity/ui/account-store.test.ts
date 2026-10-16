import { describe, expect, it, vi } from "vitest";
import type { IdentityViewer } from "@/features/identity/contracts";
import { createIdentityAccountStore } from "@/features/identity/ui/account-store";
import { guardIdentityRequest, reconcilePrivateAccess, resumePrivateAccess } from "@/features/identity/ui/private-access";
import { createIdentityClient, IdentityTransportError } from "@/features/identity/ui/transport";

const idA = "e05249af-70de-4c74-948d-9e01c88a06c3";
const idB = "c5eaf8c7-9e87-45f8-bd16-b31db3a8a169";
const sessionA = "cec4dc21-d704-422b-a3a1-f974d27898c8";
const sessionB = "fef9d541-ac9d-4e1d-b5a0-1ed9e91c9fc9";
const viewer = (id = idA, sessionId = sessionA): IdentityViewer => ({ user: { id, name: "Test person", email: "person@example.test", locale: "ru" }, session: { id: sessionId, expiresAt: "2026-10-14T10:00:00.000Z" }, workspaces: [] });
const error = (status: number) => new IdentityTransportError({ status, messageKey: status === 401 ? "identity.errors.unauthenticated" : "identity.errors.conflict", fieldErrors: {} });
const setup = () => {
  const client = { ...createIdentityClient({ fetch: vi.fn<typeof fetch>() }), me: vi.fn().mockResolvedValue(viewer()), updateProfile: vi.fn().mockResolvedValue({ user: { ...viewer().user, locale: "kk" } }) };
  return { client, store: createIdentityAccountStore(client) };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("account identity and locale persistence", () => {
  it("loads only the safe viewer DTO and sends guarded profile preference writes", async () => {
    const { store, client } = setup();
    expect(store.getSnapshot()).toEqual({ viewer: null, ready: false, authEpoch: 0 });
    await store.refresh();
    await store.persistLocale(idA, "kk");
    expect(client.me).toHaveBeenLastCalledWith({ signal: expect.any(AbortSignal), expectedUserId: idA });
    expect(client.updateProfile).toHaveBeenCalledWith({ locale: "kk" }, { signal: expect.any(AbortSignal), expectedUserId: idA });
    expect(store.getSnapshot().viewer?.user.locale).toBe("kk");
  });

  it("treats guest 401 as no signed-in account", async () => {
    const { store, client } = setup();
    client.me.mockRejectedValue(error(401));
    await expect(store.refresh()).resolves.toBeNull();
    expect(store.getSnapshot()).toEqual({ viewer: null, ready: true, authEpoch: 1 });
    await store.persistLocale(idA, "en");
    expect(client.updateProfile).not.toHaveBeenCalled();
  });

  it("does not apply a stale account's language to a newly signed-in account", async () => {
    const { store, client } = setup();
    await store.refresh();
    client.me.mockResolvedValue(viewer(idB));
    await store.persistLocale(idA, "kk");
    expect(client.updateProfile).not.toHaveBeenCalled();
    expect(store.getSnapshot().viewer?.user.id).toBe(idB);
    expect(store.getSnapshot().viewer?.user.locale).toBe("ru");
  });

  it("reconciles a server-side account mismatch before allowing another preference write", async () => {
    const { store, client } = setup();
    await store.refresh();
    client.me.mockRejectedValueOnce(error(409)).mockResolvedValue(viewer(idB));
    await expect(store.persistLocale(idA, "kk")).resolves.toBeUndefined();
    expect(client.updateProfile).not.toHaveBeenCalled();
    expect(store.getSnapshot().viewer?.user.id).toBe(idB);
  });

  it("aborts pending account lookup on logout and ignores a late result", async () => {
    const { store, client } = setup();
    await store.refresh();
    const pending = deferred<IdentityViewer>();
    client.me.mockReturnValueOnce(pending.promise);
    const save = store.persistLocale(idA, "kk");
    const signal = client.me.mock.lastCall?.[0].signal as AbortSignal;
    store.clear();
    expect(signal.aborted).toBe(true);
    pending.resolve(viewer());
    await save;
    expect(client.updateProfile).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual({ viewer: null, ready: true, authEpoch: 1 });
  });

  it("does not restore private account state from a late profile response after logout", async () => {
    const { store, client } = setup();
    await store.refresh();
    const pending = deferred<{ user: IdentityViewer["user"] }>();
    client.updateProfile.mockReturnValueOnce(pending.promise);
    const save = store.persistLocale(idA, "kk");
    await Promise.resolve();
    expect(client.updateProfile).toHaveBeenCalledTimes(1);
    store.clear();
    pending.resolve({ user: { ...viewer().user, locale: "kk" } });
    await save;
    expect(store.getSnapshot().viewer).toBeNull();
  });

  it("lets the latest account refresh win", async () => {
    const { store, client } = setup();
    const previous = deferred<IdentityViewer>();
    client.me.mockReturnValueOnce(previous.promise).mockResolvedValueOnce(viewer(idB));
    const first = store.refresh();
    await store.refresh();
    previous.resolve(viewer());
    await first;
    expect(store.getSnapshot().viewer?.user.id).toBe(idB);
  });

  it("keeps network errors retryable but does not claim a language preference was saved", async () => {
    const { store, client } = setup();
    await store.refresh();
    client.updateProfile.mockRejectedValueOnce(new Error("network"));
    await expect(store.persistLocale(idA, "kk")).rejects.toThrow("network");
    expect(store.getSnapshot().viewer?.user.locale).toBe("ru");
  });

  it("ignores profile updates for a different account", async () => {
    const { store } = setup();
    await store.refresh();
    store.acceptUser({ ...viewer(idB).user, name: "Other person" });
    expect(store.getSnapshot().viewer?.user.name).toBe("Test person");
  });

  it("publishes the invalidation epoch before notifying subscribers and preserves it through same-user refresh", async () => {
    const { store, client } = setup();
    await store.refresh();
    const observed: Array<{ userId: string | undefined; authEpoch: number }> = [];
    const unsubscribe = store.subscribe(() => { const snapshot = store.getSnapshot(); observed.push({ userId: snapshot.viewer?.user.id, authEpoch: snapshot.authEpoch }); });
    store.clear();
    await store.refresh();
    client.me.mockResolvedValueOnce(viewer(idB));
    await store.refresh();
    unsubscribe();
    expect(observed).toEqual([{ userId: undefined, authEpoch: 1 }, { userId: idA, authEpoch: 1 }, { userId: idB, authEpoch: 2 }]);
  });

  it("ignores stale scoped invalidation after another session or account became current", async () => {
    const { store, client } = setup();
    await store.refresh();
    store.clear();
    await store.refresh();
    store.invalidate(idA, 0);
    expect(store.isCurrent(idA, 1)).toBe(true);
    client.me.mockResolvedValueOnce(viewer(idB));
    await store.refresh();
    store.invalidate(idA, 1);
    expect(store.isCurrent(idB, 2)).toBe(true);
  });

  it.each([
    { name: "the same account and session", userId: idA, sessionId: sessionA, expectedEpoch: 0, phase: "active" },
    { name: "a new session for the same account", userId: idA, sessionId: sessionB, expectedEpoch: 1, phase: "resume-required" },
    { name: "a different account with the same session identifier", userId: idB, sessionId: sessionA, expectedEpoch: 1, phase: "discarded" },
    { name: "a different account and session", userId: idB, sessionId: sessionB, expectedEpoch: 1, phase: "discarded" },
  ] as const)("reconciles $name without an intermediate missing-account snapshot", async ({ userId, sessionId, expectedEpoch, phase }) => {
    const { store, client } = setup();
    await store.refresh();
    const access = { ownerId: idA, authEpoch: 0, phase: "active" as const };
    const observed: Array<{ userId: string | undefined; authEpoch: number }> = [];
    const unsubscribe = store.subscribe(() => { const snapshot = store.getSnapshot(); observed.push({ userId: snapshot.viewer?.user.id, authEpoch: snapshot.authEpoch }); });
    client.me.mockResolvedValueOnce(viewer(userId, sessionId));
    await store.refresh();
    unsubscribe();
    expect(observed).toEqual([{ userId, authEpoch: expectedEpoch }]);
    expect(store.isCurrent(idA, 0)).toBe(expectedEpoch === 0);
    const reconciled = reconcilePrivateAccess(access, store.getSnapshot());
    expect(reconciled.phase).toBe(phase);
    if (phase === "resume-required") {
      expect(resumePrivateAccess(reconciled, store.getSnapshot()).phase).toBe("active");
      store.invalidate(idA, 0);
      expect(store.isCurrent(idA, 1)).toBe(true);
    }
  });

  it("rejects an old-session operation response after same-user session replacement", async () => {
    const { store, client } = setup();
    await store.refresh();
    const pending = deferred<string>();
    const request = guardIdentityRequest(new AbortController().signal, () => pending.promise, {
      isCurrent: () => store.isCurrent(idA, 0),
      clear: () => store.invalidate(idA, 0),
      refresh: store.refresh,
    });
    client.me.mockResolvedValueOnce(viewer(idA, sessionB));
    await store.refresh();
    pending.resolve("old result");
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(store.isCurrent(idA, 1)).toBe(true);
  });

  it("aborts old-session preference writes when refresh observes a new session", async () => {
    const { store, client } = setup();
    await store.refresh();
    const pending = deferred<{ user: IdentityViewer["user"] }>();
    client.updateProfile.mockReturnValueOnce(pending.promise);
    const save = store.persistLocale(idA, "kk");
    await Promise.resolve();
    const signal = client.updateProfile.mock.lastCall?.[1].signal as AbortSignal;
    client.me.mockResolvedValueOnce(viewer(idA, sessionB));
    await store.refresh();
    expect(signal.aborted).toBe(true);
    pending.resolve({ user: { ...viewer().user, locale: "kk" } });
    await save;
    expect(store.getSnapshot().viewer?.user.locale).toBe("ru");
    expect(store.isCurrent(idA, 1)).toBe(true);
  });

  it("reconciles a session replacement discovered by preference preflight without sending its old write", async () => {
    const { store, client } = setup();
    await store.refresh();
    client.me.mockResolvedValue(viewer(idA, sessionB));
    await store.persistLocale(idA, "kk");
    expect(client.updateProfile).not.toHaveBeenCalled();
    expect(store.getSnapshot().viewer?.session.id).toBe(sessionB);
    expect(store.isCurrent(idA, 1)).toBe(true);
    expect(reconcilePrivateAccess({ ownerId: idA, authEpoch: 0, phase: "active" }, store.getSnapshot()).phase).toBe("resume-required");
  });
});
