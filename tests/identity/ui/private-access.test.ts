import { describe, expect, it, vi } from "vitest";
import type { IdentityViewer } from "@/features/identity/contracts";
import { createIdentityAccountStore, type AccountSnapshot } from "@/features/identity/ui/account-store";
import { guardIdentityRequest, reconcilePrivateAccess, resumePrivateAccess, type PrivateAccess } from "@/features/identity/ui/private-access";
import { createIdentityClient, IdentityTransportError } from "@/features/identity/ui/transport";

const idA = "e05249af-70de-4c74-948d-9e01c88a06c3";
const idB = "c5eaf8c7-9e87-45f8-bd16-b31db3a8a169";
const viewer = (id = idA): IdentityViewer => ({ user: { id, name: "Test person", email: "person@example.test", locale: "ru" }, session: { id: "cec4dc21-d704-422b-a3a1-f974d27898c8", expiresAt: "2026-10-14T10:00:00.000Z" }, workspaces: [] });
const signedIn = (id = idA, authEpoch = 0): AccountSnapshot => ({ viewer: viewer(id), ready: true, authEpoch });
const active = (): PrivateAccess => ({ ownerId: idA, authEpoch: 0, phase: "active" });
const failure = (status: number) => new IdentityTransportError({ status, messageKey: status === 401 ? "identity.errors.unauthenticated" : "identity.errors.conflict", fieldErrors: {} });

function setup() {
  const client = { ...createIdentityClient({ fetch: vi.fn<typeof fetch>() }), me: vi.fn().mockResolvedValue(viewer()) };
  const store = createIdentityAccountStore(client);
  return { client, store, binding: () => {
    const { viewer: current, authEpoch } = store.getSnapshot();
    const userId = current!.user.id;
    return { isCurrent: () => store.isCurrent(userId, authEpoch), clear: () => store.invalidate(userId, authEpoch), refresh: store.refresh };
  } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("private identity visibility and explicit recovery", () => {
  it("does not authorize private rendering before the current account is checked", () => {
    const checking: PrivateAccess = { ownerId: idA, authEpoch: 0, phase: "checking" };
    expect(reconcilePrivateAccess(checking, { viewer: null, ready: false, authEpoch: 0 }).phase).toBe("checking");
    expect(reconcilePrivateAccess(checking, signedIn()).phase).toBe("active");
    expect(reconcilePrivateAccess(checking, signedIn(idB)).phase).toBe("discarded");
  });

  it("closes a confirmed expired session and requires an explicit same-user continuation", () => {
    const locked = reconcilePrivateAccess(active(), { viewer: null, ready: true, authEpoch: 1 });
    expect(locked.phase).toBe("locked");
    expect(resumePrivateAccess(locked, { viewer: null, ready: true, authEpoch: 1 }).phase).toBe("locked");
    const returned = reconcilePrivateAccess(locked, signedIn(idA, 1));
    expect(returned.phase).toBe("resume-required");
    expect(reconcilePrivateAccess(returned, signedIn(idA, 1))).toBe(returned);
    expect(resumePrivateAccess(returned, signedIn(idA, 1)).phase).toBe("active");
  });

  it("does not miss expiry when clear and same-user refresh are batched before a render", () => {
    const returned = reconcilePrivateAccess(active(), signedIn(idA, 1));
    expect(returned.phase).toBe("resume-required");
    expect(returned.authEpoch).toBe(1);
  });

  it("never reopens the old private scope for another account", () => {
    const discarded = reconcilePrivateAccess(active(), signedIn(idB, 1));
    expect(discarded.phase).toBe("discarded");
    expect(resumePrivateAccess(discarded, signedIn(idB, 1)).phase).toBe("discarded");
    expect(resumePrivateAccess(discarded, signedIn(idA, 2)).phase).toBe("discarded");
  });
});

describe("scoped requests and direct authentication failure", () => {
  it("invalidates the current account immediately on a scoped 401, without retrying the request", async () => {
    const { store, binding } = setup();
    await store.refresh();
    const action = vi.fn().mockRejectedValue(failure(401));
    await expect(guardIdentityRequest(new AbortController().signal, action, binding())).rejects.toMatchObject({ failure: { status: 401 } });
    expect(action).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ viewer: null, ready: true, authEpoch: 1 });
    expect(reconcilePrivateAccess(active(), store.getSnapshot()).phase).toBe("locked");
  });

  it("rejects a late successful result even if the same user has already signed in again", async () => {
    const { store, binding } = setup();
    await store.refresh();
    const response = deferred<{ privateValue: string }>();
    const request = guardIdentityRequest(new AbortController().signal, () => response.promise, binding());
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    store.clear();
    await store.refresh();
    response.resolve({ privateValue: "old-session-data" });
    await rejected;
    expect(store.getSnapshot().viewer?.user.id).toBe(idA);
  });

  it("does not let an old request's 401 sign out a newly switched account", async () => {
    const { store, client, binding } = setup();
    await store.refresh();
    const response = deferred<never>();
    const request = guardIdentityRequest(new AbortController().signal, () => response.promise, binding());
    const rejected = expect(request).rejects.toMatchObject({ failure: { status: 401 } });
    client.me.mockResolvedValueOnce(viewer(idB));
    await store.refresh();
    response.reject(failure(401));
    await rejected;
    expect(store.getSnapshot().viewer?.user.id).toBe(idB);
    expect(store.getSnapshot().authEpoch).toBe(1);
  });

  it("does not start a request for an already-stale or cancelled owner", async () => {
    const { store, binding } = setup();
    await store.refresh();
    const owner = binding();
    store.clear();
    const action = vi.fn().mockResolvedValue("private");
    await expect(guardIdentityRequest(new AbortController().signal, action, owner)).rejects.toMatchObject({ name: "AbortError" });
    await store.refresh();
    const controller = new AbortController();
    controller.abort();
    await expect(guardIdentityRequest(controller.signal, action, binding())).rejects.toMatchObject({ name: "AbortError" });
    expect(action).not.toHaveBeenCalled();
  });

  it("does not call a network failure a signed-out session", async () => {
    const { store, binding } = setup();
    await store.refresh();
    await expect(guardIdentityRequest(new AbortController().signal, () => Promise.reject(new Error("offline")), binding())).rejects.toThrow("offline");
    expect(store.getSnapshot().viewer?.user.id).toBe(idA);
    expect(store.getSnapshot().authEpoch).toBe(0);
  });
});
