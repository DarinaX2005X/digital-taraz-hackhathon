import { describe, expect, it } from 'vitest';
import { isDefiniteRequestRejection, retainRequestAttempt } from '../../src/features/workspace/domain/request-attempt';

describe('workspace uncertain request identity', () => {
  it('reuses the original revision, authority, generated content and key after a refresh', () => {
    const first = retainRequestAttempt(undefined, { title: 'Offer' }, () => ({ expectedAuthzVersion: 1, revision: 2, content: { id: 'stable-first-block' } }), () => 'key-one');
    const retry = retainRequestAttempt(first, { title: 'Offer' }, () => ({ expectedAuthzVersion: 5, revision: 7, content: { id: 'different-generated-block' } }), () => 'key-two');
    expect(retry).toBe(first);
    expect(retry.input.expectedAuthzVersion).toBe(1);
    expect(retry.key).toBe('key-one');
  });
  it('creates a fresh request for a different deliberate edit without mutating the submitted body', () => {
    const input = { values: ['initial'] };
    const first = retainRequestAttempt(undefined, 'first', () => input, () => 'one');
    input.values[0] = 'later';
    expect(first.input.values).toEqual(['initial']);
    const next = retainRequestAttempt(first, 'changed', () => input, () => 'two');
    expect(next.key).toBe('two');
    expect(next.input.values).toEqual(['later']);
  });
  it('does not mistake transport, server or auth failures for proven non-commits', () => {
    for (const status of [0, 401, 403, 404, 408, 429, 500, 502]) expect(isDefiniteRequestRejection({ status })).toBe(false);
    for (const status of [400, 409, 422]) expect(isDefiniteRequestRejection({ status })).toBe(true);
  });
});
