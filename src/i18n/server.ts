import "server-only";
import { cookies, headers } from "next/headers";
import { localeCookieName, localeCookieOptions } from "./cookie";
import { isLocale, resolveLocale, type Locale } from "./locales";

export async function readRequestLocale(options: { accountLocale?: unknown; routeLocale?: unknown } = {}): Promise<Locale> {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  return resolveLocale({ ...options, cookieLocale: cookieStore.get(localeCookieName)?.value, acceptLanguage: requestHeaders.get("accept-language") });
}

// Call only from a Server Action or Route Handler, never while rendering a layout.
export async function writeRequestLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) throw new TypeError("Unsupported locale");
  (await cookies()).set(localeCookieName, locale, localeCookieOptions(process.env.NODE_ENV === "production"));
}
