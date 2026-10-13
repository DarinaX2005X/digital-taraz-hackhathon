import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export async function migrateDatabase(pool: Pool, options: { directory?: string } = {}) {
  const directory = options.directory ?? path.join(process.cwd(), 'migrations');
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (names.length === 0) throw new Error('MIGRATIONS_MISSING');
  if (new Set(names.map((name) => name.slice(0, 4))).size !== names.length) throw new Error('MIGRATION_NUMBER_DUPLICATE');
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(directory, name), 'utf8');
    return { name, sql, hash: createHash('sha256').update(sql).digest('hex') };
  }));
  const client = await pool.connect();
  let locked = false;
  let healthy = true;
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended(current_database() || ':tirlik:migrations', 0))");
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS _tirlik_migrations (
      name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const previous = await client.query<{ name: string; hash: string }>('SELECT name, hash FROM _tirlik_migrations ORDER BY name');
    for (let index = 0; index < previous.rows.length; index++) {
      const prior = previous.rows[index]!;
      const migration = migrations[index];
      if (migration?.name !== prior.name || migration.hash !== prior.hash) throw new Error('MIGRATION_HISTORY_MISMATCH');
    }
    for (const migration of migrations.slice(previous.rows.length)) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO _tirlik_migrations(name, hash) VALUES ($1, $2)', [migration.name, migration.hash]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return { applied };
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended(current_database() || ':tirlik:migrations', 0))");
      } catch { healthy = false; }
    }
    client.release(!healthy);
  }
}
