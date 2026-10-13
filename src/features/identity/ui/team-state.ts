import type { AccessScope, MembershipRole, MemberActions } from "../contracts";
import { ScopeListSchema } from "../contracts";
import { scopesForRole } from "../domain/policy";
import type { IdentityMessageKey } from "../locales";

export const scopeLabels: Record<AccessScope, IdentityMessageKey> = {
  read: "identity.access.scopes.read", edit: "identity.access.scopes.edit",
  approve: "identity.access.scopes.approve", export: "identity.access.scopes.export",
  "manage-members": "identity.access.scopes.manageMembers", "read-confidential": "identity.access.scopes.readConfidential",
};
export const roleLabels: Record<MembershipRole, IdentityMessageKey> = {
  owner: "identity.access.roles.owner", editor: "identity.access.roles.editor", reviewer: "identity.access.roles.reviewer",
};
export type Grant = { role: MembershipRole; scopes: AccessScope[] };
export type GrantOptions = Pick<MemberActions, "roles" | "scopes">;

export function defaultGrant(options: GrantOptions): Grant | undefined {
  const role = options.roles.find((value) => value === "editor") ?? options.roles[0];
  return role ? grantForRole(role, options) : undefined;
}
export function grantForRole(role: MembershipRole, options: GrantOptions): Grant {
  return { role, scopes: scopesForRole(role).filter((scope) => options.scopes.includes(scope)) };
}
export function validGrant(grant: Grant, options: GrantOptions): boolean {
  return options.roles.includes(grant.role) && ScopeListSchema.safeParse(grant.scopes).success
    && grant.scopes.every((scope) => options.scopes.includes(scope))
    && (grant.role !== "owner" || scopesForRole("owner").every((scope) => grant.scopes.includes(scope)));
}
export function scopeChanges(before: readonly AccessScope[], after: readonly AccessScope[]) {
  return { added: after.filter((scope) => !before.includes(scope)), removed: before.filter((scope) => !after.includes(scope)) };
}
