import 'server-only';
import { getDatabasePool } from './db/pool';
import { formatIdentityMail } from '@/features/identity/locales';
import { createIdentityHandlers } from '@/features/identity/server/handlers';
import { createIdentityMailer } from '@/features/identity/server/mail';

let handlers: ReturnType<typeof createIdentityHandlers> | undefined;

export function getIdentityHandlers() {
  if (!handlers) {
    const origin = process.env.BETTER_AUTH_URL;
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!origin || !secret) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handlers = createIdentityHandlers({ pool: getDatabasePool(), origin, secret, mailer: createIdentityMailer(process.env, formatIdentityMail) });
  }
  return handlers;
}
