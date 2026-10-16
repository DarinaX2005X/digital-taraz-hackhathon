import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createProjectPackageHandlers } from './handlers';
import { getProjectPackageService } from './index';

let handler: ReturnType<typeof createProjectPackageHandlers> | undefined;
export function getProjectPackageHandler() {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
  return handler ??= createProjectPackageHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor, service: getProjectPackageService() });
}
