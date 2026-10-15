/* eslint-disable @next/next/no-html-link-for-pages -- global-not-found bypasses the app router/layout. */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from '@/i18n/catalog';
import { resolveLocale } from '@/i18n/locales';

export const metadata: Metadata = {
  title: 'Tirlik — 404',
  robots: { index: false, follow: false },
};

/**
 * The top-level `[locale]` layout makes an unmatched root URL impossible to
 * compose from a route-level not-found boundary. Next therefore renders this
 * full document directly at the routing layer. Keep it server-only and small:
 * no client provider or application layout is available here.
 */
export default async function GlobalNotFound() {
  const requestHeaders = await headers();
  const locale = resolveLocale({ acceptLanguage: requestHeaders.get('accept-language') });
  const t = getTranslations(locale);

  return <html lang={locale}>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>
    <body>
      <main data-route-state="not-found">
        <h1>{t('common.pages.notFoundTitle')}</h1>
        <p aria-label="404">404</p>
        <p>{t('common.pages.notFoundDescription')}</p>
        <a href="/">{t('common.navigation.home')}</a>
      </main>
    </body>
  </html>;
}
