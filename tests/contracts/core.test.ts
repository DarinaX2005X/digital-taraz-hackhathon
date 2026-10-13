import { describe, expect, it } from 'vitest';
import {
  ArtifactEnvelopeSchema, CalendarDateSchema, CommandGroupInputSchema, CommandInputSchema,
  CommandSchema, ERROR_HTTP_STATUS, ErrorEnvelopeSchema, InstantSchema, LocaleSchema,
  MoneyAdjustmentSchema, MoneySchema, QuantitySchema, SourceRefSchema, createCapabilityRegistry,
} from '../../src/contracts';

const id = '0198dd00-1111-7111-8111-111111111111';
const second = '0198dd00-2222-7222-8222-222222222222';
const hash = 'a'.repeat(64);
const command = {
  commandId: id, artifactId: second, baseRevision: 2, kind: 'document',
  operations: [{ targetId: 'block_1', op: 'set', value: 'New wording', beforeHash: hash }],
  expectedSourceRevisions: {}, reason: 'Revise the terms',
};

describe('exact business values', () => {
  it('preserves large minor-unit values without floating point conversion', () => {
    expect(MoneySchema.parse({ currency: 'KZT', minorUnits: '9007199254740993123' }).minorUnits).toBe('9007199254740993123');
    expect(QuantitySchema.parse({ decimal: '0.125', unit: 'kg' }).decimal).toBe('0.125');
  });
  it.each([12.5, '12.5', '-1', '1e3', '01', '', null])('rejects invalid money %j', (minorUnits) => {
    expect(MoneySchema.safeParse({ currency: 'KZT', minorUnits }).success).toBe(false);
  });
  it('requires explicit signed adjustment and recognized currency', () => {
    expect(MoneyAdjustmentSchema.parse({ currency: 'KZT', minorUnits: '-100', reason: 'return' }).minorUnits).toBe('-100');
    expect(MoneyAdjustmentSchema.safeParse({ currency: 'KZT', minorUnits: '-100' }).success).toBe(false);
    expect(MoneySchema.safeParse({ currency: 'ZZZ', minorUnits: '100' }).success).toBe(false);
    expect(QuantitySchema.safeParse({ decimal: '-1', unit: 'kg' }).success).toBe(false);
  });
  it('distinguishes UTC instants and valid calendar dates', () => {
    expect(InstantSchema.safeParse('2026-10-13T10:00:00Z').success).toBe(true);
    expect(InstantSchema.safeParse('2026-10-13T10:00:00').success).toBe(false);
    expect(CalendarDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(CalendarDateSchema.safeParse('2026-10-13').success).toBe(true);
  });
  it('has exactly the agreed three locale codes', () => {
    expect(LocaleSchema.options).toEqual(['ru', 'kk', 'en']);
    expect(LocaleSchema.safeParse('kz').success).toBe(false);
  });
});

describe('addressed versioned contracts', () => {
  it('never trusts actor or AI origin from a client command', () => {
    expect(CommandInputSchema.safeParse(command).success).toBe(true);
    expect(CommandInputSchema.safeParse({ ...command, actorId: id }).success).toBe(false);
    expect(CommandInputSchema.safeParse({ ...command, origin: 'ai' }).success).toBe(false);
    expect(CommandSchema.safeParse({ ...command, actorId: id, origin: 'human' }).success).toBe(true);
  });
  it('rejects arbitrary paths, invalid hashes and operations without values', () => {
    for (const patch of [{ targetId: '../cost' }, { beforeHash: 'guess' }, { value: undefined }]) {
      expect(CommandInputSchema.safeParse({ ...command, operations: [{ ...command.operations[0], ...patch }] }).success).toBe(false);
    }
  });
  it('requires a complete consistent group revision vector', () => {
    const group = { commandGroupId: id, expectedArtifactRevisions: { [second]: 2 }, expectedSourceRevisions: {}, commands: [command] };
    expect(CommandGroupInputSchema.safeParse(group).success).toBe(true);
    expect(CommandGroupInputSchema.safeParse({ ...group, expectedArtifactRevisions: {} }).success).toBe(false);
    expect(CommandGroupInputSchema.safeParse({ ...group, commands: [command, command] }).success).toBe(false);
    expect(CommandGroupInputSchema.safeParse({ ...group, expectedArtifactRevisions: { [second]: 1 } }).success).toBe(false);
    expect(CommandGroupInputSchema.safeParse({ ...group, commands: [{ ...command, expectedSourceRevisions: { [id]: 3 } }] }).success).toBe(false);
  });
  it('requires the complete record identity for field-level provenance', () => {
    const ref = { sourceId: id, sourceVersionId: second, revision: 1 };
    expect(SourceRefSchema.safeParse(ref).success).toBe(true);
    expect(SourceRefSchema.safeParse({ ...ref, recordId: id }).success).toBe(false);
    expect(SourceRefSchema.safeParse({ ...ref, collectionId: id, recordId: id, fieldId: 'price', factRevision: 0 }).success).toBe(true);
  });
  it('requires scoped typed artifact metadata and content reference', () => {
    const artifact = { id, workspaceId: id, projectId: second, kind: 'table', schemaVersion: 1,
      currentRevision: 0, title: 'Estimate', status: 'draft', contentRef: { id, hash }, sourceRefs: [],
      bindings: [], createdBy: id, updatedAt: '2026-10-13T10:00:00Z' };
    expect(ArtifactEnvelopeSchema.safeParse(artifact).success).toBe(true);
    expect(ArtifactEnvelopeSchema.safeParse({ ...artifact, workspaceId: undefined }).success).toBe(false);
    expect(ArtifactEnvelopeSchema.safeParse({ ...artifact, kind: 'free-form-report' }).success).toBe(false);
  });
});

describe('bounded public contracts', () => {
  it('validates safe errors and preserves different HTTP meanings', () => {
    const error = { code: 'CONFLICT', messageKey: 'errors.conflict', retryable: false, requestId: id, currentRevision: 3 };
    expect(ErrorEnvelopeSchema.safeParse(error).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ ...error, stack: 'secret' }).success).toBe(false);
    expect(ERROR_HTTP_STATUS.CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_HTTP_STATUS.UNAVAILABLE).toBe(503);
  });
  it('registers only immutable explicitly versioned capability descriptors', () => {
    const descriptor = { id: 'document.edit', version: 1, policyClass: 'mutate' as const, permissions: ['edit' as const], artifactKinds: ['document' as const] };
    const registry = createCapabilityRegistry([descriptor]);
    expect(() => createCapabilityRegistry([descriptor, descriptor])).toThrow('Duplicate capability');
    descriptor.permissions.length = 0;
    expect(registry.get('document.edit', 1)?.permissions).toEqual(['edit']);
    expect(Object.isFrozen(registry.get('document.edit', 1))).toBe(true);
    expect(registry.get('document.edit', 2)).toBeUndefined();
  });
});
