import { notFound } from "next/navigation";
import { isLocale } from "@/i18n";
import { PublicSite } from "@/features/public-site/public-site";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <PublicSite routeLocale={locale} view="privacy" />;
}
