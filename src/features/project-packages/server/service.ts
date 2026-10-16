import type { Pool } from 'pg';
import { z } from 'zod';
import { withWorkspaceAccess, type IdentityPrincipal } from '../../identity/server/access';
import { validate } from '../../identity/server/http';
import type { ExportService } from '../../exports/server';
import { CreateProjectPackageSchema, ProjectPackageListInputSchema, ProjectPackageListResultSchema, ProjectPackageSchema } from '../contracts';

export function createProjectPackageService(pool: Pool, exports: ExportService) {
  async function list(principal: IdentityPrincipal, input: z.input<typeof ProjectPackageListInputSchema>) {
    const body = validate(ProjectPackageListInputSchema, input);
    const { ids, authzVersion } = await withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'export' }, async (tx, access) => ({
      ids: (await tx.query<{ id: string }>(`SELECT id FROM export_jobs WHERE workspace_id=$1 AND created_by=$2 AND deleted_at IS NULL
        AND input_manifest->'release'->>'projectId'=$3 ORDER BY created_at DESC,id DESC LIMIT 100`, [body.workspaceId, access.userId, body.projectId])).rows.map((row) => row.id),
      authzVersion: access.workspace.authz_version,
    }));
    const packages = [];
    for (const id of ids) {
      const job = await exports.read(principal, body.workspaceId, id);
      if (job.release?.projectId === body.projectId) packages.push(ProjectPackageSchema.parse(job));
    }
    return ProjectPackageListResultSchema.parse({ packages, authzVersion });
  }
  async function create(principal: IdentityPrincipal, operationId: string, input: z.input<typeof CreateProjectPackageSchema>) {
    const body = validate(CreateProjectPackageSchema, input);
    return ProjectPackageSchema.parse(await exports.create(principal, operationId, body));
  }
  return { list, create };
}
