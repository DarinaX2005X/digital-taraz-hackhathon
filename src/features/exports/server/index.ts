import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createExportHandlers } from './handlers';
let handler: ReturnType<typeof createExportHandlers> | undefined;
export function getExportHandler() { if (!handler) { const origin = process.env.BETTER_AUTH_URL; if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED'); handler = createExportHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor }); } return handler; }
