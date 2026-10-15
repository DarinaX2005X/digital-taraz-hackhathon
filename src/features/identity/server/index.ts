import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { formatIdentityMail } from '../locales';
import { createIdentityHandlers } from './handlers';
import { createIdentityMailer } from './mail';

let handlers: ReturnType<typeof createIdentityHandlers> | undefined;

export function getLocalMailInbox(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.NODE_ENV !== 'development' || env.SMTP_HOST !== '127.0.0.1' ||
    env.SMTP_REQUIRE_TLS !== 'false' || env.SMTP_USER || env.SMTP_PASSWORD ||
    env.SMTP_PORT !== env.TIRLIK_SMTP_PORT) return undefined;
  const port = env.TIRLIK_MAIL_UI_PORT;
  const smtpPort = env.TIRLIK_SMTP_PORT;
  if (![port, smtpPort].every((value) => value && /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 65535)) return undefined;
  try {
    const origin = new URL(env.BETTER_AUTH_URL ?? '');
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) return undefined;
  } catch { return undefined; }
  return `http://127.0.0.1:${port}/`;
}

export function getIdentityHandlers() {
  if (!handlers) {
    const origin = process.env.BETTER_AUTH_URL;
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!origin || !secret) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handlers = createIdentityHandlers({ pool: getDatabasePool(), origin, secret, mailer: createIdentityMailer(process.env, formatIdentityMail) });
  }
  return handlers;
}
export { createIdentityHandlers } from './handlers';
export { createIdentityMailer } from './mail';
export type { IdentityActor } from './handlers';
export { withWorkspaceAccess, lockProjectAccess } from './access';
export type { IdentityPrincipal, SessionPrincipal, JobPrincipal, WorkspaceAccess, AccessRequest } from './access';
