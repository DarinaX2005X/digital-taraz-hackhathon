import type { Pool } from 'pg';

export async function seedDemo(pool: Pool) {
  // A catalog definition only: no personal workspace, user, or business records are created on startup.
  const definition = { synthetic: true, title: 'Tirlik', description: 'Synthetic training materials; not a real business.' };
  const result = await pool.query<{ id: string }>(
    `INSERT INTO demo_templates(key, schema_version, definition) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO NOTHING RETURNING id`,
    ['tirlik-training', 1, definition],
  );
  return { inserted: result.rowCount ?? 0 };
}
