import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const demoTemplates = pgTable('demo_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique('demo_templates_key_key'),
  schemaVersion: integer('schema_version').notNull(),
  definition: jsonb('definition').$type<{ synthetic: true; title: string; description: string }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('demo_templates_schema_version_check', sql`${table.schemaVersion} > 0`),
  check('demo_templates_definition_check', sql`(${table.definition}->>'synthetic' = 'true') IS TRUE`),
]);
