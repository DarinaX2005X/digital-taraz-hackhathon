import { describe, expect, it } from 'vitest';
import { authReturnTo, safeReturnTo } from '../../../src/features/identity/domain/return-to';
import { PasswordSchema, ProfileUpdateSchema, SignUpSchema } from '../../../src/features/identity/contracts';
import { hasScope, scopesForRole } from '../../../src/features/identity/domain/policy';

describe('identity navigation and input boundaries', () => {
  it('accepts only local product destinations and opaque state', () => {
    expect(safeReturnTo('/app/projects/one')).toBe('/app/projects/one');
    expect(safeReturnTo('/settings/profile')).toBe('/settings/profile');
    for (const target of ['https://evil.test/app', '//evil.test/app', '/\\evil.test', '/api/auth/sign-out', '/app/../../api/auth', '/apple', '/app\n']) expect(safeReturnTo(target)).toBe('/app');
    expect(safeReturnTo('/app?goal=private&email=a%40b.test#private')).toBe('/app');
    const token = 'a'.repeat(64);
    expect(authReturnTo('/app/projects?goal=secret', token)).toBe(`/app/projects?intent=${token}`);
    expect(safeReturnTo(`/demo?intent=${token}`)).toBe(`/demo?intent=${token}`);
  });
  it('bounds account input and never accepts ownership from signup', () => {
    expect(PasswordSchema.safeParse('short').success).toBe(false);
    expect(PasswordSchema.safeParse('x'.repeat(129)).success).toBe(false);
    expect(SignUpSchema.safeParse({ name: 'Owner', email: 'USER@EXAMPLE.TEST', password: 'strong password', role: 'owner' }).success).toBe(false);
    expect(SignUpSchema.parse({ name: ' Owner ', email: 'USER@EXAMPLE.TEST', password: 'strong password', locale: 'kk' }).email).toBe('user@example.test');
    expect(ProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ emailVerified: true }).success).toBe(false);
  });
});
describe('default-deny scopes', () => {
  it('keeps confidential data and membership management restricted', () => {
    expect(scopesForRole('owner')).toContain('manage-members');
    expect(hasScope({ role: 'editor' }, 'approve')).toBe(false);
    expect(hasScope({ role: 'reviewer' }, 'edit')).toBe(false);
    expect(hasScope({ role: 'editor', confidential: true }, 'read')).toBe(false);
    expect(hasScope({ role: 'owner', projectScopes: [] }, 'read')).toBe(false);
    expect(hasScope({ role: 'owner', projectScopes: ['read'], confidential: true }, 'read')).toBe(false);
    expect(hasScope({ role: 'owner', projectScopes: ['read', 'read-confidential'], confidential: true }, 'read')).toBe(true);
  });
});
