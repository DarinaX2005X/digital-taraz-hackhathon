import type { Pool } from 'pg';
import { IdSchema } from '@/contracts/primitives';
import { hasScope } from '@/features/identity/domain/policy';
import { withWorkspaceAccess, type SessionPrincipal } from '@/features/identity/server/access';
import { IdentityError, validate } from '@/features/identity/server/http';
import { ProjectViewSchema, RecordProjectViewSchema } from '../view-contracts';

/** Mounted only after migration 0009 is accepted and applied. */
export function createProjectViews(pool: Pool) {
  async function read(principal: SessionPrincipal, workspaceId: string, projectId: string) {
    validate(IdSchema, workspaceId); validate(IdSchema, projectId);
    return withWorkspaceAccess(pool, principal, { workspaceId, projectId, scope: 'read' }, async (tx, access) => {
      const confidential = hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'read-confidential');
      const row = (await tx.query<{ last_opened_at: Date; selected_artifact_id: string | null }>(`SELECT v.last_opened_at,a.id AS selected_artifact_id FROM workspace_project_views v
        LEFT JOIN artifacts a ON a.id=v.selected_artifact_id AND a.workspace_id=v.workspace_id AND a.project_id=v.project_id AND a.status NOT IN ('trashed','archived') AND (a.access_class='internal' OR $4::boolean)
        WHERE v.workspace_id=$1 AND v.project_id=$2 AND v.user_id=$3`, [workspaceId, projectId, principal.userId, confidential])).rows[0];
      return ProjectViewSchema.parse({ projectId, workspaceId, selectedArtifactId: row?.selected_artifact_id ?? null, lastOpenedAt: row?.last_opened_at.toISOString() ?? null });
    });
  }
  async function record(principal: SessionPrincipal, projectId: string, input: unknown) {
    validate(IdSchema, projectId); const body = validate(RecordProjectViewSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId, scope: 'read', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      if (body.selectedArtifactId) {
        const confidential = hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'read-confidential');
        const selected = await tx.query("SELECT id FROM artifacts WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND status NOT IN ('trashed','archived') AND (access_class='internal' OR $4::boolean) FOR SHARE", [body.selectedArtifactId, body.workspaceId, projectId, confidential]);
        if (!selected.rowCount) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      }
      const row = (await tx.query<{ selected_artifact_id: string | null; last_opened_at: Date }>(`INSERT INTO workspace_project_views(workspace_id,project_id,user_id,selected_artifact_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET last_opened_at=now(),selected_artifact_id=CASE WHEN $5::boolean THEN EXCLUDED.selected_artifact_id ELSE workspace_project_views.selected_artifact_id END
        RETURNING selected_artifact_id,last_opened_at`, [body.workspaceId, projectId, principal.userId, body.selectedArtifactId ?? null, body.selectedArtifactId !== undefined])).rows[0]!;
      // The record response does not disclose an older selection that may have moved or lost access.
      return ProjectViewSchema.parse({ projectId, workspaceId: body.workspaceId, selectedArtifactId: body.selectedArtifactId ?? null, lastOpenedAt: row.last_opened_at.toISOString() });
    });
  }
  return { read, record };
}
