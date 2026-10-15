import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { identityUsers } from './identity-schema';

export const onboardingProgress = pgTable('onboarding_progress', {
  userId: uuid('user_id').notNull().references(() => identityUsers.id, { onDelete: 'cascade' }),
  tourVersion: integer('tour_version').notNull(), revision: integer('revision').notNull().default(1),
  state: text('state').notNull(), completedSteps: text('completed_steps').array().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.tourVersion] })]);
