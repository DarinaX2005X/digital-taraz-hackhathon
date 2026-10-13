import { Pool } from 'pg';

let pool: Pool | undefined;

export function getDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    pool.on('error', () => console.error('DATABASE_IDLE_CONNECTION_ERROR'));
  }
  return pool;
}
