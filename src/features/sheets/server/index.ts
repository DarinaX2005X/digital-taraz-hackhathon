import 'server-only';
import { getDatabasePool } from '@/server/db/pool';
import { getIdentityHandlers } from '@/features/identity/server';
import { createSheetHandlers } from './handlers';
let handlers: ReturnType<typeof createSheetHandlers> | undefined;
export function getSheetHandlers() {
  if (!handlers) {
    const origin = process.env.BETTER_AUTH_URL; if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handlers = createSheetHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handlers;
}
