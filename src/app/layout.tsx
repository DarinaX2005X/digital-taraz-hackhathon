import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IdentityLocaleProvider } from "@/features/identity/ui";
import { readRequestLocale } from "@/i18n/server";
import { readIdentityLocale } from "@/server/identity";
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
  const locale = await readRequestLocale({ accountLocale: await readIdentityLocale() });
  return (
    <html lang={locale} className={tirlikFont.variable}>
      <body><IdentityLocaleProvider initialLocale={locale}><ToastProvider>{children}</ToastProvider></IdentityLocaleProvider></body>
    </html>
  );
}
