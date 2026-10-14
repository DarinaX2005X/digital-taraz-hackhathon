import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema, InstantSchema } from '../../../contracts/primitives';
import { withWorkspaceAccess, type IdentityPrincipal } from '../../identity/server/access';
import { hasScope } from '../../identity/domain/policy';
import { IdentityError, validate } from '../../identity/server/http';
import { ArtifactListInputSchema, ArtifactListResultSchema } from '../contracts';
import { ArtifactConflict, readCursor, viewer, type ArtifactRow } from './service-support';

const CursorSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema, authzVersion: z.number().int().positive(), status: ArtifactListInputSchema.shape.status, kind: ArtifactListInputSchema.shape.kind, query: z.string().max(200), updatedAt: InstantSchema, id: IdSchema });

export function createArtifactCatalog(pool: Pool) {
  return async (principal: IdentityPrincipal, input: z.input<typeof ArtifactListInputSchema>) => {
    const body = validate(ArtifactListInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'read' }, async (tx, access) => {
      let after: z.infer<typeof CursorSchema> | undefined;
      if (body.after) {
        try { after = CursorSchema.parse(JSON.parse(Buffer.from(body.after, 'base64url').toString('utf8'))); }
        catch { throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed'); }
        if (after.workspaceId !== body.workspaceId || after.projectId !== body.projectId || after.status !== body.status || after.kind !== body.kind || after.query !== body.query || after.authzVersion !== access.workspace.authz_version) throw new ArtifactConflict(undefined, undefined, 'reload');
      }
      const cursor = await readCursor(tx, access);
      const confidential = hasScope({ ...access.membership, projectScopes: access.projectScopes, confidential: true }, 'read');
      const search = `%${body.query.replace(/[\\%_]/g, '\\$&')}%`;
      const rows = (await tx.query<Pick<ArtifactRow, 'id' | 'workspace_id' | 'project_id' | 'kind' | 'current_revision' | 'title' | 'status' | 'created_by' | 'updated_at'> & { page_updated_at: string }>(`SELECT id,workspace_id,project_id,kind,current_revision,title,status,created_by,updated_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_updated_at
        FROM artifacts WHERE workspace_id=$1 AND project_id=$2 AND ($3 OR access_class='internal')
        AND ($4='all' OR ($4='active' AND status NOT IN ('archived','trashed')) OR status=$4)
        AND ($5::text IS NULL OR kind=$5) AND ($6='' OR title ILIKE $7 ESCAPE '\\')
        AND ($8::timestamptz IS NULL OR (updated_at,id)<($8,$9::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $10`,
      [body.workspaceId, body.projectId, confidential, body.status, body.kind ?? null, body.query, search, after?.updatedAt ?? null, after?.id ?? null, body.limit + 1])).rows;
      const page = rows.slice(0, body.limit), last = page.at(-1);
      const nextAfter = rows.length > body.limit && last ? Buffer.from(JSON.stringify({ workspaceId: body.workspaceId, projectId: body.projectId, authzVersion: access.workspace.authz_version, status: body.status, kind: body.kind, query: body.query, updatedAt: last.page_updated_at, id: last.id })).toString('base64url') : null;
      return ArtifactListResultSchema.parse({ viewer: viewer(access), cursor, nextAfter, artifacts: page.map((row) => ({ id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, kind: row.kind, currentRevision: row.current_revision, title: row.title, status: row.status, createdBy: row.created_by, updatedAt: row.updated_at.toISOString() })) });
    });
  };
}
