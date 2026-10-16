import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');
const exists = (path: string) => existsSync(fileURLToPath(new URL(path, root)));

describe('public-site route and semantic inventory', () => {
  it('keeps every visible internal destination backed by a route', () => {
    for (const path of [
      'src/app/page.tsx',
      'src/app/[locale]/page.tsx',
      'src/app/[locale]/help/page.tsx',
      'src/app/[locale]/privacy/page.tsx',
      'src/app/demo/page.tsx',
      'src/app/[locale]/demo/page.tsx',
      'src/app/[locale]/not-found.tsx',
      'src/app/app/work/page.tsx',
      'src/app/app/profile/page.tsx',
      'src/app/sign-in/page.tsx',
      'src/app/sign-up/page.tsx',
      'src/app/settings/page.tsx',
      'src/app/settings/team/page.tsx',
    ]) expect(exists(path), path).toBe(true);
  });

  it('backs each in-page navigation target with semantic content', () => {
    const page = source('src/features/public-site/public-site.tsx');
    const proof = source('src/features/public-site/decision-proof.tsx');
    const start = source('src/features/public-site/start-work.tsx');
    expect(page).toContain('href={`/${locale}#scenarios`}');
    expect(page).toContain('id="scenarios"');
    expect(page).toContain('href={`/${locale}#process`}');
    expect(proof).toContain('id="process"');
    expect(page).toContain('href="#start"');
    expect(start).toContain('id="start"');
    expect(page).toContain('<main id="public-main">');
    expect(page).toContain('<h1 id="tirlik-title">');
    expect(page).toContain('signedIn ? "/app/work" : "/sign-in"');
    expect(page).not.toContain('signedIn ? "/settings"');
    expect(page).toContain('<Link href="/app/work">{copy.work}</Link><Link href="/settings">{copy.account}</Link>');
  });

  it('publishes localized metadata from the same truthful public copy', async () => {
    const rootPage = source('src/app/page.tsx');
    const localeLayout = source('src/app/[locale]/layout.tsx');
    expect(rootPage).toContain('publicCopy.ru.heroTitle');
    expect(rootPage).toContain('publicCopy.ru.description');
    expect(localeLayout).toContain('export async function generateMetadata');
    expect(localeLayout).toContain('publicCopy[locale]');
    expect(localeLayout).toContain('alternates:');
    const { generateMetadata, generateStaticParams } = await import('../../src/app/[locale]/layout');
    expect(generateStaticParams()).toEqual([{ locale: 'ru' }, { locale: 'kk' }, { locale: 'en' }]);
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'ru' }) });
    expect(String(metadata.title)).toContain('Tirlik');
    expect(metadata.description).toContain('Предложения клиентам');
  });

  it('contains explicit narrow-layout and reduced-motion fallbacks', () => {
    const css = source('src/features/public-site/public-site.module.css');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
