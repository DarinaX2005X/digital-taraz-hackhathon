import type { AccessScope, MemberActions, MembershipRole } from '../contracts';

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

export interface MembershipGrant { role: MembershipRole; scopes: readonly AccessScope[] }
export function normalizedGrant(role: MembershipRole, requested?: readonly AccessScope[]): AccessScope[] | undefined {
  const scopes = requested ? [...requested] : scopesForRole(role);
  if (!scopes.includes('read') || new Set(scopes).size !== scopes.length || scopes.some((scope) => !roleScopes.owner.includes(scope))) return undefined;
  if (role === 'owner' && roleScopes.owner.some((scope) => !scopes.includes(scope))) return undefined;
  return roleScopes.owner.filter((scope) => scopes.includes(scope));
}
export function canGrant(actor: MembershipGrant, grant: MembershipGrant): boolean {
  return actor.role === 'owner' || (actor.scopes.includes('manage-members') && grant.role !== 'owner' && grant.scopes.every((scope) => actor.scopes.includes(scope)));
}
export function memberActions(actor: MembershipGrant & { userId: string }, target: MembershipGrant & { userId: string }, ownerCount: number): MemberActions {
  const manager = actor.role === 'owner' || actor.scopes.includes('manage-members');
  const controlsTarget = manager && (actor.role === 'owner' || target.role !== 'owner');
  const lastOwner = target.role === 'owner' && ownerCount === 1;
  return {
    update: controlsTarget,
    revoke: !lastOwner && (controlsTarget || actor.userId === target.userId),
    transfer: actor.role === 'owner' && actor.userId !== target.userId && target.role !== 'owner',
    roles: !controlsTarget ? [] : lastOwner ? ['owner'] : actor.role === 'owner' ? ['owner', 'editor', 'reviewer'] : ['editor', 'reviewer'],
    scopes: !controlsTarget ? [] : actor.role === 'owner' ? scopesForRole('owner') : [...actor.scopes],
  };
}
