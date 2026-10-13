"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getTranslations } from "./catalog";
import { readLocaleCookie, serializeLocaleCookie } from "./cookie";
import { createLocaleStore, type LocalePreferenceWriter, type LocaleSnapshot } from "./locale-store";
import type { Locale } from "./locales";

type LocaleContextValue = LocaleSnapshot & { setLocale: (locale: Locale) => void };
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, persistPreference, children }: {
  initialLocale: Locale;
  persistPreference?: LocalePreferenceWriter;
  children: ReactNode;
}) {
  const [store] = useState(() => createLocaleStore(initialLocale, (locale) => {
    document.cookie = serializeLocaleCookie(locale, window.location.protocol === "https:");
    return readLocaleCookie(document.cookie) === locale;
  }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useEffect(() => { store.setPreferenceWriter(persistPreference); }, [store, persistPreference]);
  useEffect(() => { document.documentElement.lang = state.locale; }, [state.locale]);
  const value = useMemo(() => ({ ...state, setLocale: store.setLocale }), [state, store]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale requires LocaleProvider");
  return value;
}

export function useTranslations() {
  const { locale } = useLocale();
  return useMemo(() => getTranslations(locale), [locale]);
}
