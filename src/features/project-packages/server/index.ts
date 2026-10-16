import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { getExportService } from '../../exports/server';
import { createProjectPackageService } from './service';

let service: ReturnType<typeof createProjectPackageService> | undefined;
export function getProjectPackageService() { return service ??= createProjectPackageService(getDatabasePool(), getExportService()); }
