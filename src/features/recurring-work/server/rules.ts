import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { StartWorkOccurrenceInputSchema, StartWorkOccurrenceResultSchema, type StartWorkOccurrenceInput, type StartWorkOccurrenceResult, type WorkExecutionContext, type WorkRuleDefinition } from '../../../contracts/business-work';
import type { SourceRef } from '../../../contracts/artifacts';
import { createArtifactService } from '../../artifacts/server/service';
import { hasScope } from '../../identity/domain/policy';
import { lockProjectAccess, withWorkspaceAccess, type IdentityPrincipal, type SessionPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError } from '../../identity/server/http';
import { assertSourceReadAccess } from '../../sources/server/source-heads';
import {
  CreateWorkRuleSchema,
  ListWorkOccurrencesSchema,
  ListWorkRulesSchema,
  OccurrenceMutationSchema,
  RestartOccurrenceSchema,
  SetWorkRuleStateSchema,
  UpdateWorkRuleSchema,
  WorkOccurrenceListSchema,
  WorkOccurrenceSchema,
  WorkRuleDetailSchema,
  WorkRuleListSchema,
  WorkRuleVersionSchema,
  type WorkOccurrence,
  type WorkRuleDetail,
  type WorkRuleSummary,
  type WorkRuleVersion,
} from '../contracts';
import type { RecurringRunBridge } from './runtime-bridge';

