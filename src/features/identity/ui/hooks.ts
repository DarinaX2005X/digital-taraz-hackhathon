"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale } from "@/i18n/provider";
import { identityTranslator } from "../locales";
import { createIdentityOperation } from "./operation";
import { useIdentityAccount } from "./identity-locale-provider";
import { guardIdentityRequest, reconcilePrivateAccess, resumePrivateAccess, type PrivateAccess } from "./private-access";

export function useIdentityTranslations() {
  const { locale } = useLocale();
  return useMemo(() => identityTranslator(locale), [locale]);
}

export function useIdentityOperation<T>() {
  const [operation] = useState(() => createIdentityOperation<T>());
  const snapshot = useSyncExternalStore(operation.subscribe, operation.getSnapshot, operation.getSnapshot);
  useEffect(() => () => operation.cancel(), [operation]);
  return { ...snapshot, run: operation.run, cancel: operation.cancel, clear: operation.clear };
}

export function useIdentityGuard() {
  const { viewer, authEpoch, invalidate, isCurrent, refresh } = useIdentityAccount();
  const userId = viewer?.user.id;
  return useCallback(<T,>(signal: AbortSignal, action: () => Promise<T>) => guardIdentityRequest(signal, action, {
    isCurrent: () => Boolean(userId && isCurrent(userId, authEpoch)),
    clear: () => { if (userId) invalidate(userId, authEpoch); },
    refresh,
  }), [userId, authEpoch, invalidate, isCurrent, refresh]);
}

export function usePrivateIdentityAccess(ownerId: string) {
  const account = useIdentityAccount();
  const [state, setState] = useState<PrivateAccess>({ ownerId, authEpoch: account.authEpoch, phase: "checking" });
  const current = reconcilePrivateAccess(state, account);
  if (current !== state) setState(current);
  return { phase: current.phase, resume: () => setState((previous) => resumePrivateAccess(previous, account)) };
}
