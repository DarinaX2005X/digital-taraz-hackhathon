import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createDependencyHandlers } from './handlers';
let handlers: ReturnType<typeof createDependencyHandlers> | undefined;
export function getDependencyHandlers() {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
  return handlers ??= createDependencyHandlers({ pool: getDatabasePool(), origin, getActor: (headers) => getIdentityHandlers().getActor(headers) });
}
