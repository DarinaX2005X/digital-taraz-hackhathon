import 'server-only';
import { getIdentityHandlers } from '../../identity/server';
import { getRunRuntime } from './runtime';
import { createRunHandlers } from './handlers';
import { dispatchRunQueue } from './dispatcher';

let handler: ReturnType<typeof createRunHandlers> | undefined;
export function getRunHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createRunHandlers({ ...getRunRuntime(), origin, getActor: getIdentityHandlers().getActor, wake: dispatchRunQueue });
  }
  return handler;
}
