import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let pool: Pool;
let origin: string;
const invitePath = `/settings/invitations/${'a'.repeat(64)}`;
const publicPaths = ['/', '/sign-in', '/sign-up', '/auth/verify', '/auth/reset', '/settings', '/settings/team', invitePath];

function request(path: string, language?: string) {
  return fetch(`${origin}${path}`, {
    headers: language ? { 'Accept-Language': language } : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
  });
}

beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const database = new URL(process.env.DATABASE_URL ?? '');
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
  if (database.hostname !== '127.0.0.1' || new URL(origin).hostname !== '127.0.0.1') throw new Error('ISOLATED_LOCAL_SERVICES_REQUIRED');
  pool = new Pool({ connectionString: database.href });
});

afterAll(async () => { await pool?.end(); });

describe('mounted identity routes over HTTP', () => {
  it.each(publicPaths)('serves %s without creating personal records', async (path) => {
    const before = (await pool.query('SELECT count(*)::int AS count FROM identity_users')).rows[0].count;
    const response = await request(path, 'kk');
    expect(response.status, path).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html, path).toContain('lang="kk"');
    if (path.startsWith('/auth/') || path === invitePath) expect(html).toContain('name="referrer" content="no-referrer"');
    expect((await pool.query('SELECT count(*)::int AS count FROM identity_users')).rows[0].count).toBe(before);
  });

  it('keeps the public entry accessible and links only available account paths', async () => {
    const response = await request('');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('href="/sign-up"');
  });

  it.each(['', '&workspace=152973d6-2600-4aef-99e1-6c0a9a57c659'])('preserves opaque intent at the work entry%s without private input', async (suffix) => {
    const intent = 'd'.repeat(64);
    const response = await request(`/app?intent=${intent}${suffix}&goal=private`);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`/app/work?intent=${intent}${suffix}`);
    await response.body?.cancel();
  });

  it.each([['/missing-synthetic-page', 404], ['/settings/team?workspace=invalid', 200], ['/settings/team?workspace=a&workspace=b', 200]] as const)('returns a localized recovery state for %s', async (path, status) => {
      const response = await request(path, 'en');
      expect(response.status, path).toBe(status);
      const html = await response.text();
      expect(html, path).toContain(status === 404 ? 'Page not found' : 'Workspace could not be opened');
      expect(html, path).toContain(status === 404 ? 'href="/"' : 'href="/settings/team"');
      expect(html, path).toContain('lang="en"');
      expect(html, path).not.toContain('id="__next_error__"');
  });
});
