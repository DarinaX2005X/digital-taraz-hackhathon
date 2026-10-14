import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createArtifactHandlers } from './handlers';

let handlers: ReturnType<typeof createArtifactHandlers> | undefined;
export function getArtifactHandlers() {
  if (!handlers) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handlers = createArtifactHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handlers;
}