interface RuleRow { id: string; workspace_id: string; project_id: string; owner_id: string; title: string; state: 'enabled' | 'paused' | 'disabled'; current_version: number; created_at: Date; updated_at: Date }
interface RuleVersionRow { id: string; workspace_id: string; rule_id: string; version: number; definition: unknown; reason: string; created_by: string; created_at: Date }
interface OccurrenceRow { id: string; workspace_id: string; project_id: string; rule_id: string; rule_version: number; trigger: unknown; state: WorkOccurrence['state']; run_id: string | null; branch_id: string | null; reason_code: string | null; restarted_from: string | null; created_at: Date; updated_at: Date; completed_at: Date | null }
const ruleColumns = 'id,workspace_id,project_id,owner_id,title,state,current_version,created_at,updated_at';
const versionColumns = 'id,workspace_id,rule_id,version,definition,reason,created_by,created_at';
const occurrenceColumns = 'id,workspace_id,project_id,rule_id,rule_version,trigger,state,run_id,branch_id,reason_code,restarted_from,created_at,updated_at,completed_at';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function rulePermissions(access: WorkspaceAccess, row: RuleRow) {
  const subject = { ...access.membership, projectScopes: access.projectScopes };
  const edit = hasScope(subject, 'edit');
  return { read: true as const, edit, enable: edit && row.owner_id === access.userId, run: hasScope(subject, 'edit') && row.state === 'enabled' };
}
function ruleDto(row: RuleRow, access: WorkspaceAccess): WorkRuleSummary {
  return { id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, ownerId: row.owner_id, title: row.title, state: row.state, currentVersion: row.current_version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), permissions: rulePermissions(access, row) };
}
function versionDto(row: RuleVersionRow): WorkRuleVersion {
  return WorkRuleVersionSchema.parse({ id: row.id, workspaceId: row.workspace_id, ruleId: row.rule_id, version: row.version, definition: row.definition, reason: row.reason, createdBy: row.created_by, createdAt: row.created_at.toISOString() });
}
function occurrenceDto(row: OccurrenceRow): WorkOccurrence {
  return WorkOccurrenceSchema.parse({ id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, ruleId: row.rule_id, ruleVersion: row.rule_version, trigger: row.trigger, state: row.state, runId: row.run_id, branchId: row.branch_id, reasonCode: row.reason_code, restartedFrom: row.restarted_from, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), completedAt: row.completed_at?.toISOString() ?? null });
}
async function replay<T>(tx: PoolClient, workspaceId: string, actorId: string, operationId: string, kind: string, hash: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const saved = (await tx.query<{ kind: string; body_hash: string; result: unknown }>('SELECT kind,body_hash,result FROM business_continuity_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [workspaceId, actorId, operationId])).rows[0];
  if (!saved) return undefined;
  if (saved.kind !== kind || saved.body_hash !== hash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  return schema.parse(saved.result);
}
async function remember(tx: PoolClient, workspaceId: string, actorId: string, operationId: string, kind: string, hash: string, result: unknown) {
  await tx.query('INSERT INTO business_continuity_operations(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [workspaceId, actorId, operationId, kind, hash, JSON.stringify(result)]);
}
async function ruleAccess(tx: PoolClient, workspace: WorkspaceAccess, ruleId: string, scope: 'read' | 'edit', lock = false) {
  const row = (await tx.query<RuleRow>(`SELECT ${ruleColumns} FROM work_rules WHERE workspace_id=$1 AND id=$2 ${lock ? 'FOR UPDATE' : 'FOR SHARE'}`, [workspace.workspace.id, ruleId])).rows[0];
  if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  return { row, access: await lockProjectAccess(tx, workspace, { projectId: row.project_id, scope }) };
}
async function loadVersion(tx: PoolClient, workspaceId: string, ruleId: string, version: number) {
  const row = (await tx.query<RuleVersionRow>(`SELECT ${versionColumns} FROM work_rule_versions WHERE workspace_id=$1 AND rule_id=$2 AND version=$3`, [workspaceId, ruleId, version])).rows[0];
  if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  return versionDto(row);
}

async function validateDefinition(tx: PoolClient, access: WorkspaceAccess, projectId: string, definition: WorkRuleDefinition) {
  if (!(await tx.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [definition.timezone])).rowCount) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
  for (const selector of definition.sourceSelectors) {
    const source = (await tx.query<{ project_id: string }>('SELECT project_id FROM sources WHERE workspace_id=$1 AND id=$2 AND state<>\'trashed\'', [access.workspace.id, selector.sourceId])).rows[0];
    if (!source || source.project_id !== projectId) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
    if (selector.collectionId) {
      const collection = (await tx.query<{ project_id: string }>('SELECT project_id FROM material_collections WHERE workspace_id=$1 AND id=$2', [access.workspace.id, selector.collectionId])).rows[0];
      const mapping = (await tx.query<{ id: string }>('SELECT id FROM material_mapping_versions WHERE workspace_id=$1 AND collection_id=$2 AND id=$3', [access.workspace.id, selector.collectionId, selector.mappingVersionId])).rows[0];
      if (!collection || collection.project_id !== projectId || !mapping) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
    }
  }
  for (const context of definition.contextRefs) {
    const row = (await tx.query<{ project_id: string | null; scope: string }>('SELECT project_id,scope FROM business_contexts WHERE workspace_id=$1 AND id=$2 AND current_revision>=$3 AND status=\'active\'', [access.workspace.id, context.contextId, context.revision])).rows[0];
    const version = await tx.query('SELECT 1 FROM business_context_versions WHERE workspace_id=$1 AND context_id=$2 AND revision=$3', [access.workspace.id, context.contextId, context.revision]);
    if (!row || !version.rowCount || (row.scope === 'project' && row.project_id !== projectId)) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
  }
  const base = definition.outputPolicy.baseArtifact;
  if (base) {
    const artifact = (await tx.query<{ project_id: string }>('SELECT project_id FROM artifacts WHERE workspace_id=$1 AND id=$2 AND status<>\'trashed\'', [access.workspace.id, base.artifactId])).rows[0];
    const version = await tx.query('SELECT 1 FROM artifact_versions WHERE workspace_id=$1 AND artifact_id=$2 AND revision=$3', [access.workspace.id, base.artifactId, base.revision]);
    if (!artifact || artifact.project_id !== projectId || !version.rowCount) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
  }
}

function triggerMatches(definition: WorkRuleDefinition, input: StartWorkOccurrenceInput) {
  if (definition.trigger.kind !== input.trigger.kind) return false;
  if (definition.trigger.kind === 'source-update') return input.trigger.sourceRefs.some((ref) => definition.trigger.kind === 'source-update' && definition.trigger.sourceIds.includes(ref.sourceId));
  return true;
}

async function assessInputs(tx: PoolClient, access: WorkspaceAccess, projectId: string, definition: WorkRuleDefinition, sourceRefs: SourceRef[]): Promise<string | null> {
  const refs = new Map(sourceRefs.map((ref) => [ref.sourceId, ref]));
  const allowed = new Set(definition.sourceSelectors.map((selector) => selector.sourceId));
  if (sourceRefs.some((ref) => !allowed.has(ref.sourceId))) return 'source_not_selected';
  if (definition.sourceSelectors.some((selector) => selector.required && !refs.has(selector.sourceId))) return 'source_missing';
  try { await assertSourceReadAccess(tx, access, sourceRefs); }
  catch (error) { if (error instanceof IdentityError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return 'source_unavailable'; throw error; }
  for (const selector of definition.sourceSelectors) {
    const ref = refs.get(selector.sourceId);
    if (ref) {
      const source = (await tx.query<{ project_id: string; state: string; current_version_id: string | null; current_revision: number }>('SELECT project_id,state,current_version_id,current_revision FROM sources WHERE workspace_id=$1 AND id=$2', [access.workspace.id, selector.sourceId])).rows[0];
      if (!source || source.project_id !== projectId || source.state !== 'ready' || source.current_version_id !== ref.sourceVersionId || source.current_revision !== ref.revision) return 'source_not_current';
    }
    if (selector.collectionId) {
      const latest = (await tx.query<{ id: string }>('SELECT id FROM material_mapping_versions WHERE workspace_id=$1 AND collection_id=$2 ORDER BY revision DESC LIMIT 1', [access.workspace.id, selector.collectionId])).rows[0];
      if (!latest || latest.id !== selector.mappingVersionId) return 'mapping_changed';
    }
  }
  return null;
}

export function createRecurringWorkService(pool: Pool, bridge?: RecurringRunBridge | (() => RecurringRunBridge | undefined)) {
  const artifacts = createArtifactService(pool);
  const runtimeBridge = () => typeof bridge === 'function' ? bridge() : bridge;

  async function list(principal: IdentityPrincipal, input: z.input<typeof ListWorkRulesSchema>) {
    const body = ListWorkRulesSchema.parse(input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'read' }, async (tx, access) => {
      const rows = (await tx.query<RuleRow>(`SELECT ${ruleColumns} FROM work_rules WHERE workspace_id=$1 AND project_id=$2 AND ($3::text IS NULL OR state=$3) ORDER BY updated_at DESC,id DESC LIMIT $4`, [body.workspaceId, body.projectId, body.state ?? null, body.limit])).rows;
      return WorkRuleListSchema.parse({ rules: rows.map((row) => ruleDto(row, access)), authzVersion: access.workspace.authz_version });
    });
  }
  async function read(principal: IdentityPrincipal, workspaceId: string, ruleId: string, version?: number): Promise<WorkRuleDetail> {
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'read' }, async (tx, workspace) => {
      const secured = await ruleAccess(tx, workspace, ruleId, 'read');
      const selected = await loadVersion(tx, workspaceId, ruleId, version ?? secured.row.current_version);
      return WorkRuleDetailSchema.parse({ rule: ruleDto(secured.row, secured.access), version: selected, authzVersion: secured.access.workspace.authz_version });
    });
  }
  async function create(principal: SessionPrincipal, operationId: string, input: z.input<typeof CreateWorkRuleSchema>) {
    const body = CreateWorkRuleSchema.parse(input), hash = digest(body);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const existing = await replay(tx, body.workspaceId, access.userId, operationId, 'rule', hash, WorkRuleDetailSchema); if (existing) return existing;
      await validateDefinition(tx, access, body.projectId, body.definition);
      const id = randomUUID();
      const row = (await tx.query<RuleRow>(`INSERT INTO work_rules(id,workspace_id,project_id,owner_id,title,state,current_version) VALUES($1,$2,$3,$4,$5,$6,1) RETURNING ${ruleColumns}`, [id, body.workspaceId, body.projectId, access.userId, body.title, body.state])).rows[0]!;
      const saved = (await tx.query<RuleVersionRow>(`INSERT INTO work_rule_versions(id,workspace_id,rule_id,version,definition,reason,created_by) VALUES($1,$2,$3,1,$4,$5,$6) RETURNING ${versionColumns}`, [randomUUID(), body.workspaceId, id, JSON.stringify(body.definition), body.reason, access.userId])).rows[0]!;
      const result = WorkRuleDetailSchema.parse({ rule: ruleDto(row, access), version: versionDto(saved), authzVersion: access.workspace.authz_version });
      await remember(tx, body.workspaceId, access.userId, operationId, 'rule', hash, result); return result;
    });
  }
  async function update(principal: SessionPrincipal, operationId: string, ruleId: string, input: z.input<typeof UpdateWorkRuleSchema>) {
    const body = UpdateWorkRuleSchema.parse(input), hash = digest([ruleId, body]);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, workspace) => {
      const existing = await replay(tx, body.workspaceId, workspace.userId, operationId, 'rule', hash, WorkRuleDetailSchema); if (existing) return existing;
      const secured = await ruleAccess(tx, workspace, ruleId, 'edit', true);
      if (secured.row.current_version !== body.expectedVersion || secured.row.state === 'disabled') throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      await validateDefinition(tx, secured.access, secured.row.project_id, body.definition);
      const next = body.expectedVersion + 1;
      const row = (await tx.query<RuleRow>(`UPDATE work_rules SET title=$3,current_version=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${ruleColumns}`, [body.workspaceId, ruleId, body.title, next])).rows[0]!;
      const saved = (await tx.query<RuleVersionRow>(`INSERT INTO work_rule_versions(id,workspace_id,rule_id,version,definition,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${versionColumns}`, [randomUUID(), body.workspaceId, ruleId, next, JSON.stringify(body.definition), body.reason, workspace.userId])).rows[0]!;
      const result = WorkRuleDetailSchema.parse({ rule: ruleDto(row, secured.access), version: versionDto(saved), authzVersion: secured.access.workspace.authz_version });
      await remember(tx, body.workspaceId, workspace.userId, operationId, 'rule', hash, result); return result;
    });
  }
  async function setState(principal: SessionPrincipal, operationId: string, ruleId: string, input: z.input<typeof SetWorkRuleStateSchema>) {
    const body = SetWorkRuleStateSchema.parse(input), hash = digest([ruleId, body]);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, workspace) => {
      const existing = await replay(tx, body.workspaceId, workspace.userId, operationId, 'rule', hash, WorkRuleDetailSchema); if (existing) return existing;
      const secured = await ruleAccess(tx, workspace, ruleId, 'edit', true);
      if (secured.row.current_version !== body.expectedVersion || secured.row.owner_id !== workspace.userId && workspace.membership.role !== 'owner') throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      const definition = await loadVersion(tx, body.workspaceId, ruleId, secured.row.current_version);
      if (body.state === 'enabled') await validateDefinition(tx, secured.access, secured.row.project_id, definition.definition);
      const row = body.state === secured.row.state ? secured.row : (await tx.query<RuleRow>(`UPDATE work_rules SET state=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${ruleColumns}`, [body.workspaceId, ruleId, body.state])).rows[0]!;
      const result = WorkRuleDetailSchema.parse({ rule: ruleDto(row, secured.access), version: definition, authzVersion: secured.access.workspace.authz_version });
      await remember(tx, body.workspaceId, workspace.userId, operationId, 'rule', hash, result); return result;
    });
  }
  async function occurrences(principal: IdentityPrincipal, input: z.input<typeof ListWorkOccurrencesSchema>) {
    const body = ListWorkOccurrencesSchema.parse(input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, workspace) => {
      const secured = await ruleAccess(tx, workspace, body.ruleId, 'read');
      const rows = (await tx.query<OccurrenceRow>(`SELECT ${occurrenceColumns} FROM work_occurrences WHERE workspace_id=$1 AND rule_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3`, [body.workspaceId, body.ruleId, body.limit])).rows;
      return WorkOccurrenceListSchema.parse({ occurrences: rows.map(occurrenceDto), authzVersion: secured.access.workspace.authz_version });
    });
  }

  async function occurrenceSnapshot(principal: IdentityPrincipal, workspaceId: string, occurrenceId: string, scope: 'read' | 'edit' = 'read', expectedAuthzVersion?: number) {
    return withWorkspaceAccess(pool, principal, { workspaceId, scope, ...(expectedAuthzVersion ? { expectedAuthzVersion } : {}) }, async (tx, workspace) => {
      const row = (await tx.query<OccurrenceRow>(`SELECT ${occurrenceColumns} FROM work_occurrences WHERE workspace_id=$1 AND id=$2`, [workspaceId, occurrenceId])).rows[0];
      if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      await lockProjectAccess(tx, workspace, { projectId: row.project_id, scope });
      return occurrenceDto(row);
    });
  }

  async function start(principal: IdentityPrincipal, input: StartWorkOccurrenceInput, restartedFrom: string | null = null): Promise<StartWorkOccurrenceResult> {
    const body = StartWorkOccurrenceInputSchema.parse(input);
    let definition!: WorkRuleDefinition, rule!: RuleRow, occurrence!: WorkOccurrence, authzVersion = 0, pauseReason: string | null = null, reused = false;
    const workspaceId = await inferRuleWorkspace(pool, body.ruleId);
    await withWorkspaceAccess(pool, principal, { workspaceId, scope: 'edit' }, async (tx, workspace) => {
      const secured = await ruleAccess(tx, workspace, body.ruleId, 'edit', true); rule = secured.row; authzVersion = secured.access.workspace.authz_version;
      const saved = await loadVersion(tx, workspaceId, body.ruleId, body.ruleVersion); definition = saved.definition;
      const prior = (await tx.query<OccurrenceRow>(`SELECT ${occurrenceColumns} FROM work_occurrences WHERE rule_id=$1 AND rule_version=$2 AND id=$3 FOR UPDATE`, [body.ruleId, body.ruleVersion, body.occurrenceId])).rows[0];
      if (prior) { occurrence = occurrenceDto(prior); reused = true; return; }
      if (rule.current_version !== body.ruleVersion) pauseReason = 'rule_version_stale';
      else if (rule.state !== 'enabled') pauseReason = 'rule_disabled';
      else if (!triggerMatches(definition, body)) pauseReason = 'trigger_mismatch';
      else {
        const today = (await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM work_occurrences WHERE workspace_id=$1 AND rule_id=$2 AND created_at>=date_trunc('day',now() AT TIME ZONE $3) AT TIME ZONE $3", [workspaceId, body.ruleId, definition.timezone])).rows[0]?.count ?? 0;
        if (today >= definition.budget.maxOccurrencesPerDay) pauseReason = 'daily_limit';
        else pauseReason = await assessInputs(tx, secured.access, rule.project_id, definition, body.trigger.sourceRefs);
      }
      const waiting = pauseReason === 'mapping_changed' || pauseReason === 'source_not_current';
      const state: WorkOccurrence['state'] = pauseReason ? waiting ? 'waiting_input' : 'paused' : 'queued';
      const row = (await tx.query<OccurrenceRow>(`INSERT INTO work_occurrences(id,workspace_id,project_id,rule_id,rule_version,trigger,state,reason_code,restarted_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${occurrenceColumns}`, [body.occurrenceId, workspaceId, rule.project_id, body.ruleId, body.ruleVersion, JSON.stringify(body.trigger), state, pauseReason, restartedFrom])).rows[0]!;
      occurrence = occurrenceDto(row);
    });
    if (occurrence.runId || occurrence.state === 'waiting_input' || occurrence.state === 'cancelled' || occurrence.state === 'completed' || occurrence.state === 'failed' || occurrence.reasonCode && occurrence.reasonCode !== 'runtime_bridge_unavailable') {
      const state = occurrence.state === 'waiting_input' ? 'waiting_input' : occurrence.state === 'queued' || occurrence.state === 'running' || occurrence.state === 'review_ready' ? 'queued' : 'paused';
      const reasonCode = state === 'paused' && !occurrence.reasonCode ? 'occurrence_closed' : occurrence.reasonCode;
      return StartWorkOccurrenceResultSchema.parse({ occurrenceId: occurrence.id, runId: occurrence.runId, branchId: occurrence.branchId, state, reused, ...(reasonCode ? { reasonCode } : {}) });
    }
    const runPrincipal: IdentityPrincipal = { kind: 'job', userId: rule.owner_id, authzVersion };
    let branchId = occurrence.branchId;
    if (!branchId && definition.outputPolicy.baseArtifact) {
      try {
        const base = definition.outputPolicy.baseArtifact;
        const artifact = (await pool.query<{ title: string; current_revision: number; project_id: string }>('SELECT title,current_revision,project_id FROM artifacts WHERE workspace_id=$1 AND id=$2', [workspaceId, base.artifactId])).rows[0];
        if (!artifact || artifact.project_id !== rule.project_id) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
        const branch = await artifacts.branch(runPrincipal, body.occurrenceId, base.artifactId, { workspaceId, expectedAuthzVersion: authzVersion, baseRevision: artifact.current_revision, parentRevision: base.revision, projectId: rule.project_id, title: `${artifact.title} — следующий период` });
        branchId = branch.artifact.id;
        await pool.query('UPDATE work_occurrences SET branch_id=$2,updated_at=now() WHERE id=$1 AND branch_id IS NULL', [body.occurrenceId, branchId]);
      } catch (error) {
        if (!(error instanceof IdentityError) || !['NOT_FOUND', 'FORBIDDEN', 'CONFLICT'].includes(error.code)) throw error;
        await pool.query("UPDATE work_occurrences SET state='paused',reason_code='output_unavailable',updated_at=now() WHERE id=$1", [body.occurrenceId]);
        return { occurrenceId: body.occurrenceId, runId: null, branchId: null, state: 'paused', reused: false, reasonCode: 'output_unavailable' };
      }
    }
    const activeBridge = runtimeBridge();
    if (!activeBridge) {
      await pool.query("UPDATE work_occurrences SET state='paused',reason_code='runtime_bridge_unavailable',branch_id=$2,updated_at=now() WHERE id=$1", [body.occurrenceId, branchId]);
      return { occurrenceId: body.occurrenceId, runId: null, branchId, state: 'paused', reused, reasonCode: 'runtime_bridge_unavailable' };
    }
    const run = await activeBridge.start({ principal: runPrincipal, operationId: body.occurrenceId, workspaceId, projectId: rule.project_id, authzVersion, definition, occurrence: { ...occurrence, branchId }, sourceRefs: body.trigger.sourceRefs, branchId });
    await pool.query('UPDATE work_occurrences SET state=$2,run_id=$3,branch_id=$4,reason_code=$5,updated_at=now() WHERE id=$1', [body.occurrenceId, run.state, run.runId, branchId, run.reasonCode ?? null]);
    return StartWorkOccurrenceResultSchema.parse({ occurrenceId: body.occurrenceId, runId: run.runId, branchId, state: run.state, reused, ...(run.reasonCode ? { reasonCode: run.reasonCode } : {}) });
  }

  async function cancel(principal: SessionPrincipal, operationId: string, occurrenceId: string, input: z.input<typeof OccurrenceMutationSchema>) {
    const body = OccurrenceMutationSchema.parse(input);
    const current = await occurrenceSnapshot(principal, body.workspaceId, occurrenceId, 'edit', body.expectedAuthzVersion);
    if (current.state === 'completed' || current.state === 'failed' || current.state === 'cancelled') return current;
    if (current.runId) {
      const activeBridge = runtimeBridge();
      if (!activeBridge) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      await activeBridge.cancel({ principal, runId: current.runId, workspaceId: body.workspaceId, expectedAuthzVersion: body.expectedAuthzVersion, operationId });
    }
    const row = (await pool.query<OccurrenceRow>(`UPDATE work_occurrences SET state='cancelled',reason_code='cancelled_by_user',completed_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2 AND state NOT IN ('completed','failed','cancelled') RETURNING ${occurrenceColumns}`, [body.workspaceId, occurrenceId])).rows[0];
    return row ? occurrenceDto(row) : occurrenceSnapshot(principal, body.workspaceId, occurrenceId);
  }
  async function restart(principal: SessionPrincipal, input: z.input<typeof RestartOccurrenceSchema>) {
    const body = RestartOccurrenceSchema.parse(input), previous = await occurrenceSnapshot(principal, body.workspaceId, body.occurrenceId, 'edit', body.expectedAuthzVersion);
    const trigger = { ...previous.trigger, at: new Date().toISOString() };
    return start(principal, { ruleId: previous.ruleId, ruleVersion: previous.ruleVersion, occurrenceId: randomUUID(), trigger }, previous.id);
  }
  return { list, read, create, update, setState, occurrences, occurrenceSnapshot, start, cancel, restart };
}

async function inferRuleWorkspace(pool: Pool, ruleId: string) {
  const row = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM work_rules WHERE id=$1', [ruleId])).rows[0];
  if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  return row.workspace_id;
}
export async function startWorkOccurrence(input: StartWorkOccurrenceInput, context: WorkExecutionContext, pool: Pool, bridge?: RecurringRunBridge) {
  const body = StartWorkOccurrenceInputSchema.parse(input);
  if (context.authority.kind !== 'rule' || context.authority.ruleId !== body.ruleId || context.authority.ruleVersion !== body.ruleVersion || context.authority.occurrenceId !== body.occurrenceId) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
  return createRecurringWorkService(pool, bridge).start({ kind: 'job', userId: context.authority.userId, authzVersion: context.expectedAuthzVersion }, body);
}

export type RecurringWorkService = ReturnType<typeof createRecurringWorkService>;
