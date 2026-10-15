"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useIdentityAccount } from "@/features/identity/ui";
import type { ArtifactSnapshot } from "../contracts";
import { createArtifactIdentityGate } from "../client/identity-gate";
import { createArtifactSession } from "../client/session";

/** Mount once per artifact/actor, never by locale, revision, cursor or dialog state. */
export function useArtifactSession(initial: ArtifactSnapshot) {
  const account = useIdentityAccount();
  const [controller] = useState(() => {
    const gate = createArtifactIdentityGate(initial.viewer.userId, account);
    const session = createArtifactSession({ initial, isIdentityCurrent: gate.isCurrent, onAuthenticationRequired: gate.invalidate });
    let initialized = false;
    let mountGeneration = 0;
    return {
      gate, session,
      initialize() { if (initialized) return Promise.resolve(); initialized = true; return session.initialize(); },
      async resume() { if (!gate.resume()) return false; initialized = true; await session.resume(); return gate.isCurrent() && session.getSnapshot().phase === "ready"; },
      mount() {
        const mine = ++mountGeneration;
        return () => { queueMicrotask(() => { if (mine === mountGeneration) session.dispose(); }); };
      },
    };
  });
  const state = useSyncExternalStore(controller.session.subscribe, controller.session.getSnapshot, controller.session.getSnapshot);
  const identity = useSyncExternalStore(controller.gate.subscribe, controller.gate.getSnapshot, controller.gate.getSnapshot);
  const userId = account.viewer?.user.id;
  useEffect(() => controller.mount(), [controller]);
  useEffect(() => {
    const next = controller.gate.reconcile();
    if (next.phase === "active") void controller.initialize().catch(() => undefined);
    else if (next.phase === "authentication-required") controller.session.suspend();
    else if (next.phase === "account-changed") void controller.session.switchAccount();
  }, [account.ready, account.authEpoch, userId, controller]);
  const privateVisible = identity.phase === "active" && identity.authEpoch !== undefined && account.isCurrent(initial.viewer.userId, identity.authEpoch) && state.phase === "ready";
  return { state, identity, privateVisible, session: controller.session, resume: controller.resume, refreshAccount: account.refresh };
}
