import { describe, expect, it } from 'vitest';
import { canGrant, hasScope, memberActions, normalizedGrant, scopesForRole } from '../../../src/features/identity/domain/policy';

describe('workspace and project permission policy', () => {
  it('does not infer confidential, edit or project access from a role label', () => {
    expect(hasScope({ role: 'reviewer' }, 'edit')).toBe(false);
    expect(hasScope({ role: 'reviewer', confidential: true }, 'export')).toBe(false);
    expect(hasScope({ role: 'owner', projectScopes: ['read'] }, 'export')).toBe(false);
    expect(hasScope({ role: 'owner', projectScopes: ['read'], confidential: true }, 'read')).toBe(false);
    expect(hasScope({ role: 'reviewer', projectScopes: ['read', 'approve'] }, 'approve')).toBe(true);
  });
  it('requires complete owner grants and prevents delegated privilege escalation', () => {
    expect(normalizedGrant('owner', ['read'])).toBeUndefined();
    expect(normalizedGrant('editor', ['edit'])).toBeUndefined();
    expect(normalizedGrant('editor', ['read', 'read'])).toBeUndefined();
    const manager = { role: 'editor' as const, scopes: ['read', 'edit', 'manage-members'] as const };
    expect(canGrant(manager, { role: 'owner', scopes: scopesForRole('owner') })).toBe(false);
    expect(canGrant(manager, { role: 'reviewer', scopes: ['read', 'approve'] })).toBe(false);
    expect(canGrant(manager, { role: 'editor', scopes: ['read', 'edit'] })).toBe(true);
  });
  it('keeps the final owner in place but allows an ordinary member to leave', () => {
    const owner = { userId: 'owner', role: 'owner' as const, scopes: scopesForRole('owner') };
    expect(memberActions(owner, owner, 1)).toMatchObject({ revoke: false, roles: ['owner'], transfer: false });
    expect(memberActions(owner, owner, 2)).toMatchObject({ revoke: true, roles: ['owner', 'editor', 'reviewer'] });
    const reviewer = { userId: 'reviewer', role: 'reviewer' as const, scopes: scopesForRole('reviewer') };
    expect(memberActions(reviewer, reviewer, 1)).toMatchObject({ revoke: true, update: false });
    expect(memberActions(reviewer, owner, 1)).toMatchObject({ revoke: false, update: false });
  });
});
