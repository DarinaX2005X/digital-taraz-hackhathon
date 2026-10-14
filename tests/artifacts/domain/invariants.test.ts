import { describe, expect, it } from 'vitest';
import { createArtifactState, measureArtifactContent } from '../../../src/features/artifacts/domain/content-state';
import type { ArtifactContent, DocumentNode, JsonValue } from '../../../src/features/artifacts/domain/content-models';
import { MerkleJson } from '../../../src/features/artifacts/domain/merkle-json';
import { ArtifactDraft, inverseInputs, type OperationContext } from '../../../src/features/artifacts/domain/operations';
import { tableCellTargetId } from '../../../src/features/artifacts/domain/targets';
import { validateArtifactContent } from '../../../src/features/artifacts/domain/semantic-validation';

const context: OperationContext = { actorId: '68eb98a7-71ba-4ec3-b4c1-ed8ec3d4df88', at: '2026-10-14T12:00:00Z', reason: 'Manual condition', origin: 'human' };
const ref = { sourceId: '3401f1f2-2f6c-4e01-8a8d-427863d9658d', sourceVersionId: 'f87c6f66-625e-4028-a410-1618c471b8ac', revision: 1 };
const paragraph = (id: string, text = ''): DocumentNode => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : [] });
const field = (value: string): DocumentNode => ({ type: 'dataField', attrs: { id: 'field', value } });
const document = (nodes: DocumentNode[]): ArtifactContent => ({ kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: nodes } });
function draft(content: ArtifactContent, bindingTarget?: string) {
  const state = createArtifactState(content, bindingTarget ? [ref] : [], bindingTarget ? [{ targetElementId: bindingTarget, sourceRef: ref, transformId: 'copy', updateMode: 'propose' }] : []);
  const graph = new MerkleJson(); return new ArtifactDraft(graph, graph.encode(state as unknown as JsonValue));
}
async function set(value: ArtifactDraft, id: string, node: JsonValue, origin = context.origin) { return value.apply([{ targetId: id, op: 'set', value: node, beforeHash: (await value.target(id))!.hash }], { ...context, origin }); }

