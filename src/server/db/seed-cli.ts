import { config } from 'dotenv';
import { getDatabasePool } from './pool';
import { seedDemo } from './seed';

config({ quiet: true });
try {
  const pool = getDatabasePool();
  try {
    const { inserted } = await seedDemo(pool);
    console.log(`Synthetic template definitions added: ${inserted}.`);
  } finally { await pool.end(); }
} catch {
  console.error('Demo catalog seed failed. Run db:migrate and check DATABASE_URL. No data was reset.');
  process.exitCode = 1;
}
