import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { UsdSchema, type RunUsageState } from '../../../contracts/runs';
import { identityTransaction, withWorkspaceAccess } from '../../identity/server/access';
import { RunError } from '../domain/errors';
import { RUN_LIMITS } from '../domain/limits';
import { exceedsUsd } from '../domain/money';
import { assertFence, boundedObject, emitEvent, hash, loadRun, lockStep, required, type JsonObject, type RunFence, type RunRow } from './data';
import { validatePricing, type PricingSnapshot } from './pricing';
import { authorizeModelEndpoint, isCandidateProof, type ModelRoute } from './model-policy';

export interface UsageRow {
  id: string; run_id: string; step_id: string; call_key: string; operation_key: string | null; input_hash: string; workspace_id: string;
  budget_day: string; state: RunUsageState; model: string; endpoint: string; pricing_snapshot: PricingSnapshot;
  authorization_id: string | null; reserved_usd: string; actual_usd: string | null; lease_epoch: number;
}
interface AuthorizationRow { id: string; state: string; limit_usd: string; reserved_usd: string; spent_usd: string; key_fingerprint: string }
interface Balance { reserved: string; spent: string }
interface OperationInput { fence: RunFence; operationKey: string; inputHash: string }
interface OperationResult { usage: UsageRow; replay: boolean; output: JsonObject | null }
export interface ReservationInput {
  fence: RunFence; operationKey: string; attemptKey: string; inputHash: string; reservedUsd: string; pricing: PricingSnapshot;
  authorizationId: string; keyFingerprint: string; maxOutputTokens: number;
}
export async function lockBudget(tx: PoolClient) { await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('agent-budget-global',0))"); }
export function createBudgetLedger(pool: Pool, modelOptions: { allowedRoutes?: readonly ModelRoute[]; proofRunId?: string } = {}) {
  async function releaseReserved(tx: PoolClient, usage: UsageRow) {
    await tx.query('UPDATE agent_runs SET reserved_usd=reserved_usd-$2 WHERE id=$1', [usage.run_id, usage.reserved_usd]);
    await tx.query('UPDATE agent_budget_authorizations SET reserved_usd=reserved_usd-$2 WHERE id=$1', [usage.authorization_id, usage.reserved_usd]);
    await tx.query("UPDATE agent_budget_days SET reserved_usd=reserved_usd-$3 WHERE day=$1 AND ((scope='deployment' AND scope_key='deployment') OR (scope='workspace' AND scope_key=$2))", [usage.budget_day, usage.workspace_id, usage.reserved_usd]);
    await tx.query("UPDATE agent_run_usage SET state='released',reconciled_at=now() WHERE id=$1", [usage.id]);
  }
  async function releaseUndispatched(filter: { runId: string; usageId?: string; epoch?: number }) {
    return identityTransaction(pool, async (tx) => {
      await lockBudget(tx);
      await loadRun(tx, filter.runId, true);
      const rows = (await tx.query<UsageRow>("SELECT * FROM agent_run_usage WHERE run_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::integer IS NULL OR lease_epoch=$3) AND state='reserved' ORDER BY id FOR UPDATE", [filter.runId, filter.usageId ?? null, filter.epoch ?? null])).rows;
      for (const usage of rows) await releaseReserved(tx, usage);
      if (rows.length) await emitEvent(tx, filter.runId, { kind: 'usage' });
      return rows.length;
    });
  }
  async function runJob<T>(fence: RunFence, effect: (tx: PoolClient, run: RunRow) => Promise<T>) {
    const known = (await pool.query<RunRow>('SELECT * FROM agent_runs WHERE id=$1', [fence.runId])).rows[0];
    if (!known) throw new RunError('access_changed');
    return withWorkspaceAccess(pool, { kind: 'job', userId: known.created_by, authzVersion: known.authz_version }, { workspaceId: known.workspace_id, projectId: known.project_id ?? undefined, scope: known.required_scope, confidential: known.confidential }, async (tx) => {
      await lockBudget(tx);
      const run = await loadRun(tx, fence.runId, true);
      assertFence(run, fence);
      await lockStep(tx, fence);
      return effect(tx, run);
    });
  }
  function validateOperation(input: OperationInput) {
    z.string().regex(/^[a-f0-9]{64}$/).parse(input.inputHash);
    z.string().regex(/^[A-Za-z0-9_-]{1,90}$/).parse(input.operationKey);
  }
  async function operationRows(tx: PoolClient, input: OperationInput) {
    const rows = (await tx.query<UsageRow>('SELECT * FROM agent_run_usage WHERE run_id=$1 AND step_id=$2 AND operation_key=$3 ORDER BY id FOR UPDATE', [input.fence.runId, input.fence.stepId, input.operationKey])).rows;
    if (rows.some((row) => row.input_hash !== input.inputHash)) throw new RunError('conflict');
    return rows;
  }
  async function replayOperation(tx: PoolClient, rows: UsageRow[]): Promise<OperationResult | null> {
    const existing = rows.find((row) => row.state !== 'released');
    if (!existing) return null;
    if (existing.state === 'dispatched' || existing.state === 'ambiguous') throw new RunError('ambiguous_charge');
    if (existing.state === 'succeeded' && existing.actual_usd !== null && exceedsUsd(existing.reserved_usd, existing.actual_usd)) throw new RunError('price_exceeded');
    const output = existing.state === 'succeeded' ? (await tx.query<{ payload: JsonObject }>('SELECT payload FROM agent_model_outputs WHERE usage_id=$1', [existing.id])).rows[0]?.payload ?? null : null;
    if (existing.state === 'succeeded' && !output) throw new RunError('invalid_result');
    return { usage: existing, replay: true, output };
  }
  async function lookupOperation(input: OperationInput) {
    validateOperation(input);
    return runJob(input.fence, async (tx) => replayOperation(tx, await operationRows(tx, input)));
  }
  async function reserve(input: ReservationInput): Promise<OperationResult> {
    validateOperation(input);
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).parse(input.attemptKey);
    return runJob(input.fence, async (tx, run) => {
      const history = await operationRows(tx, input);
      const existing = await replayOperation(tx, history);
      // A successful logical operation survives pricing refreshes and execution epochs.
      if (existing?.usage.state === 'succeeded') return existing;
      UsdSchema.parse(input.reservedUsd);
      const { candidate } = await authorizeModelEndpoint(tx, input.pricing, run, modelOptions);
      const bound = validatePricing(input.pricing, { kind: input.pricing.kind, maxOutputTokens: input.maxOutputTokens, parameters: [], candidateProof: candidate });
      if (exceedsUsd(input.reservedUsd, bound.reservedUsd)) throw new RunError('price_unknown');
      if (existing) {
        if (hash(existing.usage.pricing_snapshot) !== hash(input.pricing)
          || existing.usage.lease_epoch !== input.fence.epoch
          || existing.usage.authorization_id !== input.authorizationId
          || exceedsUsd(existing.usage.reserved_usd, input.reservedUsd)
          || exceedsUsd(input.reservedUsd, existing.usage.reserved_usd)) throw new RunError('conflict');
        return existing;
      }
      if (history.some((row) => row.model !== input.pricing.model || row.endpoint !== input.pricing.endpoint || row.pricing_snapshot.quantization !== input.pricing.quantization || row.pricing_snapshot.kind !== input.pricing.kind)) throw new RunError('conflict');
      const collision = await tx.query('SELECT id FROM agent_run_usage WHERE run_id=$1 AND call_key=$2', [run.id, input.attemptKey]);
      if (collision.rowCount) throw new RunError('conflict');
      if (candidate && run.request_count >= 2) throw new RunError('request_limit');
      if (run.request_count >= RUN_LIMITS.modelRequests) throw new RunError('request_limit');
      const branches = required((await tx.query<{ count: string }>("SELECT count(*) FROM agent_run_usage WHERE run_id=$1 AND state IN ('reserved','dispatched')", [run.id])).rows[0]);
      if (Number(branches.count) >= RUN_LIMITS.concurrentModelBranches) throw new RunError('branch_limit');
      const grant = (await tx.query<AuthorizationRow>('SELECT * FROM agent_budget_authorizations WHERE id=$1 FOR UPDATE', [input.authorizationId])).rows[0];
      if (!grant || grant.state !== 'active' || grant.key_fingerprint !== input.keyFingerprint) throw new RunError('configuration');
      if (exceedsUsd(grant.limit_usd, grant.reserved_usd, grant.spent_usd, input.reservedUsd)) throw new RunError('authorization_budget');
      if (exceedsUsd(run.budget_limit_usd, run.reserved_usd, run.spent_usd, input.reservedUsd)) throw new RunError('run_budget');
      const budgetDay = required((await tx.query<{ day: string }>("SELECT (now() AT TIME ZONE 'UTC')::date::text AS day")).rows[0]).day;
      for (const [scope, scopeKey, limit, failure] of [['deployment', 'deployment', RUN_LIMITS.deploymentDayUsd, 'deployment_budget'], ['workspace', run.workspace_id, RUN_LIMITS.workspaceDayUsd, 'workspace_budget']] as const) {
        const totals = required((await tx.query<Balance>(`SELECT COALESCE(sum(reserved_usd),0)::text AS reserved, COALESCE(sum(spent_usd) FILTER(WHERE day=$3::date),0)::text AS spent FROM agent_budget_days WHERE scope=$1 AND scope_key=$2`, [scope, scopeKey, budgetDay])).rows[0]);
        if (exceedsUsd(limit, totals.reserved, totals.spent, input.reservedUsd)) throw new RunError(failure);
        await tx.query('INSERT INTO agent_budget_days(scope,scope_key,day,reserved_usd) VALUES($1,$2,$3,$4) ON CONFLICT(scope,scope_key,day) DO UPDATE SET reserved_usd=agent_budget_days.reserved_usd+EXCLUDED.reserved_usd', [scope, scopeKey, budgetDay, input.reservedUsd]);
      }
      await tx.query('UPDATE agent_budget_authorizations SET reserved_usd=reserved_usd+$2 WHERE id=$1', [grant.id, input.reservedUsd]);
      await tx.query('UPDATE agent_runs SET reserved_usd=reserved_usd+$2,request_count=request_count+1 WHERE id=$1', [run.id, input.reservedUsd]);
      const usage = required((await tx.query<UsageRow>(`INSERT INTO agent_run_usage(id,run_id,step_id,call_key,input_hash,workspace_id,budget_day,state,model,endpoint,pricing_snapshot,reserved_usd,lease_epoch,authorization_id,operation_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [randomUUID(), run.id, input.fence.stepId, input.attemptKey, input.inputHash, run.workspace_id, budgetDay, input.pricing.model, input.pricing.endpoint, input.pricing, input.reservedUsd, input.fence.epoch, grant.id, input.operationKey])).rows[0]);
      await emitEvent(tx, run.id, { kind: 'usage', stepId: input.fence.stepId });
      return { usage, replay: false, output: null };
    });
  }
  async function dispatch(fence: RunFence, usageId: string) {
    try { return await runJob(fence, async (tx, run) => {
      const pending = (await tx.query<UsageRow>("SELECT * FROM agent_run_usage WHERE id=$1 AND run_id=$2 AND step_id=$3 AND state='reserved' AND lease_epoch=$4 FOR UPDATE", [usageId, fence.runId, fence.stepId, fence.epoch])).rows[0];
      if (!pending) throw new RunError('ambiguous_charge');
      await authorizeModelEndpoint(tx, pending.pricing_snapshot, run, modelOptions);
      validatePricing(pending.pricing_snapshot, { kind: pending.pricing_snapshot.kind, maxOutputTokens: 1, parameters: [], candidateProof: isCandidateProof(run, modelOptions.proofRunId) });
      const grant = (await tx.query<AuthorizationRow>('SELECT * FROM agent_budget_authorizations WHERE id=$1 FOR UPDATE', [pending.authorization_id])).rows[0];
      if (!grant || grant.state !== 'active') throw new RunError('configuration');
      if (exceedsUsd(grant.limit_usd, grant.reserved_usd, grant.spent_usd)) throw new RunError('authorization_budget');
      if (exceedsUsd(run.budget_limit_usd, run.reserved_usd, run.spent_usd)) throw new RunError('run_budget');
      for (const [scope, key, limit, failure] of [['deployment', 'deployment', RUN_LIMITS.deploymentDayUsd, 'deployment_budget'], ['workspace', run.workspace_id, RUN_LIMITS.workspaceDayUsd, 'workspace_budget']] as const) {
        const total = required((await tx.query<Balance>("SELECT COALESCE(sum(reserved_usd),0)::text AS reserved,COALESCE(sum(spent_usd) FILTER(WHERE day=(now() AT TIME ZONE 'UTC')::date),0)::text AS spent FROM agent_budget_days WHERE scope=$1 AND scope_key=$2", [scope, key])).rows[0]);
        if (exceedsUsd(limit, total.reserved, total.spent)) throw new RunError(failure);
      }
      const usage = (await tx.query<UsageRow>("UPDATE agent_run_usage SET state='dispatched',dispatched_at=now() WHERE id=$1 AND run_id=$2 AND step_id=$3 AND state='reserved' AND lease_epoch=$4 RETURNING *", [usageId, fence.runId, fence.stepId, fence.epoch])).rows[0];
      if (!usage) throw new RunError('ambiguous_charge');
      return usage;
    }); } catch (error) {
      await releaseUndispatched({ runId: fence.runId, usageId, epoch: fence.epoch });
      throw error;
    }
  }
  async function settle(usageId: string, result: { state: 'ambiguous' } | { state: 'released'; knownRejected?: boolean } | { state: 'succeeded'; actualUsd: string; inputTokens: number; outputTokens: number; cachedInputTokens?: number; providerRequestId?: string; output?: JsonObject }) {
    if (result.state === 'succeeded') {
      UsdSchema.parse(result.actualUsd);
      z.number().int().nonnegative().parse(result.inputTokens);
      z.number().int().nonnegative().parse(result.outputTokens);
      if (result.cachedInputTokens !== undefined) z.number().int().min(0).max(result.inputTokens).parse(result.cachedInputTokens);
      if (result.providerRequestId !== undefined) z.string().min(1).max(160).parse(result.providerRequestId);
      if (result.output) boundedObject(result.output, 131_072);
    }
    // Provider liabilities must still reconcile after cancellation or access revocation.
    return identityTransaction(pool, async (tx) => {
      await lockBudget(tx);
      const usage = (await tx.query<UsageRow>('SELECT * FROM agent_run_usage WHERE id=$1 FOR UPDATE', [usageId])).rows[0];
      if (!usage) throw new RunError('conflict');
      if (usage.state === 'succeeded' || usage.state === 'released') {
        if (result.state === usage.state && (result.state === 'released' || (result.state === 'succeeded' && usage.actual_usd !== null && !exceedsUsd(result.actualUsd, usage.actual_usd) && !exceedsUsd(usage.actual_usd, result.actualUsd)))) return usage;
        throw new RunError('conflict');
      }
      if (result.state === 'ambiguous') {
        if (usage.state === 'reserved') throw new RunError('conflict');
        return (await tx.query<UsageRow>("UPDATE agent_run_usage SET state='ambiguous' WHERE id=$1 RETURNING *", [usageId])).rows[0];
      }
      if (result.state === 'released' && usage.state !== 'reserved' && !(usage.state === 'dispatched' && result.knownRejected)) throw new RunError('ambiguous_charge');
      if (result.state === 'succeeded' && usage.state === 'reserved') throw new RunError('conflict');
      const actual = result.state === 'succeeded' ? result.actualUsd : '0';
      const overrun = result.state === 'succeeded' && exceedsUsd(usage.reserved_usd, actual);
      await loadRun(tx, usage.run_id, true);
      await tx.query('UPDATE agent_runs SET reserved_usd=reserved_usd-$2,spent_usd=spent_usd+$3 WHERE id=$1', [usage.run_id, usage.reserved_usd, actual]);
      await tx.query('UPDATE agent_budget_authorizations SET reserved_usd=reserved_usd-$2,spent_usd=spent_usd+$3 WHERE id=$1', [usage.authorization_id, usage.reserved_usd, actual]);
      await tx.query("UPDATE agent_budget_days SET reserved_usd=reserved_usd-$3,spent_usd=spent_usd+$4 WHERE day=$1 AND ((scope='deployment' AND scope_key='deployment') OR (scope='workspace' AND scope_key=$2))", [usage.budget_day, usage.workspace_id, usage.reserved_usd, actual]);
      const updated = (await tx.query<UsageRow>(`UPDATE agent_run_usage SET state=$2,actual_usd=$3,input_tokens=$4,output_tokens=$5,cached_input_tokens=$6,provider_request_id=$7,reconciled_at=now() WHERE id=$1 RETURNING *`, [usageId, result.state, result.state === 'succeeded' ? actual : null, result.state === 'succeeded' ? result.inputTokens : null, result.state === 'succeeded' ? result.outputTokens : null, result.state === 'succeeded' ? result.cachedInputTokens ?? null : null, result.state === 'succeeded' ? result.providerRequestId ?? null : null])).rows[0];
      if (overrun) await tx.query("UPDATE agent_model_endpoints SET state='quarantined',quarantine_usage_id=$4,quarantined_at=now(),updated_at=now() WHERE model=$1 AND endpoint=$2 AND kind=$3", [usage.model, usage.endpoint, usage.pricing_snapshot.kind, usage.id]);
      if (result.state === 'succeeded' && result.output && !overrun) await tx.query('INSERT INTO agent_model_outputs(usage_id,payload,output_hash) VALUES($1,$2,$3)', [usage.id, result.output, hash(result.output)]);
      await emitEvent(tx, usage.run_id, { kind: 'usage', stepId: usage.step_id });
      return updated;
    });
  }
  async function recoverExpired(limit = 40) {
    z.number().int().min(1).max(100).parse(limit);
    return identityTransaction(pool, async (tx) => {
      await lockBudget(tx);
      const abandoned = (await tx.query<RunRow>(`SELECT DISTINCT r.* FROM agent_runs r JOIN agent_run_usage u ON u.run_id=r.id
        LEFT JOIN agent_budget_authorizations g ON g.id=u.authorization_id JOIN identity_workspaces w ON w.id=r.workspace_id
        WHERE u.state='reserved' AND (r.state<>'running' OR g.state<>'active' OR r.authz_version<>w.authz_version) ORDER BY r.id LIMIT $1`, [limit])).rows;
      for (const candidate of abandoned.sort((a, b) => a.id < b.id ? -1 : 1)) {
        await loadRun(tx, candidate.id, true);
        const rows = (await tx.query<UsageRow>("SELECT * FROM agent_run_usage WHERE run_id=$1 AND state='reserved' ORDER BY id FOR UPDATE", [candidate.id])).rows;
        for (const usage of rows) await releaseReserved(tx, usage);
        if (rows.length) await emitEvent(tx, candidate.id, { kind: 'usage' });
      }
      const runs = (await tx.query<RunRow>("SELECT * FROM agent_runs WHERE (state='running' AND (lease_until<=now() OR deadline_at<=now())) OR (state='queued' AND deadline_at<=now()) ORDER BY id LIMIT $1 FOR UPDATE", [limit])).rows;
      for (const run of runs) {
        const usage = (await tx.query<UsageRow>("SELECT * FROM agent_run_usage WHERE run_id=$1 AND state IN ('reserved','dispatched') FOR UPDATE", [run.id])).rows;
        for (const item of usage) {
          if (item.state === 'dispatched') { await tx.query("UPDATE agent_run_usage SET state='ambiguous' WHERE id=$1", [item.id]); continue; }
          await releaseReserved(tx, item);
        }
        const ambiguous = await tx.query("SELECT id FROM agent_run_usage WHERE run_id=$1 AND state='ambiguous' LIMIT 1", [run.id]);
        const failure = ambiguous.rowCount ? 'ambiguous_charge' : run.deadline_at && run.deadline_at <= new Date() ? 'run_deadline' : 'lease_lost';
        if (failure === 'lease_lost') {
          await tx.query("UPDATE agent_run_steps SET state='planned',failure_code=NULL,retryable=false,finished_at=NULL WHERE run_id=$1 AND state='claimed'", [run.id]);
          await tx.query("UPDATE agent_runs SET state='queued',failure_code=NULL,lease_owner=NULL,lease_until=NULL,execution_epoch=execution_epoch+1,workflow_state='pending',workflow_run_id=NULL,workflow_dispatched_at=NULL WHERE id=$1", [run.id]);
        } else {
          await tx.query("UPDATE agent_run_steps SET state='failed',failure_code=$2,retryable=false,finished_at=now() WHERE run_id=$1 AND state='claimed'", [run.id, failure]);
          if (failure === 'run_deadline') await tx.query("UPDATE agent_run_steps SET state='skipped',retryable=false,finished_at=now() WHERE run_id=$1 AND state='planned'", [run.id]);
          await tx.query("UPDATE agent_runs SET state='waiting_input',failure_code=$2,lease_owner=NULL,lease_until=NULL,execution_epoch=execution_epoch+1 WHERE id=$1", [run.id, failure]);
        }
        await emitEvent(tx, run.id, { kind: 'run_state', failure });
      }
      return runs.map((run) => run.id);
    });
  }
  return { lookupOperation, reserve, dispatch, settle, releaseUndispatched, recoverExpired };
}
export type BudgetLedger = ReturnType<typeof createBudgetLedger>;
