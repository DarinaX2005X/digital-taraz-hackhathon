import { describe, expect, it } from "vitest";
import { LocaleSchema } from "../../src/contracts/primitives";
import { ErrorCodeSchema } from "../../src/contracts/errors";
import { getErrorMessage, getTranslations, lookupMessage, messageKeys, messages } from "../../src/i18n/catalog";
import { localeCookieMaxAge, localeCookieName, localeCookieOptions, readLocaleCookie, serializeLocaleCookie } from "../../src/i18n/cookie";
import { formatCalendarDate, formatDecimal, formatInstant, formatList, formatMoney, formatNumber, formatUnit, pluralCategory } from "../../src/i18n/format";
import { locales, preferredLanguage, resolveLocale } from "../../src/i18n/locales";
import { createLocaleStore } from "../../src/i18n/locale-store";

describe("locale catalogs and fallback", () => {
  it("matches the shared schema and has complete nonempty dictionaries", () => {
    expect(locales).toEqual(LocaleSchema.options);
    for (const locale of locales) {
      expect(messageKeys(messages[locale])).toEqual(messageKeys(messages.ru));
      for (const key of messageKeys(messages[locale])) expect(lookupMessage(messages[locale], key)?.trim().length).toBeGreaterThan(0);
    }
    expect(getTranslations("ru")("common.brand.tagline")).toBe("Всё для вашего бизнеса");
  });

  it("rejects missing translation keys instead of mixing languages", () => {
    // @ts-expect-error The runtime defense also protects untyped callers.
    expect(() => getTranslations("kk")("common.missing")).toThrow("Missing translation");
    expect(lookupMessage(messages.en, "__proto__.toString")).toBeUndefined();
  });

  it("resolves every shared error code without displaying unknown server text", () => {
    for (const locale of locales) {
      for (const code of ErrorCodeSchema.options) expect(getErrorMessage(locale, { code })).toBeTruthy();
      expect(getErrorMessage(locale, { code: "UNKNOWN", messageKey: "Secret backend failure" })).toBe(getTranslations(locale)("common.errors.unexpected"));
      expect(getErrorMessage(locale, { code: "CONFLICT", messageKey: "common.brand.name" })).toBe(getTranslations(locale)("common.errors.conflict"));
    }
  });

  it("uses explicit route, saved choice, account, accepted language, then Russian", () => {
    expect(resolveLocale({ routeLocale: "en", cookieLocale: "kk", accountLocale: "ru" })).toBe("en");
    expect(resolveLocale({ cookieLocale: "kk", accountLocale: "en" })).toBe("kk");
    expect(resolveLocale({ cookieLocale: "ar", accountLocale: "en" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "fr;q=1,en-GB;q=0.5,kk-KZ;q=0.9" })).toBe("kk");
    expect(resolveLocale({ cookieLocale: "ru<script>", acceptLanguage: "*" })).toBe("ru");
    expect(preferredLanguage("ru;q=0, en;q=NaN, kk;q=2")).toBeUndefined();
    expect(preferredLanguage("ru;q=0.7,kk;q=0.7")).toBe("ru");
  });

  it("persists only valid locale cookies with matching server/client attributes", () => {
    for (const locale of locales) {
      const cookie = serializeLocaleCookie(locale, true);
      expect(readLocaleCookie(`session=private; ${cookie}`)).toBe(locale);
      expect(cookie).toBe(`${localeCookieName}=${locale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax; Secure`);
    }
    expect(localeCookieOptions(false)).toMatchObject({ path: "/", maxAge: localeCookieMaxAge, secure: false, sameSite: "lax", httpOnly: false });
    expect(readLocaleCookie("not-tirlik-locale=en; tirlik-locale=wrong")).toBeUndefined();
    // @ts-expect-error Reject hostile untyped input before serializing it.
    expect(() => serializeLocaleCookie("en; injected=1", true)).toThrow("Unsupported locale");
  });
});

