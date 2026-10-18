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
export const RequestMailSchema = z.strictObject({ email: EmailSchema, locale: IdentityLocaleSchema.default('ru'), ...ReturnFields });
export const ResetPasswordSchema = z.strictObject({ token: OpaqueTokenSchema, newPassword: PasswordSchema });
export const ChangePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema });
export const ProfileUpdateSchema = z.strictObject({ name: z.string().trim().min(1).max(120).optional(), locale: IdentityLocaleSchema.optional() }).refine((value) => Object.keys(value).length > 0);
export const SaveIntentSchema = z.strictObject({ goal: z.string().trim().min(1).max(12000), returnTo: z.string().max(1024).optional() });
export const RestoreIntentSchema = z.strictObject({ intentToken: z.string().regex(/^[a-f0-9]{64}$/) });
export const IdentityUserSchema = z.strictObject({ id: z.uuid(), name: z.string(), email: EmailSchema, locale: IdentityLocaleSchema });
export type IdentityUser = z.infer<typeof IdentityUserSchema>;
export const WorkspaceMembershipSchema = z.strictObject({ workspaceId: z.uuid(), name: z.string(), role: MembershipRoleSchema, scopes: z.array(AccessScopeSchema), authzVersion: z.number().int().positive() });
export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;
export const IdentityViewerSchema = z.strictObject({ user: IdentityUserSchema, session: z.strictObject({ id: z.uuid(), expiresAt: z.iso.datetime() }), workspaces: z.array(WorkspaceMembershipSchema) });
export type IdentityViewer = z.infer<typeof IdentityViewerSchema>;
export const IdentitySessionSchema = z.strictObject({ id: z.uuid(), current: z.boolean(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), deviceLabel: z.enum(['desktop', 'mobile', 'unknown']) });
export type IdentitySession = z.infer<typeof IdentitySessionSchema>;
export const IdentityMutationResultSchema = z.strictObject({ status: z.enum(['account-checked', 'signed-in', 'accepted', 'password-reset', 'password-changed', 'signed-out']), returnTo: z.string().optional() });
export type IdentityMutationResult = z.infer<typeof IdentityMutationResultSchema>;
export const ProfileResultSchema = z.strictObject({ user: IdentityUserSchema });
export const SessionsResultSchema = z.strictObject({ sessions: z.array(IdentitySessionSchema) });
export const RevokeSessionResultSchema = z.strictObject({ revoked: z.literal(true) });
export const IntentSavedSchema = z.strictObject({ intentToken: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.iso.datetime() });
export const IntentRestoredSchema = z.strictObject({ goal: z.string(), returnTo: z.string() });

