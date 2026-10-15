import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveLocale, isLocale, type Locale } from '@/i18n/locales';

const publicRootRoutes = new Set([
  'app',
  'auth',
  'settings',
  'sign-in',
  'sign-up',
]);

const notFoundCopy: Record<Locale, { title: string; description: string; home: string }> = {
  ru: { title: 'Страница не найдена', description: 'Проверьте адрес или вернитесь на главную.', home: 'На главную' },
  kk: { title: 'Бет табылмады', description: 'Мекенжайды тексеріңіз немесе басты бетке оралыңыз.', home: 'Басты бетке' },
  en: { title: 'Page not found', description: 'Check the address or return to the home page.', home: 'Home' },
};

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * A one-segment unknown URL is otherwise claimed by the top-level `[locale]`
 * dynamic route. That route can throw `notFound()`, but Next renders its
 * Flight-only error shell for this root-dynamic case. Handle just this narrow
 * unmatched boundary before routing so the response is a real localized 404;
 * supported locales and all existing root routes continue through Next.
 */
export function proxy(request: NextRequest) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return NextResponse.next();

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return NextResponse.next();

  const firstSegment = segments[0]!;
  if (isLocale(firstSegment) || publicRootRoutes.has(firstSegment)) return NextResponse.next();

  const locale = resolveLocale({ acceptLanguage: request.headers.get('accept-language') });
  const copy = notFoundCopy[locale];
  const body = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(copy.title)} | Tirlik</title></head><body><main data-route-state="not-found"><h1>${escapeHtml(copy.title)}</h1><p aria-label="404">404</p><p>${escapeHtml(copy.description)}</p><a href="/">${escapeHtml(copy.home)}</a></main></body></html>`;
  return new NextResponse(request.method === 'HEAD' ? null : body, {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/|favicon.ico|brand/|\\.well-known/).*)'],
};
