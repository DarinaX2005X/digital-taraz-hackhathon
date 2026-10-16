import { getIdentityHandlers } from '../../identity/server';
import { getDatabasePool } from '../../../server/db/pool';
import { createBusinessContextHandlers } from './handlers';

let handler: ReturnType<typeof createBusinessContextHandlers> | undefined;
export function getBusinessContextHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL; if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createBusinessContextHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handler;
}
export { createBusinessContextService, readBusinessContext } from './service';
