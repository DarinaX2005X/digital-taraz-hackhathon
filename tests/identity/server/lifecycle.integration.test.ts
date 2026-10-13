import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema } from '../../../src/contracts/errors';
import { IdentityViewerSchema, IntentRestoredSchema, IntentSavedSchema, SessionsResultSchema } from '../../../src/features/identity/contracts';

let pool: Pool;
let origin: string;
let mailOrigin: string;
const password = 'Synthetic account password 42';

class HttpClient {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, headers: HeadersInit = {}) {
    const outgoing = new Headers(headers);
    if (method !== 'GET') {
      outgoing.set('origin', origin);
      outgoing.set('content-type', 'application/json');
    }
    if (this.cookies.size) outgoing.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers: outgoing, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const serialized of response.headers.getSetCookie()) {
      const first = serialized.split(';')[0]!;
      const split = first.indexOf('=');
      const name = first.slice(0, split);
      const value = first.slice(split + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}

async function mailLink(email: string, kind: 'verify' | 'reset'): Promise<URL> {
  const search = new URL('/api/v1/search', mailOrigin);
  search.searchParams.set('query', `to:${email}`);
  const list = await (await fetch(search)).json() as { messages: { ID: string }[] };
  for (const item of list.messages) {
    const mail = await (await fetch(`${mailOrigin}/api/v1/message/${item.ID}`)).json() as { Text: string; To: { Address: string }[] };
    expect(mail.To.some((to) => to.Address === email)).toBe(true);
    const candidate = mail.Text.match(new RegExp(`http://127\\.0\\.0\\.1:\\d+/auth/${kind}\\?[^\\s]+`))?.[0];
    if (candidate) return new URL(candidate);
  }
  throw new Error('OWNED_SYNTHETIC_MAIL_LINK_MISSING');
}

async function signup(client: HttpClient, email: string, locale = 'ru') {
  const response = await client.request('/api/auth/sign-up/email', 'POST', { name: 'Synthetic Owner', email, password, locale, returnTo: '/app/projects' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'verification-pending' });
}
async function verify(client: HttpClient, email: string) {
  const link = await mailLink(email, 'verify');
  const response = await client.request('/api/auth/verify-email', 'POST', { token: link.searchParams.get('token') });
  expect(response.status).toBe(200);
  return link;
}
async function login(client: HttpClient, email: string, currentPassword = password) {
  const response = await client.request('/api/auth/sign-in/email', 'POST', { email, password: currentPassword });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'signed-in', returnTo: '/app' });
  expect(response.headers.getSetCookie().some((value) => /HttpOnly/i.test(value) && /SameSite=Lax/i.test(value))).toBe(true);
}

beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/tirlik' || process.env.SMTP_HOST !== '127.0.0.1' || process.env.BREVO_SMTP_KEY || process.env.BREVO_API_KEY || process.env.SMTP_PASSWORD) throw new Error('ISOLATED_LOCAL_SERVICES_REQUIRED');
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
  mailOrigin = `http://127.0.0.1:${process.env.TIRLIK_MAIL_UI_PORT}`;
  pool = new Pool({ connectionString: database.href });
});
afterAll(async () => { await pool?.end(); });

