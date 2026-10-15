import { start } from 'workflow/api';
import type { Pool } from 'pg';
import { RUN_LIMITS } from '../domain/limits';
import { getRunRuntime } from './runtime';
import type { BudgetLedger } from './budget';
import type { Claim, RunService } from './service';
import { executeRunWorkflow } from './workflow';

export interface QueueDispatcherOptions {
  pool: Pool; service: Pick<RunService, 'claim'>; ledger: Pick<BudgetLedger, 'recoverExpired'>;
  enqueue: (claim: Claim) => Promise<{ runId: string }>;
}

export function createQueueDispatcher(options: QueueDispatcherOptions) {
  let running: Promise<number> | undefined;
  async function sweep() {
    await options.ledger.recoverExpired(40);
    let dispatched = 0;
    for (let count = 0; count < RUN_LIMITS.deploymentActive; count++) {
      const claim = await options.service.claim();
      if (!claim) break;
      const claimed = await options.pool.query(`UPDATE agent_runs SET workflow_state='dispatching',workflow_dispatched_at=now()
        WHERE id=$1 AND state='running' AND execution_epoch=$2 AND lease_owner=$3`, [claim.runId, claim.epoch, claim.leaseOwner]);
      if (!claimed.rowCount) continue;
      try {
        const workflow = await options.enqueue(claim);
        await options.pool.query(`UPDATE agent_runs SET workflow_state='started',workflow_run_id=$4
          WHERE id=$1 AND execution_epoch=$2 AND (lease_owner=$3 OR lease_owner IS NULL)`, [claim.runId, claim.epoch, claim.leaseOwner, workflow.runId]);
        dispatched++;
      } catch {
        // Start has no atomic idempotency key. Preserve uncertainty until the lease expires.
        await options.pool.query(`UPDATE agent_runs SET workflow_state='uncertain'
          WHERE id=$1 AND execution_epoch=$2 AND workflow_state='dispatching'`, [claim.runId, claim.epoch]);
      }
    }
    return dispatched;
  }
  return {
    tick() {
      if (!running) running = sweep().finally(() => { running = undefined; });
      return running;
    },
  };
}

const singleton = globalThis as typeof globalThis & {
  tirlikRunDispatcher?: { tick: () => Promise<number>; timer: ReturnType<typeof setInterval> };
};

export async function dispatchRunQueue() {
  const active = singleton.tirlikRunDispatcher;
  if (active) return active.tick();
  const runtime = getRunRuntime();
  return createQueueDispatcher({ ...runtime, enqueue: (claim) => start(executeRunWorkflow, [claim]) }).tick();
}

export function startLocalRunDispatcher() {
  if (singleton.tirlikRunDispatcher) return;
  if (process.env.WORKFLOW_TARGET_WORLD !== 'local' || !process.env.DATABASE_URL) return;
  const runtime = getRunRuntime();
  const dispatcher = createQueueDispatcher({ ...runtime, enqueue: (claim) => start(executeRunWorkflow, [claim]) });
  const tick = () => dispatcher.tick();
  const timer = setInterval(() => { void tick().catch(() => console.error('RUN_QUEUE_UNAVAILABLE')); }, 10_000);
  timer.unref();
  singleton.tirlikRunDispatcher = { tick, timer };
  // Next registers instrumentation before it listens. Let the listener start before queue delivery.
  const initial = setTimeout(() => { void tick().catch(() => console.error('RUN_QUEUE_UNAVAILABLE')); }, 1000);
  initial.unref();
}
