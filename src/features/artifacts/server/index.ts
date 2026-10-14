import 'server-only';
import { getDatabasePool } from '../../../server/db/pool';
import { createArtifactService } from './service';

let service: ReturnType<typeof createArtifactService> | undefined;
export function getArtifactService() { return service ??= createArtifactService(getDatabasePool()); }
export { createArtifactService } from './service';
export type { ArtifactService } from './service';
