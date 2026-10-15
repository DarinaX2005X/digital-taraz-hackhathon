import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { RunEventSchema, RunSchema, type Run, type RunAction, type RunFailure, type RunInputRef, type RunPolicy, type RunState, type RunStep, type RunResultRef } from '../../../contracts/runs';
import { RunError } from '../domain/errors';

export type JsonObject = { [key: string]: unknown };
export interface RunRow {
  id: string; workspace_id: string; project_id: string | null; created_by: string; authz_version: number;
  capability_id: string; capability_version: number; required_scope: RunPolicy['scope']; confidential: boolean;
  goal: string; locale: Run['locale']; input_refs: RunInputRef[]; input_hash: string; state: RunState; failure_code: RunFailure | null;
  execution_epoch: number; lease_owner: string | null; lease_until: Date | null; event_sequence: string;
  request_count: number; step_count: number; budget_limit_usd: string; reserved_usd: string; spent_usd: string;
  workflow_run_id: string | null; workflow_state: string; started_at: Date | null; deadline_at: Date | null;
  created_at: Date; updated_at: Date; finished_at: Date | null;
}
export interface StepRow {
  id: string; run_id: string; ordinal: number; action: RunAction; tool_name: string; tool_version: number;
  state: RunStep['state']; attempt: number; execution_epoch: number | null; failure_code: RunFailure | null;
  retryable: boolean; result_refs: RunResultRef[]; input_state: JsonObject; input_hash: string | null;
  started_at: Date | null; finished_at: Date | null;
}
export interface RunFence { runId: string; stepId: string; epoch: number; leaseOwner: string }
export const terminal = (state: RunState) => ['completed', 'failed', 'cancelled'].includes(state);
export const iso = (value: Date | null) => value?.toISOString() ?? null;
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  throw new RunError('invalid_result');
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const hashKey = (value: string) => createHash('sha256').update(value).digest('hex');
export function required<T>(value: T | undefined): T { if (value === undefined) throw new RunError('unavailable'); return value; }
export async function withinSignal<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const failure = () => signal.reason instanceof RunError ? signal.reason : new RunError('step_deadline');
  if (signal.aborted) throw failure();
  let aborted!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => { aborted = () => reject(failure()); signal.addEventListener('abort', aborted, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(action), stopped]); }
  finally { signal.removeEventListener('abort', aborted); }
}
export async function boundedTransaction<T>(transaction: PoolClient, signal: AbortSignal, deadline: number, action: (guarded: PoolClient) => Promise<T>) {
  let active = true;
  const guarded = new Proxy(transaction, { get(target, property) {
    if (property === 'query') return (...args: unknown[]) => {
      if (!active || signal.aborted || Date.now() >= deadline) return Promise.reject(new RunError('step_deadline'));
      return Reflect.apply(target.query, target, args);
    };
    if (property === 'release') return () => { throw new RunError('configuration'); };
    return Reflect.get(target, property, target);
  } });
  try {
    await transaction.query("SELECT set_config('statement_timeout',$1,true)", [`${Math.max(1, Math.min(20_000, deadline - Date.now()))}ms`]);
    return await withinSignal(() => action(guarded), signal);
  } finally { active = false; }
}
export function boundedObject(value: unknown, bytes = 65_536): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new RunError('invalid_result');
  if (Buffer.byteLength(canonical(value)) > bytes) throw new RunError('invalid_result');
  return value as JsonObject;
}
export function requestKey(value: string) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new RunError('conflict', 'VALIDATION_FAILED');
  return hashKey(value);
}
export async function loadRun(transaction: PoolClient, runId: string, lock = false): Promise<RunRow> {
  const row = (await transaction.query<RunRow>(`SELECT * FROM agent_runs WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [runId])).rows[0];
  if (!row) throw new RunError('access_changed', 'NOT_FOUND');
  return row;
}
export function assertFence(run: RunRow, fence: RunFence, now = new Date()) {
  if (run.state !== 'running' || run.execution_epoch !== fence.epoch || run.lease_owner !== fence.leaseOwner || !run.lease_until || run.lease_until <= now) throw new RunError('lease_lost');
  if (!run.deadline_at || run.deadline_at <= now) throw new RunError('run_deadline');
}
export async function lockStep(transaction: PoolClient, fence: RunFence) {
  const step = (await transaction.query<StepRow>('SELECT * FROM agent_run_steps WHERE run_id=$1 AND id=$2 FOR UPDATE', [fence.runId, fence.stepId])).rows[0];
  if (!step || step.state !== 'claimed' || step.execution_epoch !== fence.epoch) throw new RunError('lease_lost');
  return step;
}
export async function emitEvent(transaction: PoolClient, runId: string, detail: { kind: 'run_state' | 'step_state' | 'usage' | 'result'; stepId?: string; stepState?: RunStep['state']; action?: RunAction; failure?: RunFailure; resultRefs?: RunResultRef[] }) {
  const row = required((await transaction.query<{ state: RunState; event_sequence: string }>('UPDATE agent_runs SET event_sequence=event_sequence+1,updated_at=now() WHERE id=$1 RETURNING state,event_sequence', [runId])).rows[0]);
  const event = RunEventSchema.parse({ id: crypto.randomUUID(), runId, sequence: Number(row.event_sequence), at: new Date().toISOString(), state: row.state, ...detail });
  await transaction.query('INSERT INTO agent_run_events(run_id,sequence,id,kind,payload,created_at) VALUES($1,$2,$3,$4,$5,$6)', [runId, event.sequence, event.id, event.kind, event, event.at]);
  return event;
}
export async function snapshot(transaction: PoolClient, run: RunRow): Promise<Run> {
  const steps = (await transaction.query<StepRow>('SELECT * FROM agent_run_steps WHERE run_id=$1 ORDER BY ordinal', [run.id])).rows.map((step) => ({
    id: step.id, runId: step.run_id, ordinal: step.ordinal, action: step.action, state: step.state, toolName: step.tool_name,
    toolVersion: step.tool_version, attempt: step.attempt, failure: step.failure_code, retryable: step.retryable,
    resultRefs: step.result_refs, startedAt: iso(step.started_at), finishedAt: iso(step.finished_at),
  }));
  const canResume = ['waiting_input', 'failed'].includes(run.state) && (!run.deadline_at || run.deadline_at > new Date())
    && (steps.some((step) => step.retryable) || (run.state === 'waiting_input' && run.failure_code === null && steps.some((step) => step.state === 'planned')));
  return RunSchema.parse({
    id: run.id, workspaceId: run.workspace_id, projectId: run.project_id, createdBy: run.created_by,
    capabilityId: run.capability_id, capabilityVersion: run.capability_version, goal: run.goal, locale: run.locale,
    state: run.state, epoch: run.execution_epoch, cursor: Number(run.event_sequence), failure: run.failure_code,
    createdAt: iso(run.created_at), updatedAt: iso(run.updated_at), startedAt: iso(run.started_at), deadlineAt: iso(run.deadline_at),
    budget: { limitUsd: run.budget_limit_usd, reservedUsd: run.reserved_usd, spentUsd: run.spent_usd, requestCount: run.request_count, requestLimit: 12 },
    steps, actions: { cancel: !terminal(run.state), resume: canResume, retryStepIds: canResume ? steps.filter((step) => step.retryable).map((step) => step.id) : [] },
  });
}