export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DELETION_RETENTION_DAYS = 30;
export const WorkspaceNameSchema = z.string().trim().min(1).max(100);
export const AuthzVersionSchema = z.number().int().positive().max(2147483647);
export const ScopeListSchema = z.array(AccessScopeSchema).min(1).max(6).refine((scopes) => scopes.includes('read') && new Set(scopes).size === scopes.length);
export const InvitationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const grantFields = { role: MembershipRoleSchema, scopes: ScopeListSchema.optional() };
const expectedVersion = { expectedAuthzVersion: AuthzVersionSchema };
export const CreateWorkspaceSchema = z.strictObject({ name: WorkspaceNameSchema });
export const UpdateMemberSchema = z.strictObject({ ...grantFields, ...expectedVersion });
export const RevokeMemberSchema = z.strictObject(expectedVersion);
export const TransferOwnershipSchema = z.strictObject({ targetUserId: z.uuid(), ...expectedVersion });
export const CreateInvitationSchema = z.strictObject({ email: EmailSchema, ...grantFields, locale: IdentityLocaleSchema, ...expectedVersion });
export const InvitationMutationSchema = z.strictObject(expectedVersion);
export const AcceptInvitationSchema = z.strictObject({});
export const WorkspaceSchema = z.strictObject({ id: z.uuid(), name: WorkspaceNameSchema, authzVersion: AuthzVersionSchema, createdAt: z.iso.datetime() });
export type Workspace = z.infer<typeof WorkspaceSchema>;
export const MemberActionsSchema = z.strictObject({ update: z.boolean(), revoke: z.boolean(), transfer: z.boolean(), roles: z.array(MembershipRoleSchema), scopes: z.array(AccessScopeSchema) });
export type MemberActions = z.infer<typeof MemberActionsSchema>;
export const TeamMemberSchema = z.strictObject({ userId: z.uuid(), name: z.string(), email: EmailSchema, role: MembershipRoleSchema, scopes: ScopeListSchema, joinedAt: z.iso.datetime(), allowedActions: MemberActionsSchema });
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export const InvitationDeliverySchema = z.enum(['pending', 'sending', 'sent', 'uncertain']);
export const TeamInvitationSchema = z.strictObject({ id: z.uuid(), email: EmailSchema, role: MembershipRoleSchema, scopes: ScopeListSchema, locale: IdentityLocaleSchema, expiresAt: z.iso.datetime(), status: z.enum(['pending', 'expired']), delivery: InvitationDeliverySchema, allowedActions: z.strictObject({ resend: z.boolean(), revoke: z.boolean() }) });
export type TeamInvitation = z.infer<typeof TeamInvitationSchema>;
export const TeamResultSchema = z.strictObject({ workspace: WorkspaceSchema, actorMembership: WorkspaceMembershipSchema, members: z.array(TeamMemberSchema), invitations: z.array(TeamInvitationSchema), allowedActions: z.strictObject({ invite: z.boolean(), deleteWorkspace: z.boolean(), roles: z.array(MembershipRoleSchema), scopes: z.array(AccessScopeSchema), invitationTtlSeconds: z.literal(INVITATION_TTL_SECONDS) }) });
export type TeamResult = z.infer<typeof TeamResultSchema>;
export const WorkspacesResultSchema = z.strictObject({ workspaces: z.array(WorkspaceMembershipSchema) });
export const WorkspaceResultSchema = z.strictObject({ workspace: WorkspaceMembershipSchema });
export const TeamMutationResultSchema = z.strictObject({ workspaceId: z.uuid(), authzVersion: AuthzVersionSchema });
export const InvitationMutationResultSchema = TeamMutationResultSchema.extend({ invitationId: z.uuid(), delivery: InvitationDeliverySchema });
export const InvitationPreviewSchema = z.strictObject({ status: z.literal('pending'), workspaceName: WorkspaceNameSchema, role: MembershipRoleSchema, scopes: ScopeListSchema, expiresAt: z.iso.datetime() });
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;
export const DeletionWorkspaceSchema = z.strictObject({ workspaceId: z.uuid(), name: WorkspaceNameSchema, authzVersion: AuthzVersionSchema, memberCount: z.number().int().positive(), canLeave: z.boolean(), transferCandidates: z.array(z.strictObject({ userId: z.uuid(), name: z.string(), email: EmailSchema })) });
export const AccountDeletionPreviewSchema = z.strictObject({ ownedWorkspaces: z.array(DeletionWorkspaceSchema), otherWorkspaceCount: z.number().int().nonnegative(), retentionDays: z.literal(DELETION_RETENTION_DAYS) });
export type AccountDeletionPreview = z.infer<typeof AccountDeletionPreviewSchema>;
export const WorkspaceDeletionChoiceSchema = z.discriminatedUnion('action', [
  z.strictObject({ workspaceId: z.uuid(), ...expectedVersion, action: z.literal('leave') }),
  z.strictObject({ workspaceId: z.uuid(), ...expectedVersion, action: z.literal('transfer'), targetUserId: z.uuid() }),
  z.strictObject({ workspaceId: z.uuid(), ...expectedVersion, action: z.literal('delete'), confirmationName: WorkspaceNameSchema }),
]);
export const DeleteAccountSchema = z.strictObject({ password: z.string().min(1).max(128), confirmation: z.literal('DELETE_ACCOUNT'), workspaces: z.array(WorkspaceDeletionChoiceSchema).max(100) }).refine((value) => new Set(value.workspaces.map((workspace) => workspace.workspaceId)).size === value.workspaces.length);
export type DeleteAccount = z.infer<typeof DeleteAccountSchema>;
export const AccountDeletionResultSchema = z.strictObject({ status: z.literal('deletion-requested'), requestId: z.uuid(), requestedAt: z.iso.datetime(), cleanupAfter: z.iso.datetime() });
export type AccountDeletionResult = z.infer<typeof AccountDeletionResultSchema>;
