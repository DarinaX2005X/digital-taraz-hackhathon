import { isLocale, normalizeLocale, type Locale } from "./locales";

/** Keep this callback stable (useCallback); replace it only when the account identity changes. */
export type LocalePreferenceWriter = (locale: Locale) => Promise<void>;
export type LocaleSnapshot = Readonly<{
  locale: Locale;
  cookie: "unchanged" | "saved" | "session-only";
  account: "unused" | "pending" | "saved" | "failed";
}>;

export function createLocaleStore(initialLocale: Locale, writeCookie: (locale: Locale) => boolean) {
  let snapshot: LocaleSnapshot = { locale: normalizeLocale(initialLocale), cookie: "unchanged", account: "unused" };
  const initialSnapshot = snapshot;
  const listeners = new Set<() => void>();
  let writer: LocalePreferenceWriter | undefined;
  let queuedLocale: Locale | undefined;
  let running = false;
  const publish = (next: LocaleSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  // Serialize account writes so a slow previous choice cannot overwrite the latest one.
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (queuedLocale && writer) {
        const locale = queuedLocale;
        const activeWriter = writer;
        queuedLocale = undefined;
        try {
          await activeWriter(locale);
          if (snapshot.locale === locale && !queuedLocale && writer === activeWriter) {
            publish({ ...snapshot, account: "saved" });
          }
        } catch {
          if (snapshot.locale === locale && !queuedLocale && writer === activeWriter) {
            publish({ ...snapshot, account: "failed" });
          }
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPreferenceWriter: (next: LocalePreferenceWriter | undefined) => {
      if (writer === next) return;
      writer = next;
      queuedLocale = undefined;
      publish({ ...snapshot, account: "unused" });
    },
    setLocale: (locale: Locale) => {
      if (!isLocale(locale)) throw new TypeError("Unsupported locale");
      let cookie: LocaleSnapshot["cookie"] = "session-only";
      try { if (writeCookie(locale)) cookie = "saved"; } catch { /* Selection still applies when storage is blocked. */ }
      publish({ locale, cookie, account: writer ? "pending" : "unused" });
      if (writer) {
        queuedLocale = locale;
        void drain();
      }
    },
  };
}
