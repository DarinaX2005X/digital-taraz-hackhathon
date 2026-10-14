import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isolatedRunPool, syntheticRun } from './database';

let pool: Pool;
beforeAll(() => { pool = isolatedRunPool(); });
afterAll(async () => { await pool?.end(); });
async function rollback(action: (transaction: PoolClient) => Promise<void>) {
  const transaction = await pool.connect();
  try { await transaction.query('BEGIN'); await action(transaction); }
  finally { await transaction.query('ROLLBACK'); transaction.release(); }
}
async function rejected(transaction: PoolClient, query: string, values: unknown[], code: string) {
  await transaction.query('SAVEPOINT invalid_input');
  await expect(transaction.query(query, values)).rejects.toMatchObject({ code });
  await transaction.query('ROLLBACK TO SAVEPOINT invalid_input');
}

describe('durable runtime database invariants', () => {
  it('requires coherent terminal, lease and bounded operation state', async () => rollback(async (transaction) => {
    const { runId } = await syntheticRun(transaction);
    await rejected(transaction, "UPDATE agent_runs SET state='cancelled' WHERE id=$1", [runId], '23514');
    await rejected(transaction, 'UPDATE agent_runs SET lease_owner=$2 WHERE id=$1', [runId, randomUUID()], '23514');
    await rejected(transaction, 'UPDATE agent_runs SET request_count=13 WHERE id=$1', [runId], '23514');
    await rejected(transaction, 'UPDATE agent_runs SET budget_limit_usd=0.51 WHERE id=$1', [runId], '23514');
    await transaction.query("UPDATE agent_runs SET state='cancelled',finished_at=now(),execution_epoch=execution_epoch+1 WHERE id=$1", [runId]);
    expect((await transaction.query('SELECT state,execution_epoch FROM agent_runs WHERE id=$1', [runId])).rows[0]).toEqual({ state: 'cancelled', execution_epoch: 1 });
  }));

  it('makes the effect call identity unique even when a caller changes the input hash', async () => rollback(async (transaction) => {
    const { runId, stepId } = await syntheticRun(transaction);
    const insert = "INSERT INTO agent_tool_receipts(run_id,step_id,tool_call_id,input_hash,output_hash,result_refs) VALUES($1,$2,'call_1',$3,$4,'[]')";
    await transaction.query(insert, [runId, stepId, 'a'.repeat(64), 'b'.repeat(64)]);
    await rejected(transaction, insert, [runId, stepId, 'c'.repeat(64), 'b'.repeat(64)], '23505');
    await rejected(transaction, insert, [randomUUID(), stepId, 'a'.repeat(64), 'b'.repeat(64)], '23503');
  }));

  it('rejects foreign workspace projects and usage attribution', async () => rollback(async (transaction) => {
    const own = await syntheticRun(transaction);
    const foreign = await syntheticRun(transaction);
    const projectId = randomUUID();
    await transaction.query(`INSERT INTO projects(id,workspace_id,title,created_by,creation_key,creation_body_hash)
      VALUES($1,$2,'Synthetic foreign project',$3,$4,$5)`, [projectId, foreign.workspaceId, foreign.userId, randomUUID(), 'a'.repeat(64)]);
    await rejected(transaction, 'UPDATE agent_runs SET project_id=$2 WHERE id=$1', [own.runId, projectId], '23503');
    await transaction.query('UPDATE agent_runs SET project_id=$2 WHERE id=$1', [foreign.runId, projectId]);
    const usageId = randomUUID();
    const insertUsage = `INSERT INTO agent_run_usage(id,run_id,step_id,call_key,input_hash,workspace_id,budget_day,state,model,endpoint,pricing_snapshot,reserved_usd,lease_epoch)
      VALUES($1,$2,$3,'tenant_scope',$4,$5,current_date,'reserved','synthetic/model','synthetic','{}','0.1',1)`;
    await rejected(transaction, insertUsage, [usageId, own.runId, own.stepId, 'a'.repeat(64), foreign.workspaceId], '23503');
    await transaction.query(insertUsage, [usageId, own.runId, own.stepId, 'a'.repeat(64), own.workspaceId]);
    expect((await transaction.query('SELECT workspace_id FROM agent_run_usage WHERE id=$1', [usageId])).rows[0].workspace_id).toBe(own.workspaceId);
  }));

  it('stores fractional pricing without float drift and cannot manufacture a reconciled unknown charge', async () => rollback(async (transaction) => {
    const { workspaceId, runId, stepId } = await syntheticRun(transaction);
    const usageId = randomUUID();
    await transaction.query(`INSERT INTO agent_run_usage(id,run_id,step_id,call_key,input_hash,workspace_id,budget_day,state,model,endpoint,pricing_snapshot,reserved_usd,lease_epoch)
      VALUES($1,$2,$3,'call_1',$4,$5,current_date,'reserved','synthetic/model','synthetic','{}','0.146944',1)`, [usageId, runId, stepId, 'a'.repeat(64), workspaceId]);
    expect((await transaction.query('SELECT (reserved_usd*2)::text AS total FROM agent_run_usage WHERE id=$1', [usageId])).rows[0].total).toBe('0.293888000000');
    await rejected(transaction, "UPDATE agent_run_usage SET state='succeeded',reconciled_at=now() WHERE id=$1", [usageId], '23514');
    await rejected(transaction, "UPDATE agent_run_usage SET state='ambiguous' WHERE id=$1", [usageId], '23514');
    await transaction.query("UPDATE agent_run_usage SET state='ambiguous',dispatched_at=now() WHERE id=$1", [usageId]);
    expect((await transaction.query('SELECT reserved_usd,actual_usd,reconciled_at FROM agent_run_usage WHERE id=$1', [usageId])).rows[0]).toEqual({ reserved_usd: '0.146944000000', actual_usd: null, reconciled_at: null });
  }));

  it('bounds private continuation storage and gives every run an independent ordered event cursor', async () => rollback(async (transaction) => {
    const { runId } = await syntheticRun(transaction);
    await transaction.query('INSERT INTO agent_run_contexts(run_id,state) VALUES($1,$2)', [runId, JSON.stringify({ count: 1 })]);
    await rejected(transaction, 'UPDATE agent_run_contexts SET state=$2 WHERE run_id=$1', [runId, JSON.stringify({ text: 'x'.repeat(65536) })], '23514');
    const event = "INSERT INTO agent_run_events(run_id,sequence,id,kind,payload) VALUES($1,1,$2,'run_state','{}')";
    await transaction.query(event, [runId, randomUUID()]);
    await rejected(transaction, event, [runId, randomUUID()], '23505');
  }));

  it('rejects NaN in every monetary accumulator and charge', async () => rollback(async (transaction) => {
    const { workspaceId, runId, stepId } = await syntheticRun(transaction);
    for (const column of ['budget_limit_usd', 'reserved_usd', 'spent_usd']) {
      await rejected(transaction, `UPDATE agent_runs SET ${column}='NaN' WHERE id=$1`, [runId], '23514');
    }
    await transaction.query("INSERT INTO agent_budget_days(scope,scope_key,day) VALUES('workspace',$1,current_date)", [workspaceId]);
    for (const column of ['reserved_usd', 'spent_usd']) {
      await rejected(transaction, `UPDATE agent_budget_days SET ${column}='NaN' WHERE scope='workspace' AND scope_key=$1 AND day=current_date`, [workspaceId], '23514');
    }
    const usageId = randomUUID();
    await transaction.query(`INSERT INTO agent_run_usage(id,run_id,step_id,call_key,input_hash,workspace_id,budget_day,state,model,endpoint,pricing_snapshot,reserved_usd,lease_epoch)
      VALUES($1,$2,$3,'finite',$4,$5,current_date,'reserved','synthetic/model','synthetic','{}','0.1',1)`, [usageId, runId, stepId, 'a'.repeat(64), workspaceId]);
    await rejected(transaction, "UPDATE agent_run_usage SET reserved_usd='NaN' WHERE id=$1", [usageId], '23514');
    await rejected(transaction, "UPDATE agent_run_usage SET state='succeeded',actual_usd='NaN',dispatched_at=now(),reconciled_at=now() WHERE id=$1", [usageId], '23514');
  }));

  it('requires a known input token total before accepting cached input tokens', async () => rollback(async (transaction) => {
    const { workspaceId, runId, stepId } = await syntheticRun(transaction);
    const usageId = randomUUID();
    await transaction.query(`INSERT INTO agent_run_usage(id,run_id,step_id,call_key,input_hash,workspace_id,budget_day,state,model,endpoint,pricing_snapshot,reserved_usd,lease_epoch)
      VALUES($1,$2,$3,'cached',$4,$5,current_date,'reserved','synthetic/model','synthetic','{}','0.1',1)`, [usageId, runId, stepId, 'a'.repeat(64), workspaceId]);
    await rejected(transaction, 'UPDATE agent_run_usage SET cached_input_tokens=0 WHERE id=$1', [usageId], '23514');
    await rejected(transaction, 'UPDATE agent_run_usage SET input_tokens=1,cached_input_tokens=2 WHERE id=$1', [usageId], '23514');
    await transaction.query('UPDATE agent_run_usage SET input_tokens=5,cached_input_tokens=3 WHERE id=$1', [usageId]);
    expect((await transaction.query('SELECT input_tokens,cached_input_tokens FROM agent_run_usage WHERE id=$1', [usageId])).rows[0]).toEqual({ input_tokens: 5, cached_input_tokens: 3 });
  }));
});
