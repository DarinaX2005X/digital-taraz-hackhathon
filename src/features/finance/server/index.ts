import 'server-only';

import { getDatabasePool } from '@/server/db/pool';
import { getIdentityHandlers } from '@/features/identity/server';
import { createFinanceHandlers } from './handlers';

let handler: ReturnType<typeof createFinanceHandlers> | undefined;

export function getFinanceHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createFinanceHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handler;
}
