import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/i18n/provider";
import { readRequestLocale } from "@/i18n/server";
import { tirlikFont } from "@/ui/font";
import { ToastProvider } from "@/ui/toast";
import "@/ui/foundation.css";

export const metadata: Metadata = {
  title: "Tirlik",
  description: "Всё для вашего бизнеса",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/favicon.svg" },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await readRequestLocale();
  return (
    <html lang={locale} className={tirlikFont.variable}>
      <body><LocaleProvider initialLocale={locale}><ToastProvider>{children}</ToastProvider></LocaleProvider></body>
    </html>
  );
}
