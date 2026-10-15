import 'server-only';
import { getDatabasePool } from '@/server/db/pool';
import { getIdentityHandlers } from '@/features/identity/server';
import { createDesignImportHandler } from './import-handler';
let handler:ReturnType<typeof createDesignImportHandler>|undefined;
export function getDesignImportHandler(){if(!handler){const origin=process.env.BETTER_AUTH_URL;if(!origin)throw new Error('IDENTITY_CONFIG_REQUIRED');handler=createDesignImportHandler({pool:getDatabasePool(),origin,getActor:getIdentityHandlers().getActor});}return handler;}
