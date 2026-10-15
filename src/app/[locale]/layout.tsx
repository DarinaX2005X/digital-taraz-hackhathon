import type { ReactNode } from "react";
import { locales } from "@/i18n";

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default function PublicLocaleLayout({ children }: { children: ReactNode }) {
  return children;
}
