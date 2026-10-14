"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { LocaleProvider } from "@/i18n/provider";
import type { Locale } from "@/i18n";
import { createIdentityAccountStore } from "./account-store";

type AccountStore = ReturnType<typeof createIdentityAccountStore>;
const IdentityAccountContext = createContext<AccountStore | null>(null);

export function IdentityLocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [store] = useState(createIdentityAccountStore);
  const { viewer } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const userId = viewer?.user.id;
  const persistPreference = useMemo(() => userId ? (locale: Locale) => store.persistLocale(userId, locale) : undefined, [store, userId]);
  useEffect(() => {
    void store.refresh().catch(() => undefined);
    const refreshVisible = () => { if (document.visibilityState === "visible") void store.refresh().catch(() => undefined); };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { document.removeEventListener("visibilitychange", refreshVisible); store.clear(); };
  }, [store]);
  return <IdentityAccountContext.Provider value={store}><LocaleProvider initialLocale={initialLocale} persistPreference={persistPreference}>{children}</LocaleProvider></IdentityAccountContext.Provider>;
}

export function useIdentityAccount() {
  const store = useContext(IdentityAccountContext);
  if (!store) throw new Error("Identity UI requires IdentityLocaleProvider");
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, refresh: store.refresh, clear: store.clear, acceptUser: store.acceptUser, isCurrent: store.isCurrent, invalidate: store.invalidate };
}
