import { isLocale, type Locale } from "./locales";

export const localeCookieName = "tirlik-locale";
export const localeCookieMaxAge = 60 * 60 * 24 * 365;

export function localeCookieOptions(secure: boolean) {
  return { path: "/", maxAge: localeCookieMaxAge, sameSite: "lax" as const, secure, httpOnly: false };
}

export function readLocaleCookie(cookieHeader: string): Locale | undefined {
  for (const part of cookieHeader.split(";")) {
    const [name, ...parts] = part.trim().split("=");
    if (name !== localeCookieName) continue;
    const value = parts.join("=");
    return isLocale(value) ? value : undefined;
  }
  return undefined;
}

export function serializeLocaleCookie(locale: Locale, secure: boolean): string {
  if (!isLocale(locale)) throw new TypeError("Unsupported locale");
  return `${localeCookieName}=${locale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
