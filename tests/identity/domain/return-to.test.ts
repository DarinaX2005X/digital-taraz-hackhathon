import { describe, expect, it } from 'vitest';
import { authReturnTo, safeReturnTo } from '../../../src/features/identity/domain/return-to';
import { PasswordSchema, ProfileUpdateSchema, SignUpSchema } from '../../../src/features/identity/contracts';
import { hasScope, scopesForRole } from '../../../src/features/identity/domain/policy';

describe('identity navigation and input boundaries', () => {
  it('accepts only local product destinations and opaque state', () => {
    expect(safeReturnTo('/app/projects/one')).toBe('/app/projects/one');
    expect(safeReturnTo('/settings/profile')).toBe('/settings/profile');
    expect(safeReturnTo('/app/profile#security')).toBe('/app/profile');
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
  it('preserves one valid team workspace without widening the navigation allowlist', () => {
    const id = '152973d6-2600-4aef-99e1-6c0a9a57c659';
    expect(safeReturnTo(`/settings/team?workspace=${id}&email=private`)).toBe(`/settings/team?workspace=${id}`);
    expect(safeReturnTo(`/settings/team?workspace=${id}&workspace=${id}`)).toBe('/app');
    expect(safeReturnTo('/settings/team?workspace=foreign-invalid-id')).toBe('/app');
    expect(safeReturnTo(`/settings/profile?workspace=${id}`)).toBe('/settings/profile');
    expect(authReturnTo(`/settings/team?workspace=${id}`, 'a'.repeat(64))).toBe(`/settings/team?workspace=${id}&intent=${'a'.repeat(64)}`);
    expect(safeReturnTo(`/settings?intent=${'a'.repeat(64)}&intent=${'b'.repeat(64)}`)).toBe('/settings');
  });
  it('preserves the run-list workspace but not private queries or ambiguous selection', () => {
    const id = '152973d6-2600-4aef-99e1-6c0a9a57c659';
    const token = 'a'.repeat(64);
    expect(safeReturnTo(`/app/runs?workspace=${id}&goal=private&email=owner%40example.test#private`)).toBe(`/app/runs?workspace=${id}`);
    expect(authReturnTo(`/app/runs?workspace=${id}`, token)).toBe(`/app/runs?workspace=${id}&intent=${token}`);
    for (const workspace of ['', 'invalid', `${id}&workspace=${id}`, `${id}&work%73pace=${id}`]) {
      expect(safeReturnTo(`/app/runs?workspace=${workspace}`)).toBe('/app');
    }
    expect(safeReturnTo(`/app/runs/${id}?workspace=${id}&goal=private`)).toBe(`/app/runs/${id}`);
    expect(safeReturnTo(`/app/runs-archive?workspace=${id}`)).toBe('/app/runs-archive');
    expect(safeReturnTo('/app/runs')).toBe('/app/runs');
  });
  it('preserves workspace selection for the work entry without retaining private input', () => {
    const id = '152973d6-2600-4aef-99e1-6c0a9a57c659';
    const token = 'a'.repeat(64);
    for (const route of ['/app', '/app/work']) {
      expect(safeReturnTo(`${route}?workspace=${id}&goal=private#private`)).toBe(`${route}?workspace=${id}`);
      expect(authReturnTo(`${route}?workspace=${id}`, token)).toBe(`${route}?workspace=${id}&intent=${token}`);
      expect(safeReturnTo(`${route}?workspace=${id}&workspace=${id}`)).toBe('/app');
      expect(safeReturnTo(`${route}?workspace=invalid`)).toBe('/app');
    }
    expect(safeReturnTo(`/app/work-archive?workspace=${id}`)).toBe('/app/work-archive');
  });
  it('retains only exact source route identifiers and rejects ambiguous identifiers', () => {
    const id = '152973d6-2600-4aef-99e1-6c0a9a57c659';
    const route = '/app/materials/add';
    expect(safeReturnTo(`${route}?workspaceId=${id}&projectId=${id}&sourceId=${id}&fileName=private`))
      .toBe(`${route}?workspaceId=${id}&projectId=${id}&sourceId=${id}`);
    for (const key of ['workspaceId', 'projectId', 'sourceId']) {
      expect(safeReturnTo(`${route}?${key}=${id}&${key}=${id}`)).toBe('/app');
      expect(safeReturnTo(`${route}?${key}=invalid`)).toBe('/app');
    }
    expect(safeReturnTo(`/app/materials/sources/${id}?workspaceId=${id}&projectId=${id}&goal=private`))
      .toBe(`/app/materials/sources/${id}?workspaceId=${id}`);
    expect(safeReturnTo(`/app/materials/sources/invalid?workspaceId=${id}`)).toBe('/app/materials/sources/invalid');
    expect(safeReturnTo(`/app/materials/additional?workspaceId=${id}`)).toBe('/app/materials/additional');
  });
  it('preserves only an unambiguous project resume command on an exact project route', () => {
    const id = '152973d6-2600-4aef-99e1-6c0a9a57c659';
    const route = `/app/projects/${id}`;
    expect(safeReturnTo(`${route}?resume=1&title=private#private`)).toBe(`${route}?resume=1`);
    for (const query of ['resume=0', 'resume=true', 'resume=', 'resume=1&resume=1', 'resume=1&res%75me=1']) {
      expect(safeReturnTo(`${route}?${query}`)).toBe('/app');
    }
    for (const other of ['/app/projects/invalid', `${route}/artifacts`, '/app/work']) {
      expect(safeReturnTo(`${other}?resume=1`)).toBe(other);
    }
    expect(authReturnTo(`${route}?resume=1`, 'a'.repeat(64))).toBe(`${route}?resume=1&intent=${'a'.repeat(64)}`);
  });
  it('preserves one selected assistant session for an exact project or artifact route', () => {
    const id = '152973d6-2600-4aef-99e1-6c0a9a57c659';
    const run = '252973d6-2600-4aef-99e1-6c0a9a57c650';
    for (const route of [`/app/projects/${id}`, `/app/projects/${id}/artifacts/${id}`]) {
      expect(safeReturnTo(`${route}?run=${run}&goal=private`)).toBe(`${route}?run=${run}`);
      expect(safeReturnTo(`${route}?run=${run}&run=${run}`)).toBe('/app');
      expect(safeReturnTo(`${route}?run=invalid`)).toBe('/app');
    }
    expect(safeReturnTo(`/app/projects/invalid/artifacts/${id}?run=${run}`)).toBe(`/app/projects/invalid/artifacts/${id}`);
    expect(safeReturnTo(`/app/work?run=${run}`)).toBe('/app/work');
  });
  it('retains only supported opaque material library and saved import identifiers', () => {
    const id = '152973d6-2600-4aef-99e1-6c0a9a57c659';
    const libraryKeys = ['workspaceId', 'projectId', 'sourceId', 'sourceVersionId'];
    const query = libraryKeys.map((key) => `${key}=${id}`).join('&');
    expect(safeReturnTo(`/app/materials?${query}&search=private&title=private`)).toBe(`/app/materials?${query}`);
    const collection = `/app/materials/collections/${id}`;
    expect(safeReturnTo(`${collection}?workspaceId=${id}&importId=${id}&key=private`))
      .toBe(`${collection}?workspaceId=${id}&importId=${id}`);
    for (const [route, keys] of [['/app/materials', libraryKeys], [collection, ['workspaceId', 'importId']]] as const) {
      for (const key of keys) {
        expect(safeReturnTo(`${route}?${key}=${id}&${key}=${id}`)).toBe('/app');
        expect(safeReturnTo(`${route}?${key}=invalid`)).toBe('/app');
      }
    }
    expect(safeReturnTo(`/app/materials/collections/invalid?importId=${id}`)).toBe('/app/materials/collections/invalid');
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
