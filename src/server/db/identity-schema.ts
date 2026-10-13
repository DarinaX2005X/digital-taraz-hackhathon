import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const instant = (name: string) => timestamp(name, { withTimezone: true });
export const identityUsers = pgTable('identity_users', {
  id: uuid('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique('identity_users_email_key'),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'), locale: text('locale').notNull().default('ru'),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  check('identity_users_name_check', sql`length(${table.name}) BETWEEN 1 AND 120`),
  check('identity_users_locale_check', sql`${table.locale} IN ('ru','kk','en')`),
  check('identity_users_email_check', sql`${table.email} = lower(${table.email}) AND length(${table.email}) <= 254`),
]);
export const identitySessions = pgTable('identity_sessions', {
  id: uuid('id').primaryKey(), userId: uuid('user_id').notNull().references(() => identityUsers.id, { onDelete: 'cascade' }), token: text('token').notNull().unique('identity_sessions_token_key'),
  expiresAt: instant('expires_at').notNull(), ipAddress: text('ip_address'), userAgent: text('user_agent'),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [index('identity_sessions_user_idx').on(table.userId)]);
export const identityAccounts = pgTable('identity_accounts', {
  id: uuid('id').primaryKey(), userId: uuid('user_id').notNull().references(() => identityUsers.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(), password: text('password'),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'), scope: text('scope'),
  accessTokenExpiresAt: instant('access_token_expires_at'), refreshTokenExpiresAt: instant('refresh_token_expires_at'),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [index('identity_accounts_user_idx').on(table.userId), unique('identity_accounts_provider_id_account_id_key').on(table.providerId, table.accountId)]);
export const identityVerifications = pgTable('identity_verifications', {
  id: uuid('id').primaryKey(), identifier: text('identifier').notNull().unique('identity_verifications_identifier_key'), value: text('value').notNull(), expiresAt: instant('expires_at').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
});
export const identityEmailTokens = pgTable('identity_email_tokens', {
  tokenHash: text('token_hash').primaryKey(), userId: uuid('user_id').notNull(),
  expiresAt: instant('expires_at').notNull(), consumedAt: instant('consumed_at'),
}, (table) => [index('identity_email_tokens_expiry_idx').on(table.expiresAt), check('identity_email_tokens_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`)]);
export const identityIntents = pgTable('identity_intents', {
  tokenHash: text('token_hash').primaryKey(), browserHash: text('browser_hash').notNull(), goal: text('goal').notNull(), returnTo: text('return_to').notNull(),
  idempotencyHash: text('idempotency_hash').notNull().unique('identity_intents_idempotency_hash_key'), bodyHash: text('body_hash').notNull(),
  claimedBy: uuid('claimed_by').references(() => identityUsers.id, { onDelete: 'cascade' }), expiresAt: instant('expires_at').notNull(), createdAt: instant('created_at').defaultNow().notNull(),
}, (table) => [index('identity_intents_expiry_idx').on(table.expiresAt), check('identity_intents_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`), check('identity_intents_goal_check', sql`length(${table.goal}) BETWEEN 1 AND 12000`)]);
export const identityRateLimits = pgTable('identity_rate_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: instant('expires_at').notNull(),
}, (table) => [index('identity_rate_limits_expiry_idx').on(table.expiresAt)]);
