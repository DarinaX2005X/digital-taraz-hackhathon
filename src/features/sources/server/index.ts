import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createSourceHandlers } from './handlers';
import { getRunRuntime } from '../../runs/server/runtime';
import { dispatchRunQueue } from '../../runs/server/dispatcher';

let handler: ReturnType<typeof createSourceHandlers> | undefined;
export function getSourceHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createSourceHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor, runtime: { service: getRunRuntime().service, wake: dispatchRunQueue } });
  }
  return handler;
}
