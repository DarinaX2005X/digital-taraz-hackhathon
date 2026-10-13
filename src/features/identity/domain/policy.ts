import type { AccessScope, MembershipRole } from '../contracts';

const roleScopes: Record<MembershipRole, readonly AccessScope[]> = {
  owner: ['read', 'edit', 'approve', 'export', 'manage-members', 'read-confidential'],
  editor: ['read', 'edit', 'export'],
  reviewer: ['read', 'approve', 'export'],
};

export function scopesForRole(role: MembershipRole): AccessScope[] { return [...roleScopes[role]]; }

export function hasScope(input: { role: MembershipRole; scopes?: readonly AccessScope[]; projectScopes?: readonly AccessScope[]; confidential?: boolean }, scope: AccessScope): boolean {
  const scopes = input.scopes ?? roleScopes[input.role];
  if (!scopes.includes(scope) || (input.confidential && !scopes.includes('read-confidential'))) return false;
  return input.projectScopes === undefined || (input.projectScopes.includes(scope) && (!input.confidential || input.projectScopes.includes('read-confidential')));
}
