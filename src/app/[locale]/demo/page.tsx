import { notFound } from 'next/navigation';
import { isLocale } from '@/i18n/locales';
import { DemoPage } from '@/features/demo/ui/demo-page';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <DemoPage locale={locale} />;
}
