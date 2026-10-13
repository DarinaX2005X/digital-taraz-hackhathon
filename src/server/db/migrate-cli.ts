import { config } from 'dotenv';
import { getDatabasePool } from './pool';
import { migrateDatabase } from './migrate';

config({ quiet: true });
try {
  const pool = getDatabasePool();
  try {
    const { applied } = await migrateDatabase(pool);
    console.log(`Database ready. Applied migrations: ${applied.length}.`);
  } finally { await pool.end(); }
} catch {
  console.error('Database migration failed. Check DATABASE_URL and migration history. No data was reset.');
  process.exitCode = 1;
}
