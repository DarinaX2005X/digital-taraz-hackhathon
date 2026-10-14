import type { Pool } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { withWorkspaceAccess, type IdentityPrincipal } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';

const CleanupInputSchema = z.strictObject({ workspaceId: IdSchema, limit: z.number().int().min(1).max(100).default(50) });
const reachable = `WITH RECURSIVE live(hash) AS (
  SELECT root_hash FROM artifact_content_manifests WHERE workspace_id=$1
  UNION SELECT e.child_hash FROM artifact_chunk_edges e JOIN live l ON l.hash=e.parent_hash WHERE e.workspace_id=$1
)`;

/** Trusted maintenance entry point, never a public purge endpoint. A job still
 * carries its owner's current authz epoch. Content GC takes no artifact locks:
 * workspace authority -> exclusive content lock -> event head is the order. */
export async function cleanupArtifactContent(pool: Pool, principal: IdentityPrincipal, input: z.input<typeof CleanupInputSchema>) {
  const body = validate(CleanupInputSchema, input);
  try {
    return await withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      if (access.membership.role !== 'owner') throw new IdentityError('FORBIDDEN', 'artifacts.errors.forbidden');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`artifact-content:${body.workspaceId}`]);
      const pending = (await tx.query<{ artifact_id: string }>("SELECT artifact_id FROM artifact_tombstones WHERE workspace_id=$1 AND cleanup_state='pending' AND cleanup_after<=now() ORDER BY deleted_at,artifact_id LIMIT $2 FOR UPDATE SKIP LOCKED", [body.workspaceId, body.limit])).rows;
      if (!pending.length) return { cleanedArtifacts: 0, removedChunks: 0, removedManifests: 0 };
      const manifests = await tx.query(`DELETE FROM artifact_content_manifests m WHERE m.workspace_id=$1
        AND NOT EXISTS(SELECT 1 FROM artifact_versions v WHERE v.workspace_id=m.workspace_id AND v.content_id=m.id)
        AND NOT EXISTS(SELECT 1 FROM artifacts a WHERE a.workspace_id=m.workspace_id AND a.content_id=m.id)`, [body.workspaceId]);
      await tx.query(`${reachable} DELETE FROM artifact_chunk_edges e WHERE e.workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM live WHERE live.hash=e.parent_hash)`, [body.workspaceId]);
      const chunks = await tx.query(`${reachable} DELETE FROM artifact_chunks c WHERE c.workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM live WHERE live.hash=c.hash)`, [body.workspaceId]);
      await tx.query("UPDATE artifact_tombstones SET cleanup_state='complete',cleanup_attempts=cleanup_attempts+1 WHERE workspace_id=$1 AND artifact_id=ANY($2::uuid[])", [body.workspaceId, pending.map((row) => row.artifact_id)]);
      return { cleanedArtifacts: pending.length, removedChunks: chunks.rowCount ?? 0, removedManifests: manifests.rowCount ?? 0 };
    });
  } catch (error) {
    // A failed transaction leaves the tombstones pending. Backoff is recorded
    // independently only while the same principal is still authorized.
    if (!(error instanceof IdentityError)) {
      await withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
        if (access.membership.role !== 'owner') return;
        await tx.query("UPDATE artifact_tombstones SET cleanup_attempts=cleanup_attempts+1,cleanup_after=now()+LEAST(3600,power(2,LEAST(cleanup_attempts,10))::integer)*interval '1 second' WHERE workspace_id=$1 AND artifact_id IN (SELECT artifact_id FROM artifact_tombstones WHERE workspace_id=$1 AND cleanup_state='pending' AND cleanup_after<=now() ORDER BY deleted_at,artifact_id LIMIT $2)", [body.workspaceId, body.limit]);
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function retainWorkspaceEvents(pool: Pool, principal: IdentityPrincipal, workspaceId: string) {
  validate(IdSchema, workspaceId);
  return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'edit' }, async (tx, access) => {
    if (access.membership.role !== 'owner') throw new IdentityError('FORBIDDEN', 'artifacts.errors.forbidden');
    const head = (await tx.query<{ cursor: string; retained_after: string }>('SELECT cursor::text,retained_after::text FROM workspace_event_heads WHERE workspace_id=$1 FOR UPDATE', [workspaceId])).rows[0];
    if (!head) return { removedEvents: 0 };
    const row = (await tx.query<{ before_cursor: string }>("SELECT COALESCE(min(cursor)-1,$2::bigint)::text AS before_cursor FROM workspace_events WHERE workspace_id=$1 AND created_at>=now()-interval '7 days'", [workspaceId, head.cursor])).rows[0]!;
    const deleted = await tx.query('DELETE FROM workspace_events WHERE workspace_id=$1 AND cursor<=$2', [workspaceId, row.before_cursor]);
    await tx.query('UPDATE workspace_event_heads SET retained_after=GREATEST(retained_after,$2) WHERE workspace_id=$1', [workspaceId, row.before_cursor]);
    return { removedEvents: deleted.rowCount ?? 0 };
  });
}
