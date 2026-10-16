import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { getIdentityHandlers } from '../../identity/server';
import { createExportHandlers } from './handlers';
import type { ExportService } from './service';
let handler: ReturnType<typeof createExportHandlers> | undefined;
let service: ExportService | undefined;
export function getExportHandler() { if (!handler) { const origin = process.env.BETTER_AUTH_URL; if (!origin) throw new Error('IDENTITY_CONFIG_REQUIRED'); handler = createExportHandlers({ pool: getDatabasePool(), origin, getActor: getIdentityHandlers().getActor, onService: (created) => { service = created; } }); } return handler; }
export function getExportService(): ExportService { if (!service) getExportHandler(); if (!service) throw new Error('EXPORT_SERVICE_NOT_INITIALIZED'); return service; }
export type { ExportService } from './service';
