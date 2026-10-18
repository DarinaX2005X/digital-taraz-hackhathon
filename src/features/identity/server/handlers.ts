import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { serializeLocaleCookie } from '../../../i18n/cookie';
import { ChangePasswordSchema, IdentityUserSchema, ProfileUpdateSchema, RequestMailSchema, ResetPasswordSchema, RestoreIntentSchema, SaveIntentSchema, SignInSchema, SignUpSchema, type IdentitySession, type IdentityUser } from '../contracts';
import { authReturnTo, safeReturnTo } from '../domain/return-to';
import { createIdentityAuth, type IdentityOptions } from './auth';
import { identityTransaction, lockIdentityActor, type SessionPrincipal } from './access';
import { assertOrigin, cookie, digest, errorResponse, IdentityError, json, limit, readJson, validate } from './http';
import { createTeamHandlers } from './team-handlers';

export interface IdentityActor { user: IdentityUser; session: { id: string; expiresAt: Date; createdAt: Date } }
const browserCookie = 'tirlik.intent-browser';
const authSchemas = {
  '/sign-up/email': SignUpSchema, '/sign-in/email': SignInSchema, '/request-password-reset': RequestMailSchema,
  '/reset-password': ResetPasswordSchema, '/change-password': ChangePasswordSchema, '/sign-out': z.strictObject({}),
};
type AuthPath = keyof typeof authSchemas;

