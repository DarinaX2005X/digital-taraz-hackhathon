import 'server-only';
import { getDatabasePool } from '@/server/db/pool';
import { getIdentityHandlers } from '@/features/identity/server';
import { createWorkspaceHandlers } from './handlers';
let handler: ReturnType<typeof createWorkspaceHandlers> | undefined;
export function getWorkspaceHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createWorkspaceHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handler;
}
