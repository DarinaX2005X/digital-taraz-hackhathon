import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { assertSourceReadAccess } from '../../sources/server/source-heads';
import { withWorkspaceAccess, type IdentityPrincipal, type SessionPrincipal } from '../../identity/server/access';
import { IdentityError } from '../../identity/server/http';
import {
  CreateOutcomeObservationSchema,
  ListOutcomesSchema,
  OutcomeListSchema,
  OutcomeObservationSchema,
  type OutcomeObservation,
} from '../contracts';

interface OutcomeRow {
  id: string; workspace_id: string; project_id: string; occurrence_id: string | null; run_id: string | null; artifact_id: string | null;
  artifact_revision: number | null; period_start: string | Date; period_end: string | Date; metric_key: string; label: string; value: unknown;
  evidence: unknown; note: string; recorded_by: string; created_at: Date;
}
const columns = 'id,workspace_id,project_id,occurrence_id,run_id,artifact_id,artifact_revision,period_start,period_end,metric_key,label,value,evidence,note,recorded_by,created_at';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = (value: string | Date) => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
function dto(row: OutcomeRow): OutcomeObservation {
  return OutcomeObservationSchema.parse({ id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, occurrenceId: row.occurrence_id, runId: row.run_id, artifactId: row.artifact_id, artifactRevision: row.artifact_revision, periodStart: date(row.period_start), periodEnd: date(row.period_end), metricKey: row.metric_key, label: row.label, value: row.value, evidence: row.evidence, note: row.note, recordedBy: row.recorded_by, createdAt: row.created_at.toISOString() });
}
async function replay(tx: PoolClient, workspaceId: string, actorId: string, operationId: string, hash: string): Promise<OutcomeObservation | undefined> {
  const saved = (await tx.query<{ kind: string; body_hash: string; result: unknown }>('SELECT kind,body_hash,result FROM business_continuity_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [workspaceId, actorId, operationId])).rows[0];
  if (!saved) return undefined;
  if (saved.kind !== 'outcome' || saved.body_hash !== hash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  return OutcomeObservationSchema.parse(saved.result);
}

export function createOutcomeService(pool: Pool) {
  async function list(principal: IdentityPrincipal, input: z.input<typeof ListOutcomesSchema>) {
    const body = ListOutcomesSchema.parse(input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'read' }, async (tx, access) => {
      const rows = (await tx.query<OutcomeRow>(`SELECT ${columns} FROM outcome_observations WHERE workspace_id=$1 AND project_id=$2 ORDER BY period_end DESC,created_at DESC,id DESC LIMIT $3`, [body.workspaceId, body.projectId, body.limit])).rows;
      return OutcomeListSchema.parse({ outcomes: rows.map(dto), authzVersion: access.workspace.authz_version });
    });
  }
  async function create(principal: SessionPrincipal, operationId: string, input: z.input<typeof CreateOutcomeObservationSchema>) {
    const body = CreateOutcomeObservationSchema.parse(input), hash = digest(body);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const existing = await replay(tx, body.workspaceId, access.userId, operationId, hash); if (existing) return existing;
      if (body.occurrenceId) {
        const occurrence = (await tx.query<{ project_id: string }>('SELECT project_id FROM work_occurrences WHERE workspace_id=$1 AND id=$2', [body.workspaceId, body.occurrenceId])).rows[0];
        if (!occurrence || occurrence.project_id !== body.projectId) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
      }
      if (body.runId) {
        const run = (await tx.query<{ project_id: string | null }>('SELECT project_id FROM agent_runs WHERE workspace_id=$1 AND id=$2', [body.workspaceId, body.runId])).rows[0];
        if (!run || run.project_id !== body.projectId) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
      }
      if (body.artifactId !== null && body.artifactRevision !== null) {
        const version = await tx.query('SELECT 1 FROM artifact_versions WHERE workspace_id=$1 AND project_id=$2 AND artifact_id=$3 AND revision=$4', [body.workspaceId, body.projectId, body.artifactId, body.artifactRevision]);
        if (!version.rowCount) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
      }
      await assertSourceReadAccess(tx, access, body.evidence.sourceRefs);
      const id = randomUUID();
      const row = (await tx.query<OutcomeRow>(`INSERT INTO outcome_observations(id,workspace_id,project_id,occurrence_id,run_id,artifact_id,artifact_revision,period_start,period_end,metric_key,label,value,evidence,note,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${columns}`,
      [id, body.workspaceId, body.projectId, body.occurrenceId, body.runId, body.artifactId, body.artifactRevision, body.periodStart, body.periodEnd, body.metricKey, body.label, JSON.stringify(body.value), JSON.stringify(body.evidence), body.note, access.userId])).rows[0]!;
      if (body.artifactId !== null && body.artifactRevision !== null) await tx.query("INSERT INTO artifact_version_pins(id,workspace_id,artifact_id,revision,kind,retainer_id) VALUES($1,$2,$3,$4,'retained',$5)", [randomUUID(), body.workspaceId, body.artifactId, body.artifactRevision, id]);
      const result = dto(row);
      await tx.query("INSERT INTO business_continuity_operations(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,'outcome',$4,$5)", [body.workspaceId, access.userId, operationId, hash, JSON.stringify(result)]);
      return result;
    });
  }
  return { list, create };
}
export type OutcomeService = ReturnType<typeof createOutcomeService>;
