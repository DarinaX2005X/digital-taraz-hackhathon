"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useIdentityAccount } from "@/features/identity/ui";
import type { ArtifactSnapshot } from "../contracts";
import { createArtifactIdentityGate } from "../client/identity-gate";
import { createArtifactSession } from "../client/session";
import type { ArtifactClient } from "../client/transport";
import type { ArtifactCacheOptions } from "../client/indexed-db";

export type ArtifactSessionBinding = {
  client?: ArtifactClient;
  identity?: "account" | "scoped";
  cache?: ArtifactCacheOptions;
};

const scopedIdentity = { phase: "active" as const, authEpoch: 0 };
const subscribeScopedIdentity = () => () => undefined;

/** Mount once per artifact/actor, never by locale, revision, cursor or dialog state. */
export function useArtifactSession(initial: ArtifactSnapshot, binding: ArtifactSessionBinding = {}) {
  const account = useIdentityAccount();
  const [controller] = useState(() => {
    const scoped = binding.identity === "scoped";
    const gate = scoped ? undefined : createArtifactIdentityGate(initial.viewer.userId, account);
    const session = createArtifactSession({
      initial,
      client: binding.client,
      cache: binding.cache,
      isIdentityCurrent: scoped ? () => true : gate!.isCurrent,
      onAuthenticationRequired: scoped ? undefined : gate!.invalidate,
    });
    let initialized = false;
    let mountGeneration = 0;
    return {
      scoped, gate, session,
      initialize() { if (initialized) return Promise.resolve(); initialized = true; return session.initialize(); },
      async resume() {
        if (!scoped && !gate!.resume()) return false;
        initialized = true; await session.resume();
        return (scoped || gate!.isCurrent()) && session.getSnapshot().phase === "ready";
      },
      mount() {
        const mine = ++mountGeneration;
        return () => { queueMicrotask(() => { if (mine === mountGeneration) session.dispose(); }); };
      },
    };
  });
  const state = useSyncExternalStore(controller.session.subscribe, controller.session.getSnapshot, controller.session.getSnapshot);
  const identity = useSyncExternalStore(controller.gate?.subscribe ?? subscribeScopedIdentity, controller.gate?.getSnapshot ?? (() => scopedIdentity), controller.gate?.getSnapshot ?? (() => scopedIdentity));
  const userId = account.viewer?.user.id;
  useEffect(() => controller.mount(), [controller]);
  useEffect(() => {
    if (controller.scoped) { void controller.initialize().catch(() => undefined); return; }
    const next = controller.gate!.reconcile();
    if (next.phase === "active") void controller.initialize().catch(() => undefined);
    else if (next.phase === "authentication-required") controller.session.suspend();
    else if (next.phase === "account-changed") void controller.session.switchAccount();
  }, [account.ready, account.authEpoch, userId, controller]);
  const privateVisible = identity.phase === "active" && state.phase === "ready" && (controller.scoped || (identity.authEpoch !== undefined && account.isCurrent(initial.viewer.userId, identity.authEpoch)));
  return { state, identity, privateVisible, session: controller.session, resume: controller.resume, refreshAccount: account.refresh };
}
