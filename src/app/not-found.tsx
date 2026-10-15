import Link from 'next/link';
import { readRequestLocale } from '@/i18n/server';
import { getTranslations } from '@/i18n/catalog';

/**
 * Keep the global 404 boundary server-rendered.  A missing top-level URL can
 * be handled before any client component tree is mounted, so rendering the
 * recovery copy here avoids falling back to Next's error shell.  The locale
 * still follows the normal cookie/account/Accept-Language negotiation used by
 * the root layout.
 */
export default async function NotFound() {
  const locale = await readRequestLocale();
  const t = getTranslations(locale);
  return <main data-route-state="not-found">
    <h1>{t('common.pages.notFoundTitle')}</h1>
    <p aria-label="404">404</p>
    <p>{t('common.pages.notFoundDescription')}</p>
    <Link href="/">{t('common.navigation.home')}</Link>
  </main>;
}
