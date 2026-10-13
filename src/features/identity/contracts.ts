import { z } from 'zod';

export const IdentityLocaleSchema = z.enum(['ru', 'kk', 'en']);
export type IdentityLocale = z.infer<typeof IdentityLocaleSchema>;
export const MembershipRoleSchema = z.enum(['owner', 'editor', 'reviewer']);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;
export const AccessScopeSchema = z.enum(['read', 'edit', 'approve', 'export', 'manage-members', 'read-confidential']);
export type AccessScope = z.infer<typeof AccessScopeSchema>;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const EmailSchema = z.email().max(254).transform((email) => email.toLowerCase());
export const OpaqueTokenSchema = z.string().min(20).max(2048);
export const ReturnFields = {
  returnTo: z.string().max(1024).optional(),
  intentToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
};
export const SignUpSchema = z.strictObject({ name: z.string().trim().min(1).max(120), email: EmailSchema, password: PasswordSchema, locale: IdentityLocaleSchema.default('ru'), ...ReturnFields });
export const SignInSchema = z.strictObject({ email: EmailSchema, password: z.string().min(1).max(128), ...ReturnFields });
export const VerifyEmailSchema = z.strictObject({ token: OpaqueTokenSchema, ...ReturnFields });
export const RequestMailSchema = z.strictObject({ email: EmailSchema, locale: IdentityLocaleSchema.default('ru'), ...ReturnFields });
export const ResetPasswordSchema = z.strictObject({ token: OpaqueTokenSchema, newPassword: PasswordSchema });
export const ChangePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema });
export const ProfileUpdateSchema = z.strictObject({ name: z.string().trim().min(1).max(120).optional(), locale: IdentityLocaleSchema.optional() }).refine((value) => Object.keys(value).length > 0);
export const SaveIntentSchema = z.strictObject({ goal: z.string().trim().min(1).max(12000), returnTo: z.string().max(1024).optional() });
export const RestoreIntentSchema = z.strictObject({ intentToken: z.string().regex(/^[a-f0-9]{64}$/) });
export const IdentityUserSchema = z.strictObject({ id: z.uuid(), name: z.string(), email: EmailSchema, emailVerified: z.boolean(), locale: IdentityLocaleSchema });
export type IdentityUser = z.infer<typeof IdentityUserSchema>;
export const WorkspaceMembershipSchema = z.strictObject({ workspaceId: z.uuid(), name: z.string(), role: MembershipRoleSchema, scopes: z.array(AccessScopeSchema), authzVersion: z.number().int().positive() });
export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;
export const IdentityViewerSchema = z.strictObject({ user: IdentityUserSchema, session: z.strictObject({ id: z.uuid(), expiresAt: z.iso.datetime() }), workspaces: z.array(WorkspaceMembershipSchema) });
export type IdentityViewer = z.infer<typeof IdentityViewerSchema>;
export const IdentitySessionSchema = z.strictObject({ id: z.uuid(), current: z.boolean(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), deviceLabel: z.enum(['desktop', 'mobile', 'unknown']) });
export type IdentitySession = z.infer<typeof IdentitySessionSchema>;
export const IdentityMutationResultSchema = z.strictObject({ status: z.enum(['verification-pending', 'signed-in', 'verified', 'accepted', 'password-reset', 'password-changed', 'signed-out']), returnTo: z.string().optional() });
export type IdentityMutationResult = z.infer<typeof IdentityMutationResultSchema>;
export const ProfileResultSchema = z.strictObject({ user: IdentityUserSchema });
export const SessionsResultSchema = z.strictObject({ sessions: z.array(IdentitySessionSchema) });
export const RevokeSessionResultSchema = z.strictObject({ revoked: z.literal(true) });
export const IntentSavedSchema = z.strictObject({ intentToken: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.iso.datetime() });
export const IntentRestoredSchema = z.strictObject({ goal: z.string(), returnTo: z.string() });
