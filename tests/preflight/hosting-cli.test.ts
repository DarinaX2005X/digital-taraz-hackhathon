import { describe, expect, it } from 'vitest';
import { hostingOrigin } from '../../scripts/preflight/hosting-http';

describe('explicit hosting CLI target restrictions', () => {
  it('accepts a Tirlik HTTPS preview origin', () => {
    expect(hostingOrigin('https://tirlik-example-team.vercel.app')).toBe('https://tirlik-example-team.vercel.app');
  });
  it.each([
    'http://tirlik-example.vercel.app', 'https://foreign.vercel.app', 'https://example.com',
    'https://tirlik-example.vercel.app.evil.test', 'https://secret@tirlik-example.vercel.app',
    'https://tirlik-example.vercel.app/private', 'https://tirlik-example.vercel.app?token=secret',
  ])('rejects nonproject, credential-bearing, or non-origin target %s', (value) => {
    expect(() => hostingOrigin(value)).toThrow();
  });
});
