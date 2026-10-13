import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import { IdentityLocaleSchema } from '../contracts';
import { authReturnTo } from '../domain/return-to';
import { digest } from './http';
import type { IdentityMailer } from './mail';

export interface IdentityOptions { pool: Pool; origin: string; secret: string; mailer: IdentityMailer; verificationTtlSeconds?: number; resetTtlSeconds?: number }

export function createIdentityAuth(options: IdentityOptions) {
  const { pool, origin, secret, mailer } = options;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname)) || secret.length < 32) throw new Error('IDENTITY_CONFIG_INVALID');
  const verificationTtl = options.verificationTtlSeconds ?? 3600;
  const locale = (user: object) => IdentityLocaleSchema.catch('ru').parse('locale' in user ? user.locale : undefined);
  const callback = (token: string, route: string, request?: Request) => {
    const url = new URL(route, origin);
    url.searchParams.set('token', token);
    if (request) url.searchParams.set('returnTo', authReturnTo(request.headers.get('x-tirlik-return-to'), request.headers.get('x-tirlik-intent') ?? undefined));
    return url.href;
  };
  return betterAuth({
    appName: 'Tirlik', baseURL: origin, basePath: '/api/auth', secret, database: pool,
    trustedOrigins: [origin], logger: { disabled: true }, telemetry: { enabled: false },
    advanced: { database: { generateId: () => randomUUID() }, useSecureCookies: parsedOrigin.protocol === 'https:', cookiePrefix: 'tirlik', defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' } },
    rateLimit: { enabled: false }, // The HTTP boundary applies atomic, persistent per-action limits.
    user: {
      modelName: 'identity_users', fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      additionalFields: { locale: { type: 'string', required: false, defaultValue: 'ru', input: true } },
      deleteUser: { enabled: false }, changeEmail: { enabled: false },
    },
    session: {
      modelName: 'identity_sessions', fields: { userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', createdAt: 'created_at', updatedAt: 'updated_at' },
      expiresIn: 7 * 86400, freshAge: 900, disableSessionRefresh: true, cookieCache: { enabled: false },
    },
    account: { modelName: 'identity_accounts', fields: { userId: 'user_id', accountId: 'account_id', providerId: 'provider_id', accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token', accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
    verification: { modelName: 'identity_verifications', fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: options.resetTtlSeconds ?? 1800, revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }, request) { await mailer.send(user.email, { kind: 'reset', locale: locale(user), url: callback(token, '/auth/reset', request) }); },
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: verificationTtl,
      async sendVerificationEmail({ user, token }, request) {
        // Sending can occur before the library commits signup, so this receipt has no user FK.
        await pool.query('DELETE FROM identity_email_tokens WHERE token_hash IN (SELECT token_hash FROM identity_email_tokens WHERE expires_at<now() LIMIT 100)');
        await pool.query(`INSERT INTO identity_email_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second') ON CONFLICT(token_hash) DO NOTHING`, [digest(token), user.id, verificationTtl]);
        await mailer.send(user.email, { kind: 'verify', locale: locale(user), url: callback(token, '/auth/verify', request) });
      },
    },
  });
}
export type IdentityAuth = ReturnType<typeof createIdentityAuth>;
