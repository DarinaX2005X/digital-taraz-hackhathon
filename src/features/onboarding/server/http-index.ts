import 'server-only';
import { getDatabasePool } from '@/server/db/pool';
import { getIdentityHandlers } from '@/features/identity/server';
import { createOnboardingHandler } from './handlers';

let handler: ReturnType<typeof createOnboardingHandler> | undefined;
export function getOnboardingHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createOnboardingHandler({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handler;
}
