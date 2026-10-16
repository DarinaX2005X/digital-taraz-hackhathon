import { notFound } from 'next/navigation';
import { isLocale } from '@/i18n/locales';
import { DemoPage } from '@/features/demo/ui/demo-page';
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const artifact = typeof query.artifact === 'string' ? query.artifact : undefined;
  return <DemoPage locale={locale} initialArtifactId={artifact} />;
}
