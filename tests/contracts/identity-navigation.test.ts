import { describe, expect, it } from 'vitest';
import { readIdentityNavigation, readWorkspaceSelection } from '../../src/server/identity-navigation';

describe('identity route inputs', () => {
  it('distinguishes a missing workspace from invalid or ambiguous selection', () => {
    const workspaceId = '12345678-1234-4234-9234-123456789012';
    expect(readWorkspaceSelection({})).toEqual({ valid: true });
    expect(readWorkspaceSelection({ workspace: workspaceId })).toEqual({ valid: true, workspaceId });
    for (const workspace of ['', 'not-an-id', [workspaceId], [workspaceId, workspaceId]]) {
      expect(readWorkspaceSelection({ workspace })).toEqual({ valid: false });
    }
  });
  it('retains an allowlisted destination and opaque intent', () => {
    const intentToken = 'a'.repeat(64);
    expect(readIdentityNavigation({ returnTo: '/app/projects/example?secret=hidden', intentToken })).toEqual({
      returnTo: `/app/projects/example?intent=${intentToken}`, intentToken, token: undefined,
    });
  });

  it('rejects ambiguous or external destinations and token arrays', () => {
    for (const returnTo of ['https://elsewhere.test', '//elsewhere.test', ['/settings', '/demo']]) {
      expect(readIdentityNavigation({ returnTo, intentToken: ['a'.repeat(64)], token: ['b'.repeat(32)] })).toEqual({
        returnTo: '/app', intentToken: undefined, token: undefined,
      });
    }
  });

  it('accepts bounded email tokens without interpreting their content', () => {
    expect(readIdentityNavigation({ token: 'b'.repeat(32) }).token).toBe('b'.repeat(32));
    expect(readIdentityNavigation({ token: 'b'.repeat(2049) }).token).toBeUndefined();
  });
});
