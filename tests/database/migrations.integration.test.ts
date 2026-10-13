import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../src/server/db/migrate';
import { seedDemo } from '../../src/server/db/seed';

let admin: Pool;
let pool: Pool;
let schema: string;
let directory: string;
let expectedMigrations: string[];

beforeEach(async () => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/tirlik') throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
  schema = `test_${randomUUID().replaceAll('-', '')}`;
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
  directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-migration-test-'));
  await cp(path.join(process.cwd(), 'migrations'), directory, { recursive: true });
  expectedMigrations = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
});

afterEach(async () => {
  if (pool) await pool.end();
  if (admin) {
    if (/^test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
  if (directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('tirlik-migration-test-')) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('real PostgreSQL migrations and explicit synthetic seed', () => {
  it('applies once and preserves user-edited values when seeding repeatedly', async () => {
    expect((await migrateDatabase(pool, { directory })).applied).toEqual(expectedMigrations);
    expect((await migrateDatabase(pool, { directory })).applied).toEqual([]);
    expect(await seedDemo(pool)).toEqual({ inserted: 1 });
    const original = await pool.query('SELECT id FROM demo_templates');
    await pool.query("UPDATE demo_templates SET definition = jsonb_set(definition, '{title}', '\"Edited\"')");
    expect(await seedDemo(pool)).toEqual({ inserted: 0 });
    const saved = await pool.query('SELECT id, definition FROM demo_templates');
    expect(saved.rows[0].id).toBe(original.rows[0].id);
    expect(saved.rows[0].definition.title).toBe('Edited');
  });
  it('serializes concurrent migration runners and journals each migration once', async () => {
    const runs = await Promise.all([migrateDatabase(pool, { directory }), migrateDatabase(pool, { directory })]);
    expect(runs.flatMap((run) => run.applied)).toEqual(expectedMigrations);
    expect((await pool.query('SELECT count(*)::int AS count FROM _tirlik_migrations')).rows[0].count).toBe(expectedMigrations.length);
  });
  it('rejects edited applied history instead of silently accepting it', async () => {
    await migrateDatabase(pool, { directory });
    const file = path.join(directory, '0001_demo_templates.sql');
    await writeFile(file, `${await readFile(file, 'utf8')}\n-- changed history\n`);
    await expect(migrateDatabase(pool, { directory })).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
  });
  it('rolls back the whole failed migration and can recover on the next run', async () => {
    await migrateDatabase(pool, { directory });
    const file = path.join(directory, '9999_failure.sql');
    await writeFile(file, 'CREATE TABLE rollback_probe (id int); SELECT * FROM missing_table;');
    await expect(migrateDatabase(pool, { directory })).rejects.toThrow();
    expect((await pool.query("SELECT to_regclass('rollback_probe') AS table_name")).rows[0].table_name).toBeNull();
    await writeFile(file, 'CREATE TABLE rollback_probe (id int);');
    expect((await migrateDatabase(pool, { directory })).applied).toEqual(['9999_failure.sql']);
  });
  it('rejects unlabeled data in the synthetic catalog', async () => {
    await migrateDatabase(pool, { directory });
    await expect(pool.query("INSERT INTO demo_templates(key,schema_version,definition) VALUES ('invalid',1,'{}')")).rejects.toThrow();
  });
  it('bounds synthetic hosting receipts and rejects duplicate workflow IDs', async () => {
    await migrateDatabase(pool, { directory });
    const probeId = randomUUID();
    await pool.query('INSERT INTO preflight_hosting_probes(probe_id, workflow_run_id, start_deployment_id) VALUES ($1,$2,$3)', [probeId, 'synthetic-run', 'synthetic-deployment']);
    await expect(pool.query('UPDATE preflight_hosting_probes SET before_count=2 WHERE probe_id=$1', [probeId])).rejects.toThrow();
    await expect(pool.query("UPDATE preflight_hosting_probes SET state='unknown' WHERE probe_id=$1", [probeId])).rejects.toThrow();
    await expect(pool.query("UPDATE preflight_hosting_probes SET blob_sha256='invalid' WHERE probe_id=$1", [probeId])).rejects.toThrow();
    await expect(pool.query('INSERT INTO preflight_hosting_probes(probe_id, workflow_run_id, start_deployment_id) VALUES ($1,$2,$3)', [randomUUID(), 'synthetic-run', 'synthetic-deployment'])).rejects.toThrow();
  });
});
