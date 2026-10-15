import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { CreateRunSchema, CancelRunSchema, ResumeRunSchema, RunEventsPageSchema, RunResultRefSchema, RunListCursorSchema, RunListPageSchema, ToolReceiptSchema, type CreateRun, type RunEventsPage, type RunPolicy, type RunState } from '../../../contracts/runs';
import { IdSchema } from '../../../contracts/primitives';
import { identityTransaction, lockProjectAccess, withWorkspaceAccess, withWorkspaceAccessInTransaction, type IdentityPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { hasScope } from '../../identity/domain/policy';
import { IdentityError } from '../../identity/server/http';
import { RunError } from '../domain/errors';
import { RUN_LIMITS } from '../domain/limits';
import { assertFence, boundedObject, boundedTransaction, emitEvent, hash, loadRun, lockStep, requestKey, required, snapshot, terminal, withinSignal, type JsonObject, type RunFence, type RunRow, type StepRow } from './data';
import type { PlannedStep, RunRegistry, RunTool, ToolContext, ToolOutcome } from './registry';
import { createBudgetLedger } from './budget';

export interface Claim { runId: string; epoch: number; leaseOwner: string }
export function createRunService(pool: Pool, registry: RunRegistry) {
  const budget = createBudgetLedger(pool);
  async function peek(runId: string) {
    IdSchema.parse(runId);
    const run = (await pool.query<RunRow>('SELECT * FROM agent_runs WHERE id=$1', [runId])).rows[0];
    if (!run) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    return run;
  }
  function access<T>(principal: IdentityPrincipal, run: RunRow, policy: RunPolicy, effect: (tx: PoolClient, authorized: WorkspaceAccess) => Promise<T>) {
    return withWorkspaceAccess(pool, principal, { workspaceId: run.workspace_id, projectId: run.project_id ?? undefined, scope: policy.scope, confidential: policy.confidential || run.confidential }, effect);
  }
  function job<T>(run: RunRow, policy: RunPolicy, effect: (tx: PoolClient) => Promise<T>) {
    return access({ kind: 'job', userId: run.created_by, authzVersion: run.authz_version }, run, policy, effect);
  }
  async function appendSteps(tx: PoolClient, runId: string, count: number, plans: PlannedStep[]) {
    if (count + plans.length > RUN_LIMITS.steps) throw new RunError('step_limit');
    for (const [index, plan] of plans.entries()) {
      const validated = registry.plan(plan);
      await tx.query('INSERT INTO agent_run_steps(id,run_id,ordinal,action,tool_name,tool_version,input_state,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), runId, count + index + 1, validated.action, validated.tool, validated.version, validated.input, hash(validated.input)]);
    }
    await tx.query('UPDATE agent_runs SET step_count=step_count+$2 WHERE id=$1', [runId, plans.length]);
  }
  async function create(principal: IdentityPrincipal, raw: CreateRun, key: string, options: { trusted?: boolean; privateInput?: JsonObject; confidential?: boolean; transaction?: PoolClient } = {}) {
    const input = CreateRunSchema.parse(raw);
    const capability = registry.capability(input.capabilityId, input.capabilityVersion);
    if (!options.trusted && !capability.publicStart) throw new RunError('access_changed', 'FORBIDDEN');
    if (!options.trusted && (options.privateInput !== undefined || options.confidential !== undefined || options.transaction !== undefined)) throw new RunError('access_changed', 'FORBIDDEN');
    const privateInput = boundedObject(options.privateInput ?? {});
    const requestHash = hash({ input, privateInput, ...(options.confidential ? { trustedConfidential: true } : {}) });
    const keyHash = requestKey(key);
    const request = { workspaceId: input.workspaceId, projectId: input.projectId ?? undefined, ...capability.policy, confidential: capability.policy.confidential || options.confidential === true };
    const effect = async (tx: PoolClient, authorized: WorkspaceAccess) => {
      // Serializes concurrent identical keys without taking a whole-workspace write lock.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-create:${input.workspaceId}:${authorized.userId}:${keyHash}`]);
      const previous = (await tx.query<RunRow>('SELECT * FROM agent_runs WHERE workspace_id=$1 AND created_by=$2 AND request_key_hash=$3', [input.workspaceId, authorized.userId, keyHash])).rows[0];
      if (previous) { if (previous.input_hash !== requestHash) throw new RunError('conflict'); return snapshot(tx, previous); }
      const initial = capability.initialize(input, privateInput);
      const context = boundedObject(initial.context);
      if (!initial.steps.length) throw new RunError('configuration');
      let confidential = capability.policy.confidential || options.confidential === true;
      for (const ref of input.inputRefs) {
        if (!input.projectId) throw new RunError('access_changed', 'NOT_FOUND');
        const row = ref.kind === 'artifact'
          ? (await tx.query<{ access_class: string }>(`SELECT a.access_class FROM artifacts a JOIN artifact_versions v ON v.workspace_id=a.workspace_id AND v.artifact_id=a.id
              WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.id=$3 AND v.revision=$4 AND a.status<>'trashed' FOR SHARE OF a,v`, [input.workspaceId, input.projectId, ref.id, ref.revision])).rows[0]
          : (await tx.query<{ access_class: string }>(`SELECT s.access_class FROM sources s JOIN source_versions v ON v.workspace_id=s.workspace_id AND v.source_id=s.id
              WHERE s.workspace_id=$1 AND s.project_id=$2 AND s.id=$3 AND v.revision=$4 AND s.state='ready' FOR SHARE OF s,v`, [input.workspaceId, input.projectId, ref.id, ref.revision])).rows[0];
        if (!row) throw new RunError('access_changed', 'NOT_FOUND');
        if (row.access_class === 'confidential') confidential = true;
        await lockProjectAccess(tx, authorized, { projectId: input.projectId, scope: 'read', confidential: row.access_class === 'confidential' });
      }
      const runId = randomUUID();
      await tx.query(`INSERT INTO agent_runs(id,workspace_id,project_id,created_by,authz_version,capability_id,capability_version,required_scope,confidential,goal,locale,input_refs,request_key_hash,input_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [runId, input.workspaceId, input.projectId, authorized.userId, authorized.workspace.authz_version, input.capabilityId, input.capabilityVersion, capability.policy.scope, confidential, input.goal, input.locale, JSON.stringify(input.inputRefs), keyHash, requestHash]);
      await tx.query('INSERT INTO agent_run_contexts(run_id,state) VALUES($1,$2)', [runId, context]);
      await appendSteps(tx, runId, 0, initial.steps);
      await tx.query('INSERT INTO agent_queue_workspaces(workspace_id) VALUES($1) ON CONFLICT DO NOTHING', [input.workspaceId]);
      await emitEvent(tx, runId, { kind: 'run_state' });
      return snapshot(tx, await loadRun(tx, runId));
    };
    return options.transaction ? withWorkspaceAccessInTransaction(options.transaction, principal, request, effect) : withWorkspaceAccess(pool, principal, request, effect);
  }
  async function read(principal: IdentityPrincipal, runId: string) {
    const run = await peek(runId);
    return access(principal, run, { scope: 'read', confidential: run.confidential }, async (tx, authorized) => visibleSnapshot(tx, await loadRun(tx, runId), authorized));
  }
  async function visibleSnapshot(tx: PoolClient, run: RunRow, authorized: WorkspaceAccess) {
    const value = await snapshot(tx, run);
    const scoped = run.project_id && authorized.membership.role !== 'owner'
      ? await lockProjectAccess(tx, authorized, { projectId: run.project_id, scope: 'read', confidential: run.confidential }) : authorized;
    if (!hasScope({ ...scoped.membership, projectScopes: scoped.projectScopes, confidential: run.confidential }, run.required_scope)) {
      value.actions = { cancel: false, resume: false, revise: false, retryStepIds: [] };
    }
    return value;
  }
  async function list(principal: IdentityPrincipal, workspaceId: string, before?: string, projectId?: string) {
    IdSchema.parse(workspaceId);
    if (projectId !== undefined) IdSchema.parse(projectId);
    let boundary: { at: string; id: string } | null = null;
    if (before) {
      try { boundary = z.strictObject({ at: z.iso.datetime(), id: IdSchema }).parse(JSON.parse(Buffer.from(RunListCursorSchema.parse(before), 'base64url').toString('utf8'))); }
      catch { throw new RunError('conflict', 'VALIDATION_FAILED'); }
    }
    return withWorkspaceAccess(pool, principal, { workspaceId, projectId, scope: 'read' }, async (tx, authorized) => {
      const rows = (await tx.query<RunRow & { cursor_at: string }>(`SELECT r.*,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM agent_runs r WHERE r.workspace_id=$1 AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2,$6::uuid)) AND ($7::uuid IS NULL OR r.project_id=$7)
        AND (r.project_id IS NULL OR $3='owner' OR EXISTS(SELECT 1 FROM identity_project_grants g WHERE g.workspace_id=r.workspace_id AND g.project_id=r.project_id AND g.user_id=$4 AND 'read'=ANY(g.scopes)))
        AND (NOT r.confidential OR $3='owner' OR ('read-confidential'=ANY($5::text[]) AND (r.project_id IS NULL OR EXISTS(SELECT 1 FROM identity_project_grants g WHERE g.workspace_id=r.workspace_id AND g.project_id=r.project_id AND g.user_id=$4 AND 'read-confidential'=ANY(g.scopes)))))
        ORDER BY r.created_at DESC,r.id DESC LIMIT 31`, [workspaceId, boundary?.at ?? null, authorized.membership.role, authorized.userId, authorized.membership.scopes, boundary?.id ?? null, projectId ?? null])).rows;
      const visible = rows.slice(0, 30);
      const last = visible.at(-1);
      const runs = [];
      for (const row of visible) runs.push(await visibleSnapshot(tx, row, authorized));
      return RunListPageSchema.parse({ runs, nextCursor: rows.length > 30 && last ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id })).toString('base64url') : null });
    });
  }
  async function events(principal: IdentityPrincipal, runId: string, after = 0): Promise<RunEventsPage> {
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(after);
    const run = await peek(runId);
    return access(principal, run, { scope: 'read', confidential: run.confidential }, async (tx) => {
      const current = await loadRun(tx, runId);
      if (after > Number(current.event_sequence)) throw new RunError('conflict');
      const rows = (await tx.query<{ payload: unknown }>('SELECT payload FROM agent_run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101', [runId, after])).rows;
      const visible = rows.slice(0, 100).map((row) => row.payload);
      const page = RunEventsPageSchema.parse({ runId, events: visible, cursor: after, hasMore: rows.length > 100, terminal: terminal(current.state) });
      page.cursor = page.events.at(-1)?.sequence ?? after;
      return page;
    });
  }
  async function mutate(principal: IdentityPrincipal, runId: string, raw: unknown, key: string, kind: 'cancel' | 'resume') {
    const input = kind === 'cancel' ? CancelRunSchema.parse(raw) : ResumeRunSchema.parse(raw);
    const known = await peek(runId);
    const keyHash = requestKey(key);
    const inputHash = hash({ kind, input });
    return access(principal, known, { scope: known.required_scope, confidential: known.confidential }, async (tx) => {
      const run = await loadRun(tx, runId, true);
      if (kind === 'resume') {
        const prior = (await tx.query<{ child_run_id: string; input_hash: string }>('SELECT child_run_id,input_hash FROM agent_run_continuations WHERE parent_run_id=$1 AND created_by=$2 AND request_key_hash=$3', [runId, principal.userId, keyHash])).rows[0];
        if (prior) { if (prior.input_hash !== inputHash) throw new RunError('conflict'); return snapshot(tx, await loadRun(tx, prior.child_run_id)); }
      }
      const operation = (await tx.query<{ input_hash: string; kind: string }>('SELECT input_hash,kind FROM agent_run_operations WHERE run_id=$1 AND actor_id=$2 AND key_hash=$3', [runId, principal.userId, keyHash])).rows[0];
      if (operation) { if (operation.input_hash !== inputHash || operation.kind !== kind) throw new RunError('conflict'); return snapshot(tx, run); }
      if (run.execution_epoch !== input.expectedEpoch) throw new RunError('conflict');
      if (kind === 'resume') {
        const change = ResumeRunSchema.parse(input), capability = registry.capability(run.capability_id, run.capability_version);
        const expired = run.deadline_at !== null && run.deadline_at <= new Date();
        const childNeeded = change.goal !== undefined || change.plan !== undefined || expired || ['completed', 'review_ready'].includes(run.state);
        if (childNeeded && capability.continue) {
          if (run.state === 'cancelled' || run.failure_code === 'access_changed') throw new RunError('conflict');
          const unsafe = await tx.query("SELECT id FROM agent_run_usage WHERE run_id=$1 AND state IN ('reserved','dispatched','ambiguous') LIMIT 1", [runId]);
          if (unsafe.rowCount) throw new RunError('ambiguous_charge');
          if ((await tx.query('SELECT child_run_id FROM agent_run_continuations WHERE parent_run_id=$1', [runId])).rowCount) throw new RunError('conflict');
          const ancestors = (await tx.query<{ depth: number }>(`WITH RECURSIVE chain AS (
            SELECT parent_run_id,1 AS depth FROM agent_run_continuations WHERE child_run_id=$1
            UNION ALL SELECT c.parent_run_id,p.depth+1 FROM agent_run_continuations c JOIN chain p ON c.child_run_id=p.parent_run_id WHERE p.depth<5)
            SELECT COALESCE(MAX(depth),0)::integer AS depth FROM chain`, [runId])).rows[0];
          if ((ancestors?.depth ?? 0) >= 5) throw new RunError('branch_limit');
          const state = required((await tx.query<{ state: JsonObject }>('SELECT state FROM agent_run_contexts WHERE run_id=$1 FOR UPDATE', [runId])).rows[0]).state;
          const nextInput: CreateRun = { workspaceId: run.workspace_id, projectId: run.project_id, capabilityId: run.capability_id, capabilityVersion: run.capability_version, goal: change.goal ?? run.goal, locale: run.locale, inputRefs: run.input_refs };
          const continuation = capability.continue(nextInput, state, change);
          const child = await create(principal, nextInput, `continuation_${keyHash}`, { trusted: true, confidential: run.confidential, privateInput: { continuation: boundedObject(continuation.context) }, transaction: tx });
          if (!terminal(run.state)) {
            await tx.query("UPDATE agent_runs SET state='cancelled',failure_code='cancelled',execution_epoch=execution_epoch+1,lease_owner=NULL,lease_until=NULL,finished_at=now() WHERE id=$1", [runId]);
            await tx.query("UPDATE agent_run_steps SET state='skipped',retryable=false,finished_at=now() WHERE run_id=$1 AND state IN ('planned','claimed')", [runId]);
            await emitEvent(tx, runId, { kind: 'run_state', failure: 'cancelled' });
          }
          await tx.query('INSERT INTO agent_run_continuations(workspace_id,parent_run_id,child_run_id,created_by,request_key_hash,input_hash,reason) VALUES($1,$2,$3,$4,$5,$6,$7)', [run.workspace_id, runId, child.id, principal.userId, keyHash, inputHash, change.goal !== undefined || change.plan !== undefined ? 'goal-change' : expired ? 'deadline' : 'follow-up']);
          return snapshot(tx, await loadRun(tx, child.id));
        }
      }
      if (kind === 'cancel') {
        if (terminal(run.state)) throw new RunError('conflict');
        await tx.query("UPDATE agent_runs SET state='cancelled',failure_code='cancelled',execution_epoch=execution_epoch+1,lease_owner=NULL,lease_until=NULL,finished_at=now() WHERE id=$1", [runId]);
        await tx.query("UPDATE agent_run_steps SET state='skipped',retryable=false,finished_at=now() WHERE run_id=$1 AND state IN ('planned','claimed')", [runId]);
      } else {
        if (!['waiting_input', 'failed'].includes(run.state) || (run.deadline_at && run.deadline_at <= new Date())) throw new RunError('conflict');
        const unsafe = await tx.query("SELECT id FROM agent_run_usage WHERE run_id=$1 AND state IN ('dispatched','ambiguous','reserved') LIMIT 1", [runId]);
        if (unsafe.rowCount) throw new RunError('ambiguous_charge');
        const change = ResumeRunSchema.parse(input);
        if (change.answers !== undefined || (registry.capability(run.capability_id, run.capability_version).continue && run.state === 'waiting_input' && run.failure_code === null)) {
          const capability = registry.capability(run.capability_id, run.capability_version);
          if (!capability.continue || run.state !== 'waiting_input' || run.failure_code !== null || change.stepId) throw new RunError('conflict');
          const stored = required((await tx.query<{ state: JsonObject }>('SELECT state FROM agent_run_contexts WHERE run_id=$1 FOR UPDATE', [runId])).rows[0]);
          const next = capability.continue({ workspaceId: run.workspace_id, projectId: run.project_id, capabilityId: run.capability_id, capabilityVersion: run.capability_version, goal: run.goal, locale: run.locale, inputRefs: run.input_refs }, stored.state, change);
          await tx.query("UPDATE agent_run_steps SET state='skipped',retryable=false,finished_at=now() WHERE run_id=$1 AND state='planned'", [runId]);
          await appendSteps(tx, runId, run.step_count, next.steps);
          await tx.query('UPDATE agent_run_contexts SET state=$2,revision=revision+1,updated_at=now() WHERE run_id=$1', [runId, boundedObject(next.context)]);
        } else {
        const stepId = 'stepId' in input ? input.stepId : undefined;
        const retried = await tx.query("UPDATE agent_run_steps SET state='planned',retryable=false,failure_code=NULL,finished_at=NULL WHERE run_id=$1 AND state='failed' AND retryable=true AND ($2::uuid IS NULL OR id=$2)", [runId, stepId ?? null]);
        if (!retried.rowCount) {
          const continuation = run.state === 'waiting_input' && run.failure_code === null
            ? await tx.query("SELECT id FROM agent_run_steps WHERE run_id=$1 AND state='planned' AND ($2::uuid IS NULL OR id=$2) ORDER BY ordinal LIMIT 1", [runId, stepId ?? null]) : null;
          if (!continuation?.rowCount) throw new RunError('conflict');
        }
        }
        await tx.query("UPDATE agent_runs SET state='queued',failure_code=NULL,execution_epoch=execution_epoch+1,lease_owner=NULL,lease_until=NULL,finished_at=NULL,workflow_state='pending',workflow_run_id=NULL,workflow_dispatched_at=NULL WHERE id=$1", [runId]);
      }
      const changed = await loadRun(tx, runId);
      await tx.query('INSERT INTO agent_run_operations(run_id,actor_id,key_hash,input_hash,kind,result_epoch) VALUES($1,$2,$3,$4,$5,$6)', [runId, principal.userId, keyHash, inputHash, kind, changed.execution_epoch]);
      await emitEvent(tx, runId, { kind: 'run_state', ...(kind === 'cancel' ? { failure: 'cancelled' as const } : {}) });
      return snapshot(tx, await loadRun(tx, runId));
    });
  }
  async function claim(): Promise<Claim | null> {
    return identityTransaction(pool, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('agent-queue',0))");
      const active = required((await tx.query<{ count: string }>("SELECT count(*) FROM agent_runs WHERE state='running' AND lease_until>now()" )).rows[0]);
      if (Number(active.count) >= RUN_LIMITS.deploymentActive) return null;
      const candidate = (await tx.query<RunRow>(`SELECT r.* FROM agent_runs r JOIN agent_queue_workspaces q ON q.workspace_id=r.workspace_id
        WHERE r.state='queued' AND (r.deadline_at IS NULL OR r.deadline_at>now())
        AND (SELECT count(*) FROM agent_runs active WHERE active.workspace_id=r.workspace_id AND active.state='running' AND active.lease_until>now())<$1
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
  async function beginStep(claimed: Claim) {
    const known = await peek(claimed.runId);
    return job(known, { scope: known.required_scope, confidential: known.confidential }, async (tx) => {
      const run = await loadRun(tx, known.id, true);
      assertFence(run, { ...claimed, stepId: '' });
      const busy = await tx.query("SELECT id FROM agent_run_steps WHERE run_id=$1 AND state='claimed' LIMIT 1", [run.id]);
      if (busy.rowCount) throw new RunError('conflict');
      const step = (await tx.query<StepRow>("SELECT * FROM agent_run_steps WHERE run_id=$1 AND state='planned' ORDER BY ordinal LIMIT 1 FOR UPDATE", [run.id])).rows[0];
      if (!step) {
        await tx.query("UPDATE agent_runs SET state='completed',lease_owner=NULL,lease_until=NULL,finished_at=now() WHERE id=$1", [run.id]);
        await emitEvent(tx, run.id, { kind: 'run_state' });
        return null;
      }
      await tx.query("UPDATE agent_run_steps SET state='claimed',attempt=attempt+1,execution_epoch=$2,started_at=now(),finished_at=NULL WHERE id=$1", [step.id, claimed.epoch]);
      await tx.query("UPDATE agent_runs SET lease_until=LEAST(deadline_at,now()+($2 * interval '1 millisecond')) WHERE id=$1", [run.id, RUN_LIMITS.leaseMs]);
      const context = required((await tx.query<{ state: JsonObject; revision: number }>('SELECT state,revision FROM agent_run_contexts WHERE run_id=$1', [run.id])).rows[0]);
      await emitEvent(tx, run.id, { kind: 'step_state', stepId: step.id, stepState: 'claimed', action: step.action });
      return { run, step: { ...step, state: 'claimed' as const, execution_epoch: claimed.epoch, attempt: step.attempt + 1 }, context };
    });
  }
  async function heartbeat(claimed: Claim) {
    const known = await peek(claimed.runId);
    return job(known, { scope: known.required_scope, confidential: known.confidential }, async (tx) => {
      const run = await loadRun(tx, claimed.runId, true);
      assertFence(run, { ...claimed, stepId: '' });
      await tx.query("UPDATE agent_runs SET lease_until=LEAST(deadline_at,now()+($2 * interval '1 millisecond')) WHERE id=$1", [run.id, RUN_LIMITS.leaseMs]);
    });
  }
  async function stopClaim(claimed: Claim, error: unknown) {
    if (error instanceof RunError && ['lease_lost', 'conflict'].includes(error.failure)) return;
    const failure = error instanceof RunError ? error : error instanceof IdentityError ? new RunError('access_changed') : new RunError('unavailable');
    await identityTransaction(pool, async (tx) => {
      const run = await loadRun(tx, claimed.runId, true);
      if (run.execution_epoch !== claimed.epoch || run.state !== 'running' || run.lease_owner !== claimed.leaseOwner) return;
      const step = (await tx.query<StepRow>("SELECT * FROM agent_run_steps WHERE run_id=$1 AND state IN ('planned','claimed') ORDER BY ordinal LIMIT 1 FOR UPDATE", [run.id])).rows[0];
      const unresolved = await tx.query("SELECT id FROM agent_run_usage WHERE run_id=$1 AND state IN ('reserved','dispatched','ambiguous') LIMIT 1", [run.id]);
      if (step) {
        await tx.query("UPDATE agent_run_steps SET state='failed',failure_code=$2,retryable=$3,finished_at=now() WHERE id=$1", [step.id, failure.failure, failure.retryable && !unresolved.rowCount]);
        await emitEvent(tx, run.id, { kind: 'step_state', stepId: step.id, stepState: 'failed', failure: failure.failure });
      }
      await tx.query("UPDATE agent_runs SET state=$2,failure_code=$3,lease_owner=NULL,lease_until=NULL,finished_at=CASE WHEN $2='failed' THEN now() ELSE NULL END WHERE id=$1", [run.id, failure.failure === 'access_changed' ? 'failed' : 'waiting_input', failure.failure]);
      await emitEvent(tx, run.id, { kind: 'run_state', failure: failure.failure });
    });
    await budget.releaseUndispatched({ runId: claimed.runId, epoch: claimed.epoch });
  }
  async function executeStep(claimed: Claim): Promise<'continue' | 'stopped'> {
    let begun: Awaited<ReturnType<typeof beginStep>>;
    let tool: RunTool;
    try {
      begun = await beginStep(claimed);
      if (!begun) return 'stopped';
      tool = registry.tool(begun.step.tool_name, begun.step.tool_version);
    } catch (error) {
      await stopClaim(claimed, error);
      return 'stopped';
    }
    const { run, step, context } = begun;
    const fence = { ...claimed, stepId: step.id };
    const controller = new AbortController();
    const stepDeadline = Date.now() + tool.deadlineMs;
    const timeout = setTimeout(() => controller.abort(new RunError('step_deadline')), tool.deadlineMs);
    let heartbeatPending = false;
    const pulse = setInterval(() => {
      if (heartbeatPending || controller.signal.aborted) return;
      heartbeatPending = true;
      void heartbeat(claimed).catch((error: unknown) => {
        controller.abort(error instanceof RunError ? error : error instanceof IdentityError ? new RunError('access_changed') : new RunError('unavailable'));
      }).finally(() => { heartbeatPending = false; });
    }, 15_000);
    pulse.unref();
    let preparing = true;
    const execution: ToolContext = {
      fence, workspaceId: run.workspace_id, projectId: run.project_id, userId: run.created_by, authzVersion: run.authz_version, context: context.state, signal: controller.signal,
      checkpoint: async (input) => {
        if (!preparing) throw new RunError('configuration');
        const key = `checkpoint_${z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).parse(input.key)}`;
        z.string().regex(/^[a-f0-9]{64}$/).parse(input.inputHash);
        if (controller.signal.aborted) throw new RunError('step_deadline');
        const committed = await job(run, tool.policy, async (tx) => {
          assertFence(await loadRun(tx, run.id, true), fence);
          await lockStep(tx, fence);
          const current = required((await tx.query<{ state: JsonObject; revision: number }>('SELECT state,revision FROM agent_run_contexts WHERE run_id=$1 FOR UPDATE', [run.id])).rows[0]);
          const prior = (await tx.query<{ input_hash: string; result_refs: unknown }>('SELECT input_hash,result_refs FROM agent_tool_receipts WHERE run_id=$1 AND step_id=$2 AND tool_call_id=$3', [run.id, step.id, key])).rows[0];
          if (prior) {
            if (prior.input_hash !== input.inputHash) throw new RunError('conflict');
            return { replay: true, context: current.state, revision: current.revision, resultRefs: z.array(RunResultRefSchema).max(40).parse(prior.result_refs) };
          }
          const count = required((await tx.query<{ count: string }>('SELECT count(*) FROM agent_tool_receipts WHERE run_id=$1 AND step_id=$2', [run.id, step.id])).rows[0]);
          if (Number(count.count) >= 40) throw new RunError('step_limit');
          const result = await boundedTransaction(tx, controller.signal, stepDeadline, (guarded) => input.effect(guarded, current.state));
          if (controller.signal.aborted) throw new RunError('step_deadline');
          const state = boundedObject(result.context);
          const refs = z.array(RunResultRefSchema).max(40).parse(result.resultRefs ?? []);
          await tx.query('UPDATE agent_run_contexts SET state=$2,revision=revision+1,updated_at=now() WHERE run_id=$1', [run.id, state]);
          await tx.query('INSERT INTO agent_tool_receipts(run_id,step_id,tool_call_id,input_hash,output_hash,result_refs) VALUES($1,$2,$3,$4,$5,$6)', [run.id, step.id, key, input.inputHash, hash({ state, refs }), JSON.stringify(refs)]);
          await emitEvent(tx, run.id, { kind: 'result', stepId: step.id, resultRefs: refs });
          return { replay: false, context: state, revision: current.revision + 1, resultRefs: refs };
        });
        context.state = committed.context; context.revision = committed.revision; execution.context = committed.context;
        return { replay: committed.replay, context: committed.context, resultRefs: committed.resultRefs };
      },
    };
    try {
      // Tool-specific authorization happens before preparation, and again in the effect transaction.
      await job(run, tool.policy, async (tx) => { assertFence(await loadRun(tx, run.id), fence); });
      const input = tool.input.parse(step.input_state);
      const prepared = tool.prepare ? await withinSignal(() => tool.prepare!(input, execution), controller.signal) : undefined;
      preparing = false;
      if (controller.signal.aborted) throw new RunError('step_deadline');
      return await job(run, tool.policy, async (tx) => {
        const locked = await loadRun(tx, run.id, true);
        assertFence(locked, fence);
        await lockStep(tx, fence);
        const current = required((await tx.query<{ revision: number }>('SELECT revision FROM agent_run_contexts WHERE run_id=$1 FOR UPDATE', [run.id])).rows[0]);
        if (current.revision !== context.revision) throw new RunError('conflict');
        const callId = `step_${step.id}`;
        const inputHash = hash({ input: step.input_state, contextRevision: context.revision });
        const receipt = (await tx.query<{ input_hash: string }>('SELECT input_hash FROM agent_tool_receipts WHERE run_id=$1 AND step_id=$2 AND tool_call_id=$3', [run.id, step.id, callId])).rows[0];
        if (receipt) { if (receipt.input_hash !== inputHash) throw new RunError('conflict'); return 'continue'; }
        const outcome: ToolOutcome = await boundedTransaction(tx, controller.signal, stepDeadline, (guarded) => tool.execute(guarded, input, prepared, execution));
        if (controller.signal.aborted) throw new RunError('step_deadline');
        const output = tool.output.parse(outcome.output);
        const refs = z.array(RunResultRefSchema).max(40).parse(outcome.resultRefs ?? []);
        const nextContext = boundedObject(outcome.context ?? context.state);
        await appendSteps(tx, run.id, locked.step_count, outcome.nextSteps ?? []);
        await tx.query('UPDATE agent_run_contexts SET state=$2,revision=revision+1,updated_at=now() WHERE run_id=$1', [run.id, nextContext]);
        await tx.query('INSERT INTO agent_tool_receipts(run_id,step_id,tool_call_id,input_hash,output_hash,result_refs) VALUES($1,$2,$3,$4,$5,$6)', [run.id, step.id, callId, inputHash, hash(output), JSON.stringify(refs)]);
        await tx.query("UPDATE agent_run_steps SET state='succeeded',result_refs=$2,finished_at=now(),retryable=false WHERE id=$1", [step.id, JSON.stringify(refs)]);
        if (outcome.state === 'completed' || outcome.state === 'review_ready') {
          const pending = await tx.query("SELECT id FROM agent_run_steps WHERE run_id=$1 AND state IN ('planned','claimed') LIMIT 1", [run.id]);
          if (pending.rowCount) throw new RunError('invalid_result');
        }
        if (outcome.state) await tx.query('UPDATE agent_runs SET state=$2,lease_owner=NULL,lease_until=NULL,finished_at=CASE WHEN $2=\'completed\' THEN now() ELSE NULL END WHERE id=$1', [run.id, outcome.state]);
        await emitEvent(tx, run.id, { kind: 'step_state', stepId: step.id, stepState: 'succeeded', action: step.action, resultRefs: refs });
        if (outcome.state) await emitEvent(tx, run.id, { kind: 'run_state' });
        return outcome.state ? 'stopped' : 'continue';
      });
    } catch (error) {
      await failStep(fence, error);
      return 'stopped';
    } finally { clearTimeout(timeout); clearInterval(pulse); }
  }
  async function failStep(fence: RunFence, error: unknown) {
    const failure = error instanceof RunError ? error : error instanceof IdentityError ? new RunError('access_changed') : new RunError('invalid_result');
    await identityTransaction(pool, async (tx) => {
      const run = await loadRun(tx, fence.runId, true);
      if (run.execution_epoch !== fence.epoch || run.state !== 'running' || run.lease_owner !== fence.leaseOwner) return;
      const unresolved = await tx.query("SELECT id FROM agent_run_usage WHERE run_id=$1 AND step_id=$2 AND state IN ('reserved','dispatched','ambiguous') LIMIT 1", [fence.runId, fence.stepId]);
      const retryable = failure.retryable && !unresolved.rowCount;
      const state: RunState = failure.failure === 'access_changed' ? 'failed' : 'waiting_input';
      await tx.query('UPDATE agent_run_steps SET state=\'failed\',failure_code=$2,retryable=$3,finished_at=now() WHERE id=$1 AND state=\'claimed\'', [fence.stepId, failure.failure, retryable]);
      await tx.query('UPDATE agent_runs SET state=$2,failure_code=$3,lease_owner=NULL,lease_until=NULL,finished_at=CASE WHEN $2=\'failed\' THEN now() ELSE NULL END WHERE id=$1', [fence.runId, state, failure.failure]);
      await emitEvent(tx, run.id, { kind: 'step_state', stepId: fence.stepId, stepState: 'failed', failure: failure.failure });
      await emitEvent(tx, run.id, { kind: 'run_state', failure: failure.failure });
    });
    await budget.releaseUndispatched({ runId: fence.runId, epoch: fence.epoch });
  }
  async function receipt(principal: IdentityPrincipal, runId: string, stepId: string, toolCallId: string) {
    const known = await peek(runId);
    return access(principal, known, { scope: 'read', confidential: known.confidential }, async (tx) => {
      const row = (await tx.query<{ input_hash: string; output_hash: string; result_refs: unknown; committed_at: Date }>('SELECT * FROM agent_tool_receipts WHERE run_id=$1 AND step_id=$2 AND tool_call_id=$3', [runId, IdSchema.parse(stepId), toolCallId])).rows[0];
      return row ? ToolReceiptSchema.parse({ runId, stepId, toolCallId, inputHash: row.input_hash, outputHash: row.output_hash, resultRefs: row.result_refs, committedAt: row.committed_at.toISOString() }) : null;
    });
  }
  return { create, read, list, events, cancel: async (principal: IdentityPrincipal, runId: string, input: unknown, key: string) => { await mutate(principal, runId, input, key, 'cancel'); await budget.releaseUndispatched({ runId }); return read(principal, runId); }, resume: (principal: IdentityPrincipal, runId: string, input: unknown, key: string) => mutate(principal, runId, input, key, 'resume'), claim, beginStep, executeStep, heartbeat, failStep, stopClaim, receipt, peek };
}
export type RunService = ReturnType<typeof createRunService>;
