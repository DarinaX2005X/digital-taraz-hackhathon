import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { formatIdentityMail } from '../locales';
import { createIdentityHandlers } from './handlers';
import { createIdentityMailer } from './mail';

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
export { createIdentityHandlers } from './handlers';
export { createIdentityMailer } from './mail';
export type { IdentityActor } from './handlers';
export { withWorkspaceAccess } from './access';
export type { IdentityPrincipal, SessionPrincipal, JobPrincipal, WorkspaceAccess, AccessRequest } from './access';
