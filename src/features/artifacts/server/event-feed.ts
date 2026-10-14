import type { Pool } from 'pg';
import { z } from 'zod';
import { WorkspaceCursorSchema, WorkspaceEventPageSchema, type WorkspaceEventKind, type WorkspaceEventPayload } from '../../../contracts/events';
import { IdSchema } from '../../../contracts/primitives';
import { hasScope } from '../../identity/domain/policy';
import { withWorkspaceAccess, type IdentityPrincipal } from '../../identity/server/access';
import { validate } from '../../identity/server/http';
import { decodeWorkspaceCursor, encodeWorkspaceCursor } from './workspace-events';

export const WorkspaceEventInputSchema = z.strictObject({ workspaceId: IdSchema, cursor: WorkspaceCursorSchema.optional(), limit: z.number().int().min(1).max(100).default(100) });
interface EventRow { cursor: string; project_id: string; access_class: 'internal' | 'confidential'; kind: WorkspaceEventKind; object_id: string; revision: number; payload: WorkspaceEventPayload; created_at: Date; project_scopes: string[] | null }
export function createWorkspaceEventFeed(pool: Pool) {
  return async (principal: IdentityPrincipal, input: z.input<typeof WorkspaceEventInputSchema>) => {
    const body = validate(WorkspaceEventInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const head = (await tx.query<{ cursor: string; retained_after: string }>('SELECT cursor::text,retained_after::text FROM workspace_event_heads WHERE workspace_id=$1', [body.workspaceId])).rows[0] ?? { cursor: '0', retained_after: '0' };
      const current = encodeWorkspaceCursor({ workspaceId: body.workspaceId, authzVersion: access.workspace.authz_version, position: head.cursor });
      const decoded = body.cursor ? decodeWorkspaceCursor(body.cursor) : { workspaceId: body.workspaceId, authzVersion: access.workspace.authz_version, position: '0' };
      if (!decoded || decoded.workspaceId !== body.workspaceId || decoded.authzVersion !== access.workspace.authz_version || BigInt(decoded.position) < BigInt(head.retained_after) || BigInt(decoded.position) > BigInt(head.cursor)) return WorkspaceEventPageSchema.parse({ workspaceId: body.workspaceId, cursor: current, events: [], hasMore: false, resetRequired: true });
      // Scan a bounded cursor window, including inaccessible events, so a closed
      // project never traps a poller on the same page or leaks event counts.
      const rows = (await tx.query<EventRow>(`SELECT e.cursor::text,e.project_id,e.access_class,e.kind,e.object_id,e.revision,e.payload,e.created_at,g.scopes AS project_scopes
        FROM workspace_events e LEFT JOIN identity_project_grants g ON g.workspace_id=e.workspace_id AND g.project_id=e.project_id AND g.user_id=$4
        WHERE e.workspace_id=$1 AND e.cursor>$2 AND e.cursor<=$3 ORDER BY e.cursor LIMIT $5`, [body.workspaceId, decoded.position, head.cursor, access.userId, body.limit])).rows;
      const encode = (position: string) => encodeWorkspaceCursor({ workspaceId: body.workspaceId, authzVersion: access.workspace.authz_version, position });
      const events = rows.filter((row) => (access.membership.role === 'owner' || row.project_scopes !== null) && hasScope({ ...access.membership, projectScopes: access.membership.role === 'owner' ? undefined : row.project_scopes as Parameters<typeof hasScope>[0]['projectScopes'], confidential: row.access_class === 'confidential' }, 'read')).map((row) => ({ cursor: encode(row.cursor), projectId: row.project_id, kind: row.kind, objectId: row.object_id, revision: row.revision, payload: row.payload, createdAt: row.created_at.toISOString() }));
      const last = rows.at(-1)?.cursor ?? head.cursor;
      return WorkspaceEventPageSchema.parse({ workspaceId: body.workspaceId, cursor: encode(last), events, hasMore: BigInt(last) < BigInt(head.cursor), resetRequired: false });
    });
  };
}