describe('fast-path global invariants', () => {
  it('checks every destination ancestor for AI insert and move', async () => {
    const value = draft(document([{ ...paragraph('p1'), content: [field('Original')] }, { type: 'blockquote', attrs: { id: 'protected' }, content: [paragraph('p2')] }]));
    await value.apply([{ targetId: 'protected', op: 'lock', value: { locked: true, reason: 'Agreed wording' }, beforeHash: (await value.target('protected'))!.hash }], context);
    await expect(value.apply([{ targetId: 'new', op: 'insert', value: { parentId: 'p2', beforeId: null, node: { type: 'dataField', attrs: { id: 'new', value: 'AI' } } }, beforeHash: null }], { ...context, origin: 'ai' })).rejects.toThrow('locked');
    await expect(value.apply([{ targetId: 'field', op: 'move', value: { parentId: 'p2', beforeId: null }, beforeHash: (await value.target('field'))!.hash }], { ...context, origin: 'ai' })).rejects.toThrow('locked');
    expect((await value.target('field'))!.parentId).toBe('p1');
  });
  it('protects a manually cleared bound virtual cell against automatic refill and reverses the override', async () => {
    const content: ArtifactContent = { kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Prices', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Prices', rowCount: 2, columnCount: 2, cellData: { 0: { 0: { v: 1450 } } } } } }, stableIds: { sheet: { rows: ['one', 'two'], columns: ['price', 'note'] } } };
    const id = tableCellTargetId('sheet', 'one', 'price'), value = draft(content, id);
    const removed = await value.apply([{ targetId: id, op: 'remove', beforeHash: (await value.target(id))!.hash }], context);
    expect((await value.target(id))!.binding?.override?.actorId).toBe(context.actorId);
    await expect(set(value, id, { v: 1595 }, 'ai')).rejects.toThrow('locked');
    await value.apply(inverseInputs(removed.inverse), { ...context, origin: 'history' }, removed.inverse);
    expect((await value.target(id))!.binding?.override).toBeUndefined();
    expect((await value.target(id))!.value).toEqual({ v: 1450 });
    const second = tableCellTargetId('sheet', 'two', 'note');
    await set(value, second, { v: 'New sparse row' });
    const state = await value.state(); expect(state.contentMetrics).toEqual(measureArtifactContent(state.content));
  });
  it('marks changed bound descendants as overrides and protects their metadata during conditional undo', async () => {
    const value = draft(document([{ ...paragraph('p1'), content: [field('Original')] }]), 'field');
    const applied = await set(value, 'p1', { ...paragraph('p1'), content: [field('Human wording')] } as unknown as JsonValue);
    expect((await value.target('field'))!.binding?.override?.reason).toBe(context.reason);
    await expect(set(value, 'field', field('AI wording') as unknown as JsonValue, 'ai')).rejects.toThrow('locked');
    const undone = await value.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse);
    expect((await value.target('field'))!.binding?.override).toBeUndefined();
    await value.apply(inverseInputs(undone.inverse), { ...context, origin: 'history' }, undone.inverse);
    expect((await value.target('field'))!.binding?.override?.reason).toBe(context.reason);
    await value.apply([{ targetId: 'field', op: 'lock', value: { locked: true, reason: 'Later reviewer protection' }, beforeHash: (await value.target('field'))!.hash }], context);
    await expect(value.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse)).rejects.toThrow('before-hash');
    expect((await value.target('field'))!.lock?.reason).toBe('Later reviewer protection');
  });
  it('rolls back an entire locally valid batch that would exceed the total 20 MiB bound', async () => {
    const content = document([...Array.from({ length: 200 }, (_, i) => paragraph(`large_${i}`, 'x'.repeat(100000))), ...Array.from({ length: 10 }, (_, i) => paragraph(`empty_${i}`))]);
    const value = draft(content), root = value.root;
    const operations = await Promise.all(Array.from({ length: 10 }, async (_, i) => ({ targetId: `empty_${i}`, op: 'set' as const, value: paragraph(`empty_${i}`, 'y'.repeat(100000)) as unknown as JsonValue, beforeHash: (await value.target(`empty_${i}`))!.hash })));
    await expect(value.apply(operations, context)).rejects.toThrow('content-too-large');
    expect(value.root).toBe(root);
    const state = await value.state(); expect(state.contentMetrics).toEqual(measureArtifactContent(state.content));
  }, 30000);
  it('enforces total node counts even when the replaced subtree keeps the same stable IDs', async () => {
    const value = draft(document(Array.from({ length: 5000 }, (_, i) => paragraph(`p_${i}`, 'text'))));
    await expect(set(value, 'p_0', { ...paragraph('p_0'), content: Array.from({ length: 10001 }, () => ({ type: 'text', text: 'x' })) } as JsonValue)).rejects.toThrow('content-too-complex');
  });
  it('revalidates ancestor table geometry and admits only real CSS hex lengths', async () => {
    const table: DocumentNode = { type: 'table', attrs: { id: 'table' }, content: Array.from({ length: 2 }, (_, r) => ({ type: 'tableRow', attrs: { id: `row_${r}` }, content: Array.from({ length: 2 }, (_, c) => ({ type: 'tableCell', attrs: { id: `cell_${r}_${c}` }, content: [paragraph(`p_${r}_${c}`)] })) })) };
    const value = draft(document([table])), before = (await value.target('cell_0_0'))!.value as unknown as DocumentNode;
    await expect(set(value, 'cell_0_0', { ...before, attrs: { ...before.attrs, colspan: 2 } } as unknown as JsonValue)).rejects.toThrow('ragged-document-table');
    expect(validateArtifactContent((await value.state()).content)).toEqual(document([table]));
    for (const color of ['#12345', '#1234567']) expect(() => validateArtifactContent(document([{ ...paragraph('p'), content: [{ type: 'text', text: 'Text', marks: [{ type: 'textStyle', attrs: { color } }] }] }]))).toThrow('invalid-color');
  });
});
