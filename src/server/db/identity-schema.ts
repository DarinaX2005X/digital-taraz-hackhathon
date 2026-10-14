import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { projects } from './project-schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });
export const identityUsers = pgTable('identity_users', {
  id: uuid('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique('identity_users_email_key'),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'), locale: text('locale').notNull().default('ru'),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
  deletionRequestedAt: instant('deletion_requested_at'),
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

export const identityWorkspaces = pgTable('identity_workspaces', {
  id: uuid('id').primaryKey(), name: text('name').notNull(), authzVersion: integer('authz_version').notNull().default(1),
  status: text('status').notNull().default('active'), createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
  deletionRequestedAt: instant('deletion_requested_at'), cleanupAfter: instant('cleanup_after'),
}, (table) => [
  check('identity_workspaces_name_check', sql`length(${table.name}) BETWEEN 1 AND 100`),
  check('identity_workspaces_authz_version_check', sql`${table.authzVersion} > 0`),
  check('identity_workspaces_status_check', sql`${table.status} IN ('active','deletion-pending')`),
  check('identity_workspaces_check', sql`(${table.status} = 'active' AND ${table.deletionRequestedAt} IS NULL AND ${table.cleanupAfter} IS NULL) OR (${table.status} = 'deletion-pending' AND ${table.deletionRequestedAt} IS NOT NULL AND ${table.cleanupAfter} IS NOT NULL AND ${table.cleanupAfter} >= ${table.deletionRequestedAt})`),
]);
export const identityMemberships = pgTable('identity_memberships', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), userId: uuid('user_id').notNull().references(() => identityUsers.id),
  role: text('role').notNull(), scopes: text('scopes').array().notNull(), state: text('state').notNull().default('active'), revokedAt: instant('revoked_at'),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('identity_memberships_workspace_id_user_id_key').on(table.workspaceId, table.userId), index('identity_memberships_user_idx').on(table.userId, table.state),
  check('identity_memberships_role_check', sql`${table.role} IN ('owner','editor','reviewer')`),
  check('identity_memberships_state_check', sql`${table.state} IN ('active','revoked')`),
  check('identity_memberships_scopes_check', sql`${table.scopes} <@ ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[] AND ${table.scopes} @> ARRAY['read']::text[]`),
  check('identity_memberships_check', sql`${table.role} <> 'owner' OR ${table.scopes} @> ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[]`),
  check('identity_memberships_check1', sql`(${table.state} = 'active' AND ${table.revokedAt} IS NULL) OR (${table.state} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`),
]);
export const identityProjectGrants = pgTable('identity_project_grants', {
  workspaceId: uuid('workspace_id').notNull(), projectId: uuid('project_id').notNull(), userId: uuid('user_id').notNull(), scopes: text('scopes').array().notNull(),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.projectId, table.userId] }),
  foreignKey({ columns: [table.workspaceId, table.userId], foreignColumns: [identityMemberships.workspaceId, identityMemberships.userId] }),
  foreignKey({ name: 'identity_project_grants_project_fk', columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] }),
  check('identity_project_grants_scopes_check', sql`${table.scopes} <@ ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[] AND ${table.scopes} @> ARRAY['read']::text[]`),
]);
export const identityInvitations = pgTable('identity_invitations', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => identityWorkspaces.id), createdBy: uuid('created_by').notNull().references(() => identityUsers.id),
  email: text('email').notNull(), role: text('role').notNull(), scopes: text('scopes').array().notNull(), locale: text('locale').notNull(),
  tokenHash: text('token_hash').notNull().unique(), tokenNonce: uuid('token_nonce').notNull(), expiresAt: instant('expires_at').notNull(), status: text('status').notNull().default('pending'),
  acceptedBy: uuid('accepted_by').references(() => identityUsers.id), acceptedAt: instant('accepted_at'),
  deliveryState: text('delivery_state').notNull().default('pending'), deliveryId: uuid('delivery_id').notNull(), sendEpoch: integer('send_epoch').notNull().default(0), sendLeaseUntil: instant('send_lease_until'),
  createdAt: instant('created_at').notNull().defaultNow(), updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('identity_invitations_pending_key').on(table.workspaceId, table.email).where(sql`${table.status} = 'pending'`),
  index('identity_invitations_expiry_idx').on(table.expiresAt).where(sql`${table.status} = 'pending'`),
  check('identity_invitations_email_check', sql`${table.email} = lower(${table.email}) AND length(${table.email}) <= 254`),
  check('identity_invitations_role_check', sql`${table.role} IN ('owner','editor','reviewer')`),
  check('identity_invitations_locale_check', sql`${table.locale} IN ('ru','kk','en')`),
  check('identity_invitations_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check('identity_invitations_status_check', sql`${table.status} IN ('pending','accepted','revoked')`),
  check('identity_invitations_delivery_state_check', sql`${table.deliveryState} IN ('pending','sending','sent','uncertain')`),
  check('identity_invitations_send_epoch_check', sql`${table.sendEpoch} >= 0`),
  check('identity_invitations_scopes_check', sql`${table.scopes} <@ ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[] AND ${table.scopes} @> ARRAY['read']::text[]`),
  check('identity_invitations_check', sql`${table.role} <> 'owner' OR ${table.scopes} @> ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[]`),
  check('identity_invitations_check1', sql`(${table.status} = 'accepted' AND ${table.acceptedBy} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL) OR (${table.status} <> 'accepted' AND ${table.acceptedBy} IS NULL AND ${table.acceptedAt} IS NULL)`),
]);
export const identityOperations = pgTable('identity_operations', {
  keyHash: text('key_hash').primaryKey(), actorId: uuid('actor_id').notNull().references(() => identityUsers.id), workspaceId: uuid('workspace_id').references(() => identityWorkspaces.id),
  kind: text('kind').notNull(), bodyHash: text('body_hash').notNull(), result: jsonb('result').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(), expiresAt: instant('expires_at').notNull(),
}, (table) => [index('identity_operations_expiry_idx').on(table.expiresAt), check('identity_operations_key_hash_check', sql`${table.keyHash} ~ '^[a-f0-9]{64}$'`), check('identity_operations_body_hash_check', sql`${table.bodyHash} ~ '^[a-f0-9]{64}$'`)]);
export const identityDeletionRequests = pgTable('identity_deletion_requests', {
  id: uuid('id').primaryKey(), userId: uuid('user_id').notNull().unique().references(() => identityUsers.id), requestedAt: instant('requested_at').notNull().defaultNow(), cleanupAfter: instant('cleanup_after').notNull(),
}, (table) => [index('identity_deletion_requests_cleanup_idx').on(table.cleanupAfter), check('identity_deletion_requests_check', sql`${table.cleanupAfter} >= ${table.requestedAt}`)]);
