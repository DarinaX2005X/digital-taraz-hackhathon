import { getDatabasePool } from '@/server/db/pool';
import { PreflightError } from './contracts';

export interface ProbeRow {
  probe_id: string;
  workflow_run_id: string | null;
  state: 'starting' | 'waiting' | 'completed' | 'failed';
  start_deployment_id: string;
  resume_deployment_id: string | null;
  before_count: number;
  after_count: number;
  blob_path: string | null;
  blob_sha256: string | null;
}

export async function readProbe(probeId: string): Promise<ProbeRow | null> {
  const result = await getDatabasePool().query<ProbeRow>(
    'SELECT * FROM preflight_hosting_probes WHERE probe_id = $1', [probeId],
  );
  return result.rows[0] ?? null;
}

export async function admitProbe(probeId: string, deploymentId: string): Promise<{ created: boolean; row: ProbeRow }> {
  const client = await getDatabasePool().connect();
  try {
    await client.query('BEGIN');
    // Transaction-scoped locks work with Neon's transaction-pooling endpoint.
    await client.query('SELECT pg_advisory_xact_lock(1727062740)');
    const existing = await client.query<ProbeRow>('SELECT * FROM preflight_hosting_probes WHERE probe_id = $1', [probeId]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { created: false, row: existing.rows[0] };
    }
    const counts = await client.query<{ recent: number; active: number }>(`
      SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::integer AS recent,
        count(*) FILTER (WHERE state IN ('starting', 'waiting'))::integer AS active
      FROM preflight_hosting_probes
    `);
    const count = counts.rows[0];
    if (!count) throw new PreflightError('UNAVAILABLE');
    if (count.recent >= 5 || count.active >= 2) throw new PreflightError('RATE_LIMITED', true);
    const inserted = await client.query<ProbeRow>(`
      INSERT INTO preflight_hosting_probes(probe_id, start_deployment_id)
      VALUES ($1, $2) RETURNING *
    `, [probeId, deploymentId]);
    const row = inserted.rows[0];
    if (!row) throw new PreflightError('UNAVAILABLE');
    await client.query('COMMIT');
    return { created: true, row };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function associateRun(probeId: string, runId: string): Promise<void> {
  const result = await getDatabasePool().query(`
    UPDATE preflight_hosting_probes SET workflow_run_id = $2, updated_at = now()
    WHERE probe_id = $1 AND (workflow_run_id IS NULL OR workflow_run_id = $2)
  `, [probeId, runId]);
  if (result.rowCount !== 1) throw new PreflightError('CONFLICT');
}

export async function claimResume(probeId: string, deploymentId: string): Promise<boolean> {
  const result = await getDatabasePool().query(`
    UPDATE preflight_hosting_probes SET resume_deployment_id = $2, updated_at = now()
    WHERE probe_id = $1 AND state = 'waiting' AND before_count = 1
      AND workflow_run_id IS NOT NULL AND resume_deployment_id IS NULL
  `, [probeId, deploymentId]);
  return result.rowCount === 1;
}

export async function recordBefore(probeId: string, runId: string, pathname: string, hash: string): Promise<void> {
  const result = await getDatabasePool().query(`
    UPDATE preflight_hosting_probes SET state = 'waiting', before_count = 1,
      workflow_run_id = $2, blob_path = $3, blob_sha256 = $4, updated_at = now()
    WHERE probe_id = $1 AND state IN ('starting', 'waiting')
      AND (workflow_run_id IS NULL OR workflow_run_id = $2)
      AND (blob_sha256 IS NULL OR blob_sha256 = $4)
  `, [probeId, runId, pathname, hash]);
  if (result.rowCount !== 1) throw new PreflightError('CONFLICT');
}

export async function recordAfter(probeId: string, deploymentId: string, hash: string): Promise<void> {
  const result = await getDatabasePool().query(`
    UPDATE preflight_hosting_probes SET state = 'completed', after_count = 1, updated_at = now()
    WHERE probe_id = $1 AND state IN ('waiting', 'completed') AND before_count = 1
      AND resume_deployment_id = $2 AND blob_sha256 = $3
  `, [probeId, deploymentId, hash]);
  if (result.rowCount !== 1) throw new PreflightError('CONFLICT');
}

export async function markProbeCleaned(probeId: string, failed: boolean): Promise<void> {
  const result = await getDatabasePool().query(`
    UPDATE preflight_hosting_probes SET blob_path = NULL,
      state = CASE WHEN $2::boolean THEN 'failed' ELSE state END, updated_at = now()
    WHERE probe_id = $1
  `, [probeId, failed]);
  if (result.rowCount !== 1) throw new PreflightError('CONFLICT');
}
