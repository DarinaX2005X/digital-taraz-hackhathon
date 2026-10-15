import { describe, expect, it } from 'vitest';
import { documentFieldStatus } from '@/features/documents/domain/field-status';
const sourceRef = { sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 2 };
const fact = { requestedRef: sourceRef, state: 'current' as const, canBind: true, canCorrect: true };
describe('document field freshness presentation', () => {
  it('marks an unchanged mapped fact stale when its source head has advanced', () => {
    expect(documentFieldStatus(fact, { sourceRef, status: 'stale', sourceStatus: 'stale', currentRevision: 3 })).toBe('stale');
  });
  it('distinguishes authorized removal from unavailable or unconfirmed data', () => {
    const source = { sourceRef, status: 'current' as const, sourceStatus: 'current' as const, currentRevision: 2 };
    expect(documentFieldStatus({ ...fact, state: 'missing', canBind: false }, source)).toBe('missing');
    expect(documentFieldStatus(fact, { sourceRef, status: 'unknown', sourceStatus: 'unknown' })).toBe('unknown');
    expect(documentFieldStatus({ ...fact, canBind: false }, source)).toBe('unconfirmed');
    expect(documentFieldStatus(fact, source)).toBe('current');
  });
});
