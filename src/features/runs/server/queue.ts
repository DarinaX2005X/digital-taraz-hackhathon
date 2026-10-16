import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { identityTransaction } from '../../identity/server/access';
import { RUN_LIMITS } from '../domain/limits';
import { emitEvent, required, type RunRow } from './data';
import type { Claim } from './service';

/** Claims queued work without constructing the application capability/tool registry. */
export async function claimNextRun(pool: Pool): Promise<Claim | null> {
  return identityTransaction(pool, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('agent-queue',0))");
    const active = required((await tx.query<{ count: string }>("SELECT count(*) FROM agent_runs WHERE state='running' AND lease_until>now()" )).rows[0]);
    if (Number(active.count) >= RUN_LIMITS.deploymentActive) return null;
    const candidate = (await tx.query<RunRow>(`SELECT r.* FROM agent_runs r JOIN agent_queue_workspaces q ON q.workspace_id=r.workspace_id
      WHERE r.state='queued' AND (r.deadline_at IS NULL OR r.deadline_at>now())
      AND (SELECT count(*) FROM agent_runs current WHERE current.workspace_id=r.workspace_id AND current.state='running' AND current.lease_until>now())<$1
      ORDER BY q.last_served,r.created_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`, [RUN_LIMITS.workspaceActive])).rows[0];
    if (!candidate) return null;
    const leaseOwner = randomUUID();
    const row = required((await tx.query<RunRow>(`UPDATE agent_runs SET state='running',execution_epoch=execution_epoch+1,lease_owner=$2,lease_until=now()+($3 * interval '1 millisecond'),
      started_at=COALESCE(started_at,now()),deadline_at=COALESCE(deadline_at,now()+($4 * interval '1 millisecond')) WHERE id=$1 RETURNING *`, [candidate.id, leaseOwner, RUN_LIMITS.leaseMs, RUN_LIMITS.runDeadlineMs])).rows[0]);
    const sequence = required((await tx.query<{ sequence: string }>('UPDATE agent_queue_clock SET sequence=sequence+1 WHERE singleton RETURNING sequence')).rows[0]).sequence;
    await tx.query('UPDATE agent_queue_workspaces SET last_served=$2 WHERE workspace_id=$1', [row.workspace_id, sequence]);
    await emitEvent(tx, row.id, { kind: 'run_state' });
    return { runId: row.id, epoch: row.execution_epoch, leaseOwner };
  });
}
