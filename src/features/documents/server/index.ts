import 'server-only';
import { getDatabasePool } from '@/server/db/pool';
import { getIdentityHandlers } from '@/features/identity/server';
import { createDocumentImportHandler } from './import-handler';

let handler: ReturnType<typeof createDocumentImportHandler> | undefined;
export function getDocumentImportHandler() {
  if (!handler) {
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED');
    handler = createDocumentImportHandler({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor });
  }
  return handler;
}
