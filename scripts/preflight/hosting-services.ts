import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { del, get, head, put } from '@vercel/blob';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { probePath, probePayload, readBoundedBody, sha256 } from '../../src/server/preflight/contracts';

const root = new URL('../../', import.meta.url);
function evidencePath(name: string) {
  assert.match(name, /^hosting-services(?:-attempt-[1-9]\d?)?\.json$/, 'SCOPED_EVIDENCE_NAME_REQUIRED');
  return new URL(`tests/preflight/evidence/${name}`, root);
}
type Evidence = {
  checkedAt: string; probeId: string; syntheticOnly: true; status: 'running' | 'passed' | 'failed';
  checks: Record<string, boolean | string | number>; cleanup: { database: boolean; blob: boolean };
  errorCategory?: string;
};

export async function runHostingServices(connectionString: string, blobToken: string, evidenceName = 'hosting-services.json'): Promise<Evidence> {
  const evidenceFile = evidencePath(evidenceName);
  const target = new URL(connectionString);
  assert.equal(target.protocol, 'postgresql:', 'POSTGRES_PROTOCOL_REQUIRED');
  assert.match(target.hostname, /-pooler\.[a-z0-9-]+\.[a-z0-9-]+\.aws\.neon\.tech$/, 'DEDICATED_POOLED_NEON_REQUIRED');
  assert.ok(['require', 'verify-full'].includes(target.searchParams.get('sslmode') ?? ''), 'POSTGRES_TLS_REQUIRED');
  target.searchParams.set('sslmode', 'verify-full');
  assert.ok(blobToken.length >= 20, 'PRIVATE_BLOB_TOKEN_REQUIRED');
  const probeId = randomUUID();
  const receipt: Evidence = {
    checkedAt: new Date().toISOString(), probeId, syntheticOnly: true, status: 'running',
    checks: {}, cleanup: { database: false, blob: false },
  };
  const reservation = await open(evidenceFile, 'wx');
  await reservation.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
  await reservation.close();
  const makePool = () => new Pool({ connectionString: target.toString(), max: 1, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  let pool = makePool();
  pool.on('error', () => undefined);
  const pathname = probePath(probeId);
  const payload = probePayload(probeId);
  const hash = sha256(payload);
  const blobOptions = () => ({ token: blobToken, abortSignal: AbortSignal.timeout(15000) });
  try {
    const client = await pool.connect();
    try {
      const stream = (client as unknown as { connection: { stream: { encrypted?: boolean; authorized?: boolean } } }).connection.stream;
      assert.equal(stream.encrypted, true, 'DATABASE_CLIENT_TLS_NOT_ACTIVE');
      assert.equal(stream.authorized, true, 'DATABASE_TLS_CERTIFICATE_NOT_AUTHORIZED');
      const tls = await client.query<{ ssl: boolean }>('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
      receipt.checks.databaseClientTlsVerified = true;
      // The pooler's internal backend transport is distinct from our TLS connection.
      receipt.checks.databaseBackendReportsSsl = tls.rows[0]?.ssl === true;
    } finally {
      client.release();
    }
    await pool.query(`
      INSERT INTO preflight_hosting_probes(probe_id, state, start_deployment_id, blob_sha256)
      VALUES ($1, 'failed', 'direct-services-probe', $2)
    `, [probeId, hash]);
    await pool.end();
    pool = makePool();
    pool.on('error', () => undefined);
    const persisted = await pool.query<{ blob_sha256: string; state: string }>(
      'SELECT blob_sha256, state FROM preflight_hosting_probes WHERE probe_id = $1', [probeId],
    );
    assert.equal(persisted.rows[0]?.blob_sha256, hash, 'DATABASE_RECONNECT_MISMATCH');
    assert.equal(persisted.rows[0]?.state, 'failed', 'DATABASE_STATE_MISMATCH');
    receipt.checks.databaseReconnectPersistence = true;
    let duplicateRejected = false;
    try {
      await pool.query("INSERT INTO preflight_hosting_probes(probe_id, start_deployment_id) VALUES ($1, 'direct-services-probe')", [probeId]);
    } catch (error) {
      duplicateRejected = (error as { code?: string }).code === '23505';
    }
    assert.equal(duplicateRejected, true, 'DATABASE_DUPLICATE_NOT_REJECTED');
    receipt.checks.databaseUniqueConstraint = true;
    const uploaded = await put(pathname, payload, {
      ...blobOptions(), access: 'private', addRandomSuffix: false, allowOverwrite: false,
      contentType: 'application/json', cacheControlMaxAge: 60,
    });
    assert.equal(uploaded.pathname, pathname, 'BLOB_PATH_MISMATCH');
    const metadata = await head(pathname, blobOptions());
    assert.equal(metadata.size, payload.length, 'BLOB_SIZE_MISMATCH');
    receipt.checks.privateBlobWrittenBytes = payload.length;
    const read = await get(pathname, { ...blobOptions(), access: 'private', useCache: false });
    assert.ok(read && read.statusCode === 200, 'PRIVATE_BLOB_READ_FAILED');
    assert.equal(sha256(await readBoundedBody(read.stream, 1024)), hash, 'PRIVATE_BLOB_HASH_MISMATCH');
    receipt.checks.privateBlobReadSha256 = hash;
    const anonymous = await fetch(uploaded.url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    void anonymous.body?.cancel().catch(() => undefined);
    assert.ok([401, 403, 404].includes(anonymous.status), 'PRIVATE_BLOB_ANONYMOUS_ACCESS_ALLOWED');
    receipt.checks.anonymousBlobHttpStatus = anonymous.status;
    let overwriteRejected = false;
    try {
      await put(pathname, Buffer.from('different synthetic content'), {
        ...blobOptions(), access: 'private', addRandomSuffix: false, allowOverwrite: false,
      });
    } catch {
      overwriteRejected = true;
    }
    assert.equal(overwriteRejected, true, 'IMMUTABLE_BLOB_OVERWRITE_ALLOWED');
    const unchanged = await get(pathname, { ...blobOptions(), access: 'private', useCache: false });
    assert.ok(unchanged && unchanged.statusCode === 200, 'BLOB_RECHECK_FAILED');
    assert.equal(sha256(await readBoundedBody(unchanged.stream, 1024)), hash, 'BLOB_OVERWRITTEN');
    receipt.checks.privateBlobOverwriteRejected = true;
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    receipt.errorCategory = error instanceof assert.AssertionError ? 'assertion-failed' : 'service-request-failed';
  } finally {
    try {
      await del(pathname, blobOptions());
      const deleted = await get(pathname, { ...blobOptions(), access: 'private', useCache: false });
      assert.equal(deleted, null, 'BLOB_CLEANUP_INCOMPLETE');
      receipt.cleanup.blob = true;
    } catch {
      receipt.status = 'failed';
    }
    try {
      await pool.query("DELETE FROM preflight_hosting_probes WHERE probe_id = $1 AND start_deployment_id = 'direct-services-probe'", [probeId]);
      const remaining = await pool.query('SELECT probe_id FROM preflight_hosting_probes WHERE probe_id = $1', [probeId]);
      assert.equal(remaining.rowCount, 0, 'DATABASE_CLEANUP_INCOMPLETE');
      receipt.cleanup.database = true;
    } catch {
      receipt.status = 'failed';
    }
    await pool.end().catch(() => undefined);
    await writeFile(evidenceFile, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  return receipt;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [execute, flag, name] = process.argv.slice(2);
    assert.ok(execute === '--execute' && (process.argv.length === 3 || (process.argv.length === 5 && flag === '--evidence' && name)), 'EXPLICIT_EXECUTE_REQUIRED');
    const evidenceName = name ?? 'hosting-services.json';
    const env = parse(await readFile(new URL('.vibemachina/runtime/hosting-preview.env', root)));
    const receipt = await runHostingServices(env.DATABASE_URL ?? '', env.BLOB_READ_WRITE_TOKEN ?? '', evidenceName);
    console.log(JSON.stringify({ status: receipt.status, checks: Object.keys(receipt.checks), cleanup: receipt.cleanup, evidence: fileURLToPath(evidencePath(evidenceName)) }));
    if (receipt.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? 'HOSTING_PREFLIGHT_INPUT_REJECTED' : 'HOSTING_PREFLIGHT_FAILED_OR_RECEIPT_ALREADY_EXISTS');
    process.exitCode = 1;
  }
}
