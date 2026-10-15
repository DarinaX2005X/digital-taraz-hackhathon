import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isLocale, locales } from "@/i18n";
import { publicCopy } from "@/features/public-site/copy";

// Only the supported locale params are routable. Unknown top-level segments
// must fall through to the root not-found boundary rather than being treated as
// an invalid locale page that can stream Next's fallback error shell.
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const copy = publicCopy[locale];
  return {
    title: `${copy.heroTitle} | Tirlik`,
    description: copy.description,
    alternates: { languages: Object.fromEntries(locales.map((item) => [item, `/${item}`])) },
  };
}

export default function PublicLocaleLayout({ children }: { children: ReactNode }) {
  return children;
}
