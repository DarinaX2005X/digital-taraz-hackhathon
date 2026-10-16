import { describe, expect, it } from 'vitest';
import { accountAuthDestination, authHref } from '../../../src/features/identity/ui/navigation';

describe('same-surface account recovery', () => {
  it('retains project destination while recovering in place', () => {
    const path = '/app/projects/11111111-1111-4111-8111-111111111111';
    expect(accountAuthDestination(path)).toEqual({ returnTo: path, stay: true });
    expect(accountAuthDestination('/settings/team')).toEqual({ returnTo: '/settings/team', stay: true });
  });
  it('starts work after public login without changing the public address on view', () => {
    for (const path of ['/ru', '/kk', '/en', '/']) expect(accountAuthDestination(path)).toEqual({ returnTo: '/app', stay: false });
  });
  it('carries the opaque intent through recovery email and signup without private query content', () => {
    const token = 'a'.repeat(64);
    const destination = accountAuthDestination('/app/work', `?intent=${token}&goal=private`);
    expect(destination).toEqual({ returnTo: `/app/work?intent=${token}`, stay: true });
    for (const path of ['/auth/reset', '/sign-up'] as const) {
      const url = new URL(authHref(path, destination), 'https://tirlik.invalid');
      expect(url.searchParams.get('returnTo')).toBe(`/app/work?intent=${token}`);
      expect(url.href).not.toContain('private');
    }
  });
});
