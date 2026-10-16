import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createCollaborationHandlers } from './handlers';

let handlers: ReturnType<typeof createCollaborationHandlers> | undefined;
function getHandlers() {
  if (!handlers) {
    const origin = process.env.BETTER_AUTH_URL; if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handlers = createCollaborationHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handlers;
}
export const getCommentsHandler = () => (request: Request) => getHandlers()(request, 'comments');
export const getCollaborationHandler = () => (request: Request) => getHandlers()(request, 'collaboration');
export { createCollaborationService } from './service';
export { createProjectAccessService } from './project-access';