export function createIdentityHandlers(options: IdentityOptions) {
  const { pool, origin, secret, mailer } = options;
  const auth = createIdentityAuth(options);
  const teams = createTeamHandlers(options);
  const secure = origin.startsWith('https:');
  const browserAttributes = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  async function getActor(headers: Headers): Promise<IdentityActor> {
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session) throw new IdentityError('UNAUTHENTICATED', 'identity.errors.unauthenticated');
    if (!(await pool.query('SELECT id FROM identity_users WHERE id=$1 AND deletion_requested_at IS NULL', [session.user.id])).rowCount) throw new IdentityError('UNAUTHENTICATED', 'identity.errors.unauthenticated');
    return { user: IdentityUserSchema.parse({ id: session.user.id, name: session.user.name, email: session.user.email, locale: session.user.locale }), session: { id: session.session.id, expiresAt: session.session.expiresAt, createdAt: session.session.createdAt } };
  }
  function assertExpectedActor(request: Request, actor: IdentityActor) {
    const expected = request.headers.get('x-tirlik-user-id');
    if (expected !== null && expected !== actor.user.id) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  }
  async function authHandler(request: Request): Promise<Response> {
    const started = Date.now();
    let padded = false;
    try {
      const path = new URL(request.url).pathname.slice('/api/auth'.length);
      if (request.method !== 'POST' || !(path in authSchemas)) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      assertOrigin(request, origin);
      const body = validate(authSchemas[path as AuthPath] as z.ZodType<Record<string, unknown>>, await readJson(request));
      if (['/change-password', '/sign-out'].includes(path) && request.headers.has('x-tirlik-user-id')) assertExpectedActor(request, await getActor(request.headers));
      const email = typeof body.email === 'string' ? body.email : undefined;
      padded = !!email;
      await limit(pool, `auth:global:${path}`, 120, 60);
      if (email) await limit(pool, `auth:email:${path}:${email}`, path === '/sign-in/email' ? 10 : 5, 600);
      if (path === '/request-password-reset') mailer.assertReady();
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      headers.set('x-tirlik-return-to', safeReturnTo(body.returnTo));
      headers.set('x-tirlik-intent', typeof body.intentToken === 'string' ? body.intentToken : '');
      const libraryBody = { ...body };
      delete libraryBody.returnTo;
      delete libraryBody.intentToken;
      if (path === '/change-password') libraryBody.revokeOtherSessions = true;
      if (path !== '/sign-up/email') delete libraryBody.locale;
      const libraryRequest = new Request(`${origin}/api/auth${path}`, { method: 'POST', headers, body: JSON.stringify(libraryBody) });
      const response = await auth.handler(libraryRequest);
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { code?: string };
        if (path === '/sign-up/email' && failure.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
          // Match a successful signup response without creating a session or exposing whether the address exists.
          return json({ status: 'account-checked', returnTo: authReturnTo(body.returnTo, typeof body.intentToken === 'string' ? body.intentToken : undefined) });
        }
        if (path === '/change-password' && failure.code === 'INVALID_PASSWORD') throw new IdentityError('VALIDATION_FAILED', 'identity.errors.invalidPassword', { currentPassword: ['identity.errors.invalidPassword'] });
        if (['INVALID_EMAIL_OR_PASSWORD', 'INVALID_PASSWORD', 'PASSWORD_MISMATCH'].includes(failure.code ?? '')) throw new IdentityError('UNAUTHENTICATED', 'identity.errors.invalidCredentials');
        if (['INVALID_TOKEN', 'TOKEN_EXPIRED'].includes(failure.code ?? '')) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.invalidToken');
        if (response.status === 401) throw new IdentityError('UNAUTHENTICATED', 'identity.errors.unauthenticated');
        if (response.status === 429) throw new IdentityError('RATE_LIMITED', 'identity.errors.rateLimited', undefined, 60);
        if (response.status >= 500) throw new IdentityError('UNAVAILABLE', 'identity.errors.unavailable');
        throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
      }
      const resultHeaders = new Headers();
      for (const value of response.headers.getSetCookie()) resultHeaders.append('Set-Cookie', value);
      const statuses = { '/sign-up/email': 'account-checked', '/sign-in/email': 'signed-in', '/request-password-reset': 'accepted', '/reset-password': 'password-reset', '/change-password': 'password-changed', '/sign-out': 'signed-out' } as const;
      if (path === '/sign-out') resultHeaders.append('Set-Cookie', `${browserCookie}=; Max-Age=0; ${browserAttributes}`);
      const returnTo = ['/sign-up/email', '/sign-in/email'].includes(path) ? authReturnTo(body.returnTo, typeof body.intentToken === 'string' ? body.intentToken : undefined) : undefined;
      return json({ status: statuses[path as AuthPath], ...(returnTo ? { returnTo } : {}) }, 200, resultHeaders);
    } catch (error) { return errorResponse(error); }
    finally {
      // Unknown/existing-account paths share a floor, including password hashing and SMTP waits.
      if (padded && Date.now() - started < 600) await new Promise((resolve) => setTimeout(resolve, 600 - (Date.now() - started)));
    }
  }
  async function identityHandler(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname.slice('/api/identity'.length);
      const mutation = !['GET', 'HEAD'].includes(request.method);
      if (mutation) assertOrigin(request, origin);
      if (request.method === 'POST' && path === '/intents') {
        await limit(pool, 'identity:intents:global', 100, 60);
        await pool.query('DELETE FROM identity_intents WHERE token_hash IN (SELECT token_hash FROM identity_intents WHERE expires_at<now() LIMIT 100)');
        const body = validate(SaveIntentSchema, await readJson(request));
        const key = request.headers.get('idempotency-key');
        if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
        const existingBrowser = cookie(request, browserCookie);
        const browser = existingBrowser && /^[a-f0-9]{64}$/.test(existingBrowser) ? existingBrowser : randomBytes(32).toString('hex');
        await limit(pool, `identity:intents:${browser}`, 20, 3600);
        const token = createHmac('sha256', secret).update(`intent:${browser}:${key}`).digest('hex');
        const bodyHash = digest(JSON.stringify(body));
        const expiresAt = new Date(Date.now() + 86400_000);
        const inserted = await pool.query<{ body_hash: string; expires_at: Date }>(`INSERT INTO identity_intents(token_hash,browser_hash,goal,return_to,idempotency_hash,body_hash,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(idempotency_hash) DO UPDATE SET idempotency_hash=EXCLUDED.idempotency_hash RETURNING body_hash,expires_at`, [digest(token), digest(browser), body.goal, safeReturnTo(body.returnTo), digest(`${browser}:${key}`), bodyHash, expiresAt]);
        if (inserted.rows[0]?.body_hash !== bodyHash || inserted.rows[0].expires_at <= new Date()) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
        return json({ intentToken: token, expiresAt: inserted.rows[0].expires_at.toISOString() }, 201, { 'Set-Cookie': `${browserCookie}=${browser}; Max-Age=86400; ${browserAttributes}` });
      }
      const actor = await getActor(request.headers);
      assertExpectedActor(request, actor);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      const teamResponse = await teams.handle(request, path, principal);
      if (teamResponse) {
        if (path === '/account/deletion' && request.method === 'POST' && teamResponse.ok) {
          const context = await auth.$context;
          for (const value of Object.values(context.authCookies)) teamResponse.headers.append('Set-Cookie', `${value.name}=; Max-Age=0; ${browserAttributes}`);
          teamResponse.headers.append('Set-Cookie', `${browserCookie}=; Max-Age=0; ${browserAttributes}`);
        }
        return teamResponse;
      }
      if (request.method === 'GET' && path === '/me') return json({ user: actor.user, session: { id: actor.session.id, expiresAt: actor.session.expiresAt.toISOString() }, ...await teams.listWorkspaces(principal) });
      if (request.method === 'PATCH' && path === '/profile') {
        const body = validate(ProfileUpdateSchema, await readJson(request));
        await identityTransaction(pool, async (transaction) => {
          await lockIdentityActor(transaction, principal, true);
          await transaction.query('UPDATE identity_users SET name=COALESCE($2,name),locale=COALESCE($3,locale),updated_at=now() WHERE id=$1', [actor.user.id, body.name, body.locale]);
        });
        const user = { ...actor.user, ...body };
        return json({ user }, 200, body.locale ? { 'Set-Cookie': serializeLocaleCookie(body.locale, secure) } : undefined);
      }
      if (request.method === 'GET' && path === '/sessions') {
        const rows = await pool.query<{ id: string; created_at: Date; updated_at: Date; expires_at: Date; user_agent: string | null }>('SELECT id,created_at,updated_at,expires_at,user_agent FROM identity_sessions WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 100', [actor.user.id]);
        const sessions: IdentitySession[] = rows.rows.map((session) => ({ id: session.id, current: session.id === actor.session.id, createdAt: session.created_at.toISOString(), updatedAt: session.updated_at.toISOString(), expiresAt: session.expires_at.toISOString(), deviceLabel: !session.user_agent ? 'unknown' : /Mobile|Android|iPhone/i.test(session.user_agent) ? 'mobile' : 'desktop' }));
        return json({ sessions });
      }
      if (request.method === 'DELETE' && /^\/sessions\/[a-f0-9-]+$/.test(path)) {
        const id = validate(z.uuid(), path.split('/')[2]);
        const deleted = await pool.query('DELETE FROM identity_sessions WHERE id=$1 AND user_id=$2 RETURNING id', [id, actor.user.id]);
        if (!deleted.rowCount) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
        return json({ revoked: true });
      }
      if (request.method === 'POST' && path === '/intents/restore') {
        const body = validate(RestoreIntentSchema, await readJson(request));
        const browser = cookie(request, browserCookie);
        if (!browser || !/^[a-f0-9]{64}$/.test(browser)) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
        const result = await pool.query<{ goal: string; return_to: string }>(`UPDATE identity_intents SET claimed_by=$3 WHERE token_hash=$1 AND browser_hash=$2 AND expires_at>now() AND (claimed_by IS NULL OR claimed_by=$3) RETURNING goal,return_to`, [digest(body.intentToken), digest(browser), actor.user.id]);
        if (!result.rows[0]) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
        return json({ goal: result.rows[0].goal, returnTo: result.rows[0].return_to });
      }
      throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    } catch (error) { return errorResponse(error); }
  }
  return { auth: authHandler, identity: identityHandler, getActor };
}
