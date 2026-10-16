import 'server-only';

import { getDatabasePool } from '@/server/db/pool';
import { getIdentityHandlers } from '@/features/identity/server';
import { createOperationsHandlers } from './handlers';

let handler: ReturnType<typeof createOperationsHandlers> | undefined;
export function getOperationsHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createOperationsHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handler;
}

export { authorizeExportResourcesInTransaction, authorizePlanExportResources, createOperationsService, loadPlanCapacityContextInTransaction, readPlanResourceSnapshotsInTransaction, resolveExportResourcesInTransaction, resolvePlanExportResources } from './service';
export { createOperationsExportAdapter, operationsExportAdapter } from './exports';
export { operationsBusinessToolExtension, operationsBusinessTools } from './ai-business-tool';

