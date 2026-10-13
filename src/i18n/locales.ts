import type { Locale } from "@/contracts/primitives";

export type { Locale } from "@/contracts/primitives";
export const locales = ["ru", "kk", "en"] as const satisfies readonly Locale[];
export const defaultLocale: Locale = "ru";
export const localeNames: Record<Locale, string> = { ru: "Русский", kk: "Қазақша", en: "English" };
export const intlLocales: Record<Locale, string> = { ru: "ru-KZ", kk: "kk-KZ", en: "en-GB" };
export const businessTimeZone = "Asia/Qyzylorda";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function preferredLanguage(header: string | null | undefined): Locale | undefined {
  return (header ?? "").split(",").map((entry, index) => {
    const [tag, ...parameters] = entry.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return { locale: tag?.toLowerCase().split("-")[0], q, index };
  }).filter(({ locale, q }) => isLocale(locale) && Number.isFinite(q) && q > 0 && q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.locale as Locale | undefined;
}

export function resolveLocale(input: {
  routeLocale?: unknown;
  cookieLocale?: unknown;
  accountLocale?: unknown;
  acceptLanguage?: string | null;
} = {}): Locale {
  for (const candidate of [input.routeLocale, input.cookieLocale, input.accountLocale]) {
    if (isLocale(candidate)) return candidate;
  }
  return preferredLanguage(input.acceptLanguage) ?? defaultLocale;
}
