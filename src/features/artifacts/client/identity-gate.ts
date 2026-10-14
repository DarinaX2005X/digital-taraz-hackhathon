export type ArtifactIdentitySnapshot = { ready: boolean; authEpoch: number; viewer: { user: { id: string } } | null };
export type ArtifactIdentityGateState = Readonly<{ phase: "checking" | "active" | "authentication-required" | "account-changed"; authEpoch?: number }>;

/** The initial server actor stays fixed; a new session requires explicit continuation. */
export function createArtifactIdentityGate(userId: string, account: {
  getSnapshot: () => ArtifactIdentitySnapshot;
  isCurrent: (userId: string, epoch: number) => boolean;
  invalidate: (userId: string, epoch: number) => void;
}) {
  let state: ArtifactIdentityGateState = { phase: "checking" };
  const listeners = new Set<() => void>();
  function publish(next: ArtifactIdentityGateState) {
    if (next.phase === state.phase && next.authEpoch === state.authEpoch) return;
    state = next; for (const listener of listeners) listener();
  }
  function reconcile() {
    const current = account.getSnapshot();
    if (!current.ready) return state;
    if (current.viewer?.user.id !== userId) {
      publish({ ...state, phase: current.viewer ? "account-changed" : "authentication-required" });
    } else if (state.phase === "checking" && state.authEpoch === undefined) {
      publish({ phase: "active", authEpoch: current.authEpoch });
    } else if (state.phase !== "active" || state.authEpoch !== current.authEpoch) {
      publish({ ...state, phase: "authentication-required" });
    }
    return state;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reconcile,
    isCurrent: () => state.phase === "active" && state.authEpoch !== undefined && account.isCurrent(userId, state.authEpoch),
    resume() {
      const current = account.getSnapshot();
      if (!current.ready || current.viewer?.user.id !== userId || !account.isCurrent(userId, current.authEpoch)) { reconcile(); return false; }
      publish({ phase: "active", authEpoch: current.authEpoch }); return true;
    },
    invalidate() {
      if (state.authEpoch !== undefined) account.invalidate(userId, state.authEpoch);
      reconcile();
    },
  };
}