describe("exact and local formatting", () => {
  it("formats large money without floating-point loss and uses currency precision", () => {
    expect(formatMoney("en", { currency: "KZT", minorUnits: "900719925474099391" })).toContain("9,007,199,254,740,993.91");
    expect(formatMoney("en", { currency: "JPY", minorUnits: "125" })).toContain("125");
    expect(formatMoney("en", { currency: "KWD", minorUnits: "1001" })).toContain("1.001");
    expect(formatMoney("en", { currency: "KZT", minorUnits: "-1" })).toContain("-KZT");
    expect(formatMoney("en", { currency: "KZT", minorUnits: "-1" })).toContain("0.01");
  });

  it("preserves decimal precision, signs and trailing source zeroes", () => {
    expect(formatDecimal("en", "9007199254740993.0001")).toBe("9,007,199,254,740,993.0001");
    expect(formatDecimal("ru", "-0.050")).toBe("-0,050");
    expect(formatDecimal("kk", "10.25")).toBe("10,25");
    expect(() => formatDecimal("en", "2e6")).toThrow();
    expect(() => formatNumber("en", Number.NaN)).toThrow();
  });

  it("keeps fractional money signs in explicit sign modes", () => {
    const positive = { currency: "KZT", minorUnits: "1" };
    const negative = { currency: "KZT", minorUnits: "-1" };
    expect(formatMoney("en", positive, { signDisplay: "exceptZero" })).toContain("+KZT");
    expect(formatMoney("en", negative, { signDisplay: "exceptZero" })).toContain("-KZT");
    expect(formatMoney("en", { currency: "KZT", minorUnits: "0" }, { signDisplay: "exceptZero" })).not.toMatch(/[+-]/);
  });

  it("uses the business timezone for instants without shifting calendar dates", () => {
    expect(formatInstant("en", "2026-10-12T22:00:00Z", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })).toBe("13/10/2026, 03:00");
    expect(formatCalendarDate("en", "2026-10-12")).toBe("12 Oct 2026");
    expect(() => formatCalendarDate("en", "2026-02-30")).toThrow();
    expect(() => formatInstant("en", "wrong")).toThrow();
  });

  it("uses Intl for units, lists and plurals in every supported locale", () => {
    for (const locale of locales) {
      expect(formatUnit(locale, 25, "kilogram")).toContain("25");
      expect(formatList(locale, ["A", "B"])).toContain("A");
    }
    expect(pluralCategory("ru", 2)).toBe("few");
    expect(pluralCategory("ru", 5)).toBe("many");
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("kk", 2)).toBe("other");
  });
});

describe("locale store", () => {
  it("changes only locale state and keeps a stable store and server snapshot", () => {
    const store = createLocaleStore("ru", () => true);
    const serverSnapshot = store.getServerSnapshot();
    const subscribe = store.subscribe;
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });
    for (const locale of locales) store.setLocale(locale);
    expect(store.getSnapshot()).toEqual({ locale: "en", cookie: "saved", account: "unused" });
    expect(store.getServerSnapshot()).toBe(serverSnapshot);
    expect(store.subscribe).toBe(subscribe);
    expect(notifications).toBe(3);
    unsubscribe();
    store.setLocale("kk");
    expect(notifications).toBe(3);
  });

  it("keeps the selected language when cookie storage is unavailable", () => {
    const store = createLocaleStore("ru", () => { throw new Error("blocked"); });
    store.setLocale("kk");
    expect(store.getSnapshot()).toMatchObject({ locale: "kk", cookie: "session-only" });
  });

  it("serializes and coalesces account writes while switching immediately", async () => {
    const calls: string[] = [];
    const completions: Array<() => void> = [];
    const store = createLocaleStore("ru", () => true);
    store.setPreferenceWriter((locale) => new Promise<void>((resolve) => { calls.push(locale); completions.push(resolve); }));
    store.setLocale("kk");
    store.setLocale("en");
    store.setLocale("ru");
    expect(store.getSnapshot()).toMatchObject({ locale: "ru", account: "pending" });
    expect(calls).toEqual(["kk"]);
    completions.shift()!();
    await Promise.resolve();
    expect(calls).toEqual(["kk", "ru"]);
    completions.shift()!();
    await Promise.resolve();
    expect(store.getSnapshot().account).toBe("saved");
  });

  it("reports failed account persistence without reverting the local choice", async () => {
    const store = createLocaleStore("ru", () => true);
    store.setPreferenceWriter(async () => { throw new Error("offline"); });
    store.setLocale("en");
    await Promise.resolve();
    expect(store.getSnapshot()).toMatchObject({ locale: "en", cookie: "saved", account: "failed" });
    store.setPreferenceWriter(undefined);
    expect(store.getSnapshot().account).toBe("unused");
  });
});