describe('real HTTP, PostgreSQL and Mailpit account lifecycle', () => {
  it('verifies once, persists the same identity and revokes sessions authoritatively', async () => {
    const email = `lifecycle-${randomUUID()}@example.test`;
    const owner = new HttpClient();
    await signup(owner, email, 'kk');
    expect((await owner.request('/api/identity/me')).status).toBe(401);
    const unverified = await owner.request('/api/auth/sign-in/email', 'POST', { email, password });
    expect(unverified.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await unverified.json()).messageKey).toBe('identity.errors.emailNotVerified');
    const link = await mailLink(email, 'verify');
    expect(link.pathname).toBe('/auth/verify');
    expect(link.searchParams.get('returnTo')).toBe('/app/projects');
    expect((await owner.request(`/api/auth/verify-email?token=${link.searchParams.get('token')}`)).status).toBe(404);
    expect((await pool.query('SELECT email_verified FROM identity_users WHERE email=$1', [email])).rows[0].email_verified).toBe(false);
    const invalid = await owner.request('/api/auth/verify-email', 'POST', { token: 'invalid-token-value-long-enough' });
    expect(invalid.status).toBe(422);
    await verify(owner, email);
    expect((await owner.request('/api/auth/verify-email', 'POST', { token: link.searchParams.get('token') })).status).toBe(422);
    await login(owner, email);
    const first = IdentityViewerSchema.parse(await (await owner.request('/api/identity/me')).json());
    const second = IdentityViewerSchema.parse(await (await owner.request('/api/identity/me')).json());
    expect(first.user.id).toBe(second.user.id);
    expect(first.user.locale).toBe('kk');
    const profile = await owner.request('/api/identity/profile', 'PATCH', { name: 'Changed Owner', locale: 'en' });
    expect(profile.status).toBe(200);
    expect(profile.headers.getSetCookie().join(';')).toContain('tirlik-locale=en');
    expect(IdentityViewerSchema.parse(await (await owner.request('/api/identity/me')).json()).user.name).toBe('Changed Owner');
    const otherDevice = new HttpClient();
    await login(otherDevice, email);
    const accountPage = await otherDevice.request('/settings', 'GET', undefined, { 'Accept-Language': 'ru' });
    expect(accountPage.status).toBe(200);
    expect(await accountPage.text()).toContain('lang="en"');
    const sessions = SessionsResultSchema.parse(await (await owner.request('/api/identity/sessions')).json()).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    const otherSession = sessions.find((session) => !session.current)!;
    expect((await owner.request(`/api/identity/sessions/${otherSession.id}`, 'DELETE')).status).toBe(200);
    expect((await otherDevice.request('/api/identity/me')).status).toBe(401);
    const raw = (await pool.query('SELECT token FROM identity_sessions WHERE id=$1', [first.session.id])).rows[0].token;
    expect(JSON.stringify(first)).not.toContain(raw);
    expect((await owner.request('/api/auth/get-session')).status).toBe(404);
    expect((await owner.request('/api/auth/list-sessions')).status).toBe(404);
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 minute' WHERE id=$1", [first.session.id]);
    expect((await owner.request('/api/identity/me')).status).toBe(401);
    await login(owner, email);
    expect((await owner.request('/api/auth/sign-out', 'POST', {})).status).toBe(200);
    expect((await owner.request('/api/identity/me')).status).toBe(401);
  }, 90000);

  it('resets passwords with single-use, expiry checks and revocation of all old sessions', async () => {
    const email = `reset-${randomUUID()}@example.test`;
    const owner = new HttpClient();
    await signup(owner, email);
    await verify(owner, email);
    await login(owner, email);
    const unknown = await owner.request('/api/auth/request-password-reset', 'POST', { email: `unknown-${randomUUID()}@example.test`, locale: 'ru' });
    expect(await unknown.json()).toEqual({ status: 'accepted' });
    const requested = await owner.request('/api/auth/request-password-reset', 'POST', { email, locale: 'ru' });
    expect(await requested.json()).toEqual({ status: 'accepted' });
    const expiredLink = await mailLink(email, 'reset');
    const token = expiredLink.searchParams.get('token');
    await pool.query("UPDATE identity_verifications SET expires_at=now()-interval '1 minute' WHERE identifier=$1", [`reset-password:${token}`]);
    const newPassword = 'Changed synthetic password 43';
    expect((await owner.request('/api/auth/reset-password', 'POST', { token, newPassword })).status).toBe(422);
    await owner.request('/api/auth/request-password-reset', 'POST', { email, locale: 'ru' });
    const freshLink = await mailLink(email, 'reset');
    const reset = await owner.request('/api/auth/reset-password', 'POST', { token: freshLink.searchParams.get('token'), newPassword });
    expect(reset.status).toBe(200);
    expect((await owner.request('/api/identity/me')).status).toBe(401);
    expect((await owner.request('/api/auth/reset-password', 'POST', { token: freshLink.searchParams.get('token'), newPassword })).status).toBe(422);
    expect((await owner.request('/api/auth/sign-in/email', 'POST', { email, password })).status).toBe(401);
    await login(owner, email, newPassword);
    const other = new HttpClient();
    await login(other, email, newPassword);
    expect((await owner.request('/api/auth/change-password', 'POST', { currentPassword: 'wrong current password', newPassword: 'Second changed password 44' })).status).toBe(422);
    expect((await owner.request('/api/identity/me')).status).toBe(200);
    const changed = await owner.request('/api/auth/change-password', 'POST', { currentPassword: newPassword, newPassword: 'Second changed password 44' });
    expect(changed.status).toBe(200);
    expect((await other.request('/api/identity/me')).status).toBe(401);
    expect((await owner.request('/api/identity/me')).status).toBe(200);
  }, 90000);

  it('keeps guest intentions opaque, idempotent and bound to both browser and account', async () => {
    const email = `intent-${randomUUID()}@example.test`;
    const owner = new HttpClient();
    const key = randomUUID();
    const draft = { goal: 'Private synthetic goal that must never enter a URL', returnTo: '/app/projects?goal=leak' };
    const saved = IntentSavedSchema.parse(await (await owner.request('/api/identity/intents', 'POST', draft, { 'Idempotency-Key': key })).json());
    expect(JSON.stringify(saved)).not.toContain(draft.goal);
    const repeated = IntentSavedSchema.parse(await (await owner.request('/api/identity/intents', 'POST', draft, { 'Idempotency-Key': key })).json());
    expect(repeated.intentToken).toBe(saved.intentToken);
    expect((await owner.request('/api/identity/intents', 'POST', { ...draft, goal: 'changed' }, { 'Idempotency-Key': key })).status).toBe(409);
    await signup(owner, email);
    await verify(owner, email);
    await login(owner, email);
    const restored = IntentRestoredSchema.parse(await (await owner.request('/api/identity/intents/restore', 'POST', { intentToken: saved.intentToken })).json());
    expect(restored).toEqual({ goal: draft.goal, returnTo: '/app/projects' });
    const another = new HttpClient();
    await login(another, email);
    expect((await another.request('/api/identity/intents/restore', 'POST', { intentToken: saved.intentToken })).status).toBe(404);
    const foreignEmail = `foreign-${randomUUID()}@example.test`;
    await signup(another, foreignEmail);
    await verify(another, foreignEmail);
    await login(another, foreignEmail);
    another.cookies.set('tirlik.intent-browser', owner.cookies.get('tirlik.intent-browser')!);
    expect((await another.request('/api/identity/intents/restore', 'POST', { intentToken: saved.intentToken })).status).toBe(404);
    const current = IdentityViewerSchema.parse(await (await owner.request('/api/identity/me')).json());
    expect((await another.request(`/api/identity/sessions/${current.session.id}`, 'DELETE')).status).toBe(404);
    expect((await another.request('/api/identity/profile', 'PATCH', { name: 'Stale form must not update this account' }, { 'X-Tirlik-User-Id': current.user.id })).status).toBe(409);
    expect((await another.request('/api/identity/sessions', 'GET', undefined, { 'X-Tirlik-User-Id': current.user.id })).status).toBe(409);
    expect((await another.request('/api/auth/sign-out', 'POST', {}, { 'X-Tirlik-User-Id': current.user.id })).status).toBe(409);
    expect((await another.request('/api/identity/me')).status).toBe(200);
    const csrf = await fetch(`${origin}/api/identity/profile`, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: [...owner.cookies].map(([key, value]) => `${key}=${value}`).join('; ') }, body: JSON.stringify({ name: 'Unwanted change' }) });
    expect(csrf.status).toBe(403);
    expect((await owner.request('/api/auth/sign-in/email', 'POST', { email, password, returnTo: 'https://evil.example' })).status).toBe(200);
  }, 90000);

  it('does not enumerate duplicates, rejects expired verification and enforces persistent attempt limits', async () => {
    const email = `expiry-${randomUUID()}@example.test`;
    const client = new HttpClient();
    await signup(client, email);
    await signup(client, email);
    expect((await pool.query('SELECT count(*)::int AS count FROM identity_users WHERE email=$1', [email])).rows[0].count).toBe(1);
    const link = await mailLink(email, 'verify');
    await pool.query("UPDATE identity_email_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=(SELECT id FROM identity_users WHERE email=$1)", [email]);
    expect((await client.request('/api/auth/verify-email', 'POST', { token: link.searchParams.get('token') })).status).toBe(422);
    for (let index = 0; index < 10; index++) expect((await client.request('/api/auth/sign-in/email', 'POST', { email, password: 'wrong password long enough' })).status).toBe(401);
    const throttled = await client.request('/api/auth/sign-in/email', 'POST', { email, password });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('retry-after')).toBeTruthy();
  }, 90000);
});
