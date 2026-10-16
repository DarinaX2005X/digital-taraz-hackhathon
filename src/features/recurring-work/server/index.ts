import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createRecurringWorkHandlers } from './handlers';
import type { RecurringRunBridge } from './runtime-bridge';

let bridge: RecurringRunBridge | undefined;
let handlers: ReturnType<typeof createRecurringWorkHandlers> | undefined;
export function configureRecurringRunBridge(next: RecurringRunBridge) { bridge = next; }
function getHandlers() {
  if (!handlers) {
    const origin = process.env.BETTER_AUTH_URL; if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handlers = createRecurringWorkHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor, getBridge: () => bridge });
  }
  return handlers;
}
export const getWorkRulesHandler = () => (request: Request) => getHandlers()(request, 'work-rules');
export const getOutcomesHandler = () => (request: Request) => getHandlers()(request, 'outcomes');
export { createRecurringWorkService, startWorkOccurrence } from './rules';
export { createOutcomeService } from './outcomes';
export type { RecurringRunBridge, RecurringRunRequest, RecurringRunResult } from './runtime-bridge';
