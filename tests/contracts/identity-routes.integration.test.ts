import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let pool: Pool;
let origin: string;

beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const database = new URL(process.env.DATABASE_URL ?? '');
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
  if (database.hostname !== '127.0.0.1' || new URL(origin).hostname !== '127.0.0.1') throw new Error('ISOLATED_LOCAL_SERVICES_REQUIRED');
  pool = new Pool({ connectionString: database.href });
});

afterAll(async () => { await pool?.end(); });

describe('mounted identity routes over HTTP', () => {
  it('serves public account pages without creating personal records', async () => {
    const before = (await pool.query('SELECT count(*)::int AS count FROM identity_users')).rows[0].count;
    const invitePath = `/settings/invitations/${'a'.repeat(64)}`;
    for (const path of ['/', '/sign-in', '/sign-up', '/auth/verify', '/auth/reset', '/settings', '/settings/team', invitePath]) {
      const response = await fetch(`${origin}${path}`, { headers: { 'Accept-Language': 'kk' }, redirect: 'manual' });
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      expect(html, path).toContain('lang="kk"');
      if (path.startsWith('/auth/') || path === invitePath) expect(html).toContain('name="referrer" content="no-referrer"');
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM identity_users')).rows[0].count).toBe(before);
  }, 90_000);

  it('keeps the public entry accessible and links only available account paths', async () => {
    const response = await fetch(origin, { redirect: 'manual' });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('href="/sign-up"');
  });

  it('preserves an opaque pending intent at the interim account entry', async () => {
    const intent = 'd'.repeat(64);
    const response = await fetch(`${origin}/app?intent=${intent}&goal=private`, { redirect: 'manual' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`/settings?intent=${intent}`);
  });

  it('returns a localized navigable 404 for an unknown route and a recovery state for invalid filters', async () => {
    for (const [path, status] of [['/missing-synthetic-page', 404], ['/settings/team?workspace=invalid', 200], ['/settings/team?workspace=a&workspace=b', 200]] as const) {
      const response = await fetch(`${origin}${path}`, { headers: { 'Accept-Language': 'en' }, redirect: 'manual' });
      expect(response.status, path).toBe(status);
      const html = await response.text();
      expect(html, path).toContain(status === 404 ? 'Page not found' : 'Workspace could not be opened');
      expect(html, path).toContain(status === 404 ? 'href="/"' : 'href="/settings/team"');
      expect(html, path).toContain('lang="en"');
      expect(html, path).not.toContain('id="__next_error__"');
    }
  });
});
