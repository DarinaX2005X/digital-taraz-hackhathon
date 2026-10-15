import { describe, expect, it } from 'vitest';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import { bindDocumentField, changeDocumentField, materialText, replaceDocumentFieldValue } from '@/features/documents/domain/fields';
import { documentDraft } from '@/features/documents/domain/commands';
import { document, snapshot } from './fixtures';

const ref = () => ({ sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 2, collectionId: crypto.randomUUID(), recordId: crypto.randomUUID(), fieldId: 'price', factRevision: 1 });
function bound(): ArtifactSnapshot {
  const base = snapshot(document([{ type: 'paragraph', attrs: { id: 'first' }, content: [{ type: 'dataField', attrs: { id: 'price-field', value: '12 000 ₸' } }] }]));
  const sourceRef = ref();
  base.artifact.sourceRefs = [sourceRef]; base.artifact.bindings = [{ targetElementId: 'price-field', sourceRef, transformId: 'material-value', updateMode: 'deterministic' }];
  base.sourceFreshness = [{ sourceRef, status: 'stale', sourceStatus: 'stale', currentRevision: 3 }];
  return base;
}

describe('document linked values use canonical operations', () => {
  it('inserts content and binding with an atomic dependency registration', async () => {
    const base = snapshot(), sourceRef = ref();
    const desired = document([{ type: 'paragraph', attrs: { id: 'first' }, content: [{ type: 'text', text: 'Price: ' }, { type: 'dataField', attrs: { id: 'price-field', value: '12 000 ₸' } }] }]);
    const command = await bindDocumentField(base, desired, 'price-field', sourceRef, [{ sourceRef, status: 'current', sourceStatus: 'current', currentRevision: 2 }], 'kk', 'Insert price');
    const draft = documentDraft(base);
    await draft.apply(command.commands[0]!.operations, { actorId: base.viewer.userId, origin: 'human', at: command.metadataAt!, reason: 'Insert price' });
    const result = await draft.state();
    expect(result.content).toEqual(desired);
    expect(result.bindings['price-field']?.sourceRef).toEqual(sourceRef);
    expect(command.dependencyEdges[0]).toMatchObject({ target: { artifactId: base.artifact.id, targetElementId: 'price-field' }, transform: { kind: 'material-format', locale: 'kk' } });
  });
  it('records a local override while retaining source provenance', async () => {
    const base = bound(), command = await changeDocumentField(base, 'price-field', 'override', 'Special offer', 'Manual exception');
    const draft = documentDraft(base);
    await draft.apply(command.commands[0]!.operations, { actorId: base.viewer.userId, origin: 'human', at: command.metadataAt!, reason: 'Manual exception' });
    const result = await draft.state();
    expect(result.bindings['price-field']).toMatchObject({ sourceRef: base.artifact.sourceRefs[0], override: { reason: 'Manual exception' } });
    expect(result.content).toEqual(replaceDocumentFieldValue(base.content as ReturnType<typeof document>, 'price-field', 'Special offer'));
    expect(command.expectedSourceRevisions).toEqual({ [base.artifact.sourceRefs[0]!.sourceId]: 3 });
  });
  it('restores current value and clears the override in the same timestamped group', async () => {
    const base = bound(); base.artifact.bindings[0]!.override = { reason: 'Manual exception', actorId: base.viewer.userId, at: '2026-10-15T00:00:00.000Z' };
    const sourceRef = { ...base.artifact.sourceRefs[0]!, revision: 3, sourceVersionId: crypto.randomUUID(), factRevision: 2 };
    const command = await changeDocumentField(base, 'price-field', 'restore', '13 000 ₸', 'Restore source', sourceRef, [{ sourceRef, status: 'current', sourceStatus: 'current', currentRevision: 3 }], 'ru');
    const draft = documentDraft(base);
    await draft.apply(command.commands[0]!.operations, { actorId: base.viewer.userId, origin: 'human', at: command.metadataAt!, reason: 'Restore source' });
    const result = await draft.state();
    expect(result.bindings['price-field']?.override).toBeUndefined(); expect(result.bindings['price-field']?.sourceRef).toEqual(sourceRef);
    expect(command.dependencyEdges?.[0]?.inputs[0]?.ref).toEqual({ kind: 'source', sourceRef });
  });
  it('detaches the binding while preserving its last displayed value', async () => {
    const base = bound(), command = await changeDocumentField(base, 'price-field', 'unbind', '', 'Unlink');
    const draft = documentDraft(base); await draft.apply(command.commands[0]!.operations, { actorId: base.viewer.userId, origin: 'human', at: command.metadataAt!, reason: 'Unlink' });
    expect((await draft.state()).bindings['price-field']).toBeUndefined(); expect((await draft.state()).content).toEqual(base.content);
  });
  it('formats exact large money values and rejects unknown facts', () => {
    expect(materialText({ kind: 'money', minorUnits: '900719925474099301', currency: 'USD' }, 'en')).toBe('$9,007,199,254,740,993.01');
    expect(materialText({ kind: 'quantity', decimal: '1.25', unit: 'кг' }, 'kk')).toBe('1.25 кг');
    expect(() => materialText({ kind: 'unknown', reason: null }, 'ru')).toThrow();
  });
});
