import { describe, expect, it } from "vitest";
import { createArtifactIdentityGate, type ArtifactIdentitySnapshot } from "@/features/artifacts/client/identity-gate";
import { ids } from "./fixtures";

function setup() {
  let snapshot: ArtifactIdentitySnapshot = { ready: false, authEpoch: 0, viewer: null };
  const gate = createArtifactIdentityGate(ids.user, {
    getSnapshot: () => snapshot,
    isCurrent: (userId, epoch) => snapshot.viewer?.user.id === userId && snapshot.authEpoch === epoch,
    invalidate: (userId, epoch) => { if (snapshot.viewer?.user.id === userId && snapshot.authEpoch === epoch) snapshot = { ready: true, viewer: null, authEpoch: epoch + 1 }; },
  });
  return { gate, set: (next: ArtifactIdentitySnapshot) => { snapshot = next; }, get: () => snapshot };
}
describe("artifact identity gate", () => {
  it("waits for the authoritative account read before opening the initial server actor", () => {
    const { gate, set } = setup();
    expect(gate.isCurrent()).toBe(false);
    set({ ready: true, viewer: { user: { id: ids.user } }, authEpoch: 0 });
    expect(gate.reconcile()).toEqual({ phase: "active", authEpoch: 0 });
    expect(gate.isCurrent()).toBe(true);
  });
  it("closes immediately across a batched same-user reauthentication and requires explicit resume", () => {
    const { gate, set } = setup();
    set({ ready: true, viewer: { user: { id: ids.user } }, authEpoch: 0 }); gate.reconcile();
    set({ ready: true, viewer: { user: { id: ids.user } }, authEpoch: 2 });
    expect(gate.isCurrent()).toBe(false);
    expect(gate.reconcile().phase).toBe("authentication-required");
    expect(gate.resume()).toBe(true);
    expect(gate.getSnapshot().authEpoch).toBe(2);
    expect(gate.isCurrent()).toBe(true);
  });
  it("never allows another actor to resume or invalidates that actor using an old request", () => {
    const { gate, set, get } = setup();
    set({ ready: true, viewer: { user: { id: ids.user } }, authEpoch: 0 }); gate.reconcile();
    set({ ready: true, viewer: { user: { id: ids.otherUser } }, authEpoch: 1 });
    gate.invalidate();
    expect(get().viewer?.user.id).toBe(ids.otherUser);
    expect(gate.getSnapshot().phase).toBe("account-changed");
    expect(gate.resume()).toBe(false);
  });
  it("uses the live getter after authentication even before a consumer rerenders", () => {
    const { gate, set } = setup();
    set({ ready: true, viewer: null, authEpoch: 1 }); gate.reconcile();
    set({ ready: true, viewer: { user: { id: ids.user } }, authEpoch: 2 });
    expect(gate.resume()).toBe(true);
    expect(gate.getSnapshot()).toEqual({ phase: "active", authEpoch: 2 });
  });
});
