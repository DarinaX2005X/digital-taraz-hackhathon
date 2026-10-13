import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const demoTemplates = pgTable('demo_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  schemaVersion: integer('schema_version').notNull(),
  definition: jsonb('definition').$type<{ synthetic: true; title: string; description: string }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
