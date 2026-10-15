import { describe, expect, it } from 'vitest';
import { createArtifactState } from '../../../src/features/artifacts/domain/content-state';
import type { ArtifactContent, JsonValue } from '../../../src/features/artifacts/domain/content-models';
import { MerkleJson } from '../../../src/features/artifacts/domain/merkle-json';
import { ArtifactDraft, inverseInputs, type OperationContext } from '../../../src/features/artifacts/domain/operations';
import { tableCellTargetId, tableRowTargetId, tableSheetTargetId } from '../../../src/features/artifacts/domain/targets';

const actorId = '68eb98a7-71ba-4ec3-b4c1-ed8ec3d4df88';
const context: OperationContext = { actorId, at: '2026-10-14T12:00:00Z', reason: 'Manual wording', origin: 'human' };
function document(): ArtifactContent { return { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Original first condition' }] }, { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Manual delivery wording' }] }] } }; }
function draft(content = document()) { const graph = new MerkleJson(); return new ArtifactDraft(graph, graph.encode(createArtifactState(content) as unknown as JsonValue)); }
const paragraph = (id: string, text: string): JsonValue => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

describe('conditional artifact operations', () => {
  it('undoes one target while preserving another actor edit; refuses a changed inverse target', async () => {
    const value = draft();
    const applied = await value.apply([{ targetId: 'p1', op: 'set', value: paragraph('p1', 'Accepted first condition'), beforeHash: (await value.target('p1'))!.hash }], context);
    await value.apply([{ targetId: 'p2', op: 'set', value: paragraph('p2', 'Other actor wording'), beforeHash: (await value.target('p2'))!.hash }], { ...context, actorId: 'a02465e0-f2ce-4e8d-8bc2-4a4cdf6496f7' });
    const undo = await value.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse);
    expect((await value.target('p1'))!.value).toEqual(paragraph('p1', 'Original first condition'));
    expect((await value.target('p2'))!.value).toEqual(paragraph('p2', 'Other actor wording'));
    await value.apply(inverseInputs(undo.inverse), { ...context, origin: 'history' }, undo.inverse);
    expect((await value.target('p1'))!.value).toEqual(paragraph('p1', 'Accepted first condition'));
    await value.apply([{ targetId: 'p1', op: 'set', value: paragraph('p1', 'Late edit'), beforeHash: (await value.target('p1'))!.hash }], context);
    const root = value.root;
    await expect(value.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse)).rejects.toThrow('before-hash');
    expect(value.root).toBe(root);
  });
  it('rolls back the in-memory root for the whole failed command and enforces standalone/ancestor AI locks', async () => {
    const value = draft(), root = value.root;
    await expect(value.apply([{ targetId: 'p1', op: 'set', value: paragraph('p1', 'Uncommitted'), beforeHash: (await value.target('p1'))!.hash }, { targetId: 'p2', op: 'set', value: paragraph('p2', 'Bad precondition'), beforeHash: '0'.repeat(64) }], context)).rejects.toThrow('before-hash');
    expect(value.root).toBe(root);
    const locked = await value.apply([{ targetId: 'root', op: 'lock', value: { locked: true, reason: 'Protected wording' }, beforeHash: (await value.target('root'))!.hash }], context);
    await expect(value.apply([{ targetId: 'p1', op: 'set', value: paragraph('p1', 'AI rewrite'), beforeHash: (await value.target('p1'))!.hash }], { ...context, origin: 'ai' })).rejects.toThrow('locked');
    await value.apply(inverseInputs(locked.inverse), { ...context, origin: 'history' }, locked.inverse);
    expect((await value.target('root'))!.lock).toBeNull();
  });
  it('retains imported protection without granting AI or import authority to remove existing locks', async () => {
    const value = draft(), imported = { ...context, origin: 'import' as const };
    const lock = { targetId: 'p1', op: 'lock' as const, value: { locked: true, reason: 'Imported approved wording' }, beforeHash: (await value.target('p1'))!.hash };
    await expect(value.apply([lock], { ...context, origin: 'ai' })).rejects.toThrow('only-human-may-change-lock');
    const applied = await value.apply([lock], imported);
    expect((await value.target('p1'))!.lock).toEqual({ actorId, at: context.at, reason: 'Imported approved wording' });
    await expect(value.apply([{ ...lock, beforeHash: (await value.target('p1'))!.hash }], imported)).rejects.toThrow('locked');
    await expect(value.apply([{ targetId: 'p1', op: 'set', value: paragraph('p1', 'Import replacement'), beforeHash: (await value.target('p1'))!.hash }], imported)).rejects.toThrow('locked');
    await expect(value.apply([{ targetId: 'p1', op: 'lock', value: { locked: false }, beforeHash: (await value.target('p1'))!.hash }], imported)).rejects.toThrow('locked');
    await expect(value.apply([{ targetId: 'p2', op: 'lock', value: { locked: false }, beforeHash: (await value.target('p2'))!.hash }], imported)).rejects.toThrow('only-human-may-change-lock');
    await value.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse);
    expect((await value.target('p1'))!.lock).toBeNull();
    await value.apply([{ targetId: 'root', op: 'lock', value: { locked: true, reason: 'Parent protection' }, beforeHash: (await value.target('root'))!.hash }], context);
    await expect(value.apply([{ ...lock, beforeHash: (await value.target('p1'))!.hash }], imported)).rejects.toThrow('locked');
    const nested = draft();
    await nested.apply([{ ...lock, beforeHash: (await nested.target('p1'))!.hash }], imported);
    const childProtection = (await nested.target('p1'))!.lock;
    await nested.apply([{ targetId: 'root', op: 'lock', value: { locked: true, reason: 'Imported parent protection' }, beforeHash: (await nested.target('root'))!.hash }], imported);
    expect((await nested.target('p1'))!.lock).toEqual(childProtection);
    expect((await nested.target('root'))!.lock?.reason).toBe('Imported parent protection');
    await expect(nested.apply([{ targetId: 'root', op: 'set', value: paragraph('root', 'Replacement'), beforeHash: (await nested.target('root'))!.hash }], imported)).rejects.toThrow('locked');
  });
  it('inserts, moves and removes document blocks with exact inverse and retired stable IDs', async () => {
    const value = draft();
    const inserted = await value.apply([{ targetId: 'new', op: 'insert', value: { parentId: 'root', beforeId: 'p2', node: paragraph('new', 'New condition') }, beforeHash: null }], context);
    expect((await value.target('new'))!.position).toBe(1);
    const moved = await value.apply([{ targetId: 'new', op: 'move', value: { parentId: 'root', beforeId: 'p1' }, beforeHash: (await value.target('new'))!.hash }], context);
    expect((await value.target('new'))!.position).toBe(0);
    await value.apply(inverseInputs(moved.inverse), { ...context, origin: 'history' }, moved.inverse);
    await value.apply(inverseInputs(inserted.inverse), { ...context, origin: 'history' }, inserted.inverse);
    expect(await value.target('new')).toBeNull();
    await expect(value.apply([{ targetId: 'new', op: 'insert', value: { parentId: 'root', beforeId: null, node: paragraph('new', 'Different semantic node') }, beforeHash: null }], context)).rejects.toThrow('cannot-reuse-retired-id');
  });
  it('preserves cell identity through row insertion and undo while local cell edits use path chunks', async () => {
    const table: ArtifactContent = { kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Prices', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Prices', rowCount: 2, columnCount: 2, cellData: { 0: { 0: { v: '00081', t: 1 }, 1: { v: 1450, t: 2 } } } } } }, stableIds: { sheet: { rows: ['r1', 'r2'], columns: ['sku', 'price'] } } };
    const value = draft(table), cell = tableCellTargetId('sheet', 'r1', 'price'), before = (await value.target(cell))!;
    const inserted = await value.apply([{ targetId: tableRowTargetId('sheet', 'new'), op: 'insert', value: { sheetId: 'sheet', axis: 'row', id: 'new', beforeId: tableRowTargetId('sheet', 'r1'), cells: { sku: { v: '00082' } } }, beforeHash: null }], context);
    expect((await value.target(cell))!.hash).toBe(before.hash);
    await value.apply([{ targetId: cell, op: 'set', value: { v: 1595, t: 2 }, beforeHash: before.hash }], context);
    await value.apply(inverseInputs(inserted.inverse), { ...context, origin: 'history' }, inserted.inverse);
    expect((await value.target(cell))!.value).toEqual({ v: 1595, t: 2 });
    expect((await value.state()).content).toMatchObject({ workbook: { sheets: { sheet: { rowCount: 2 } } } });
  });
  it('preserves binding lineage and exact override metadata through undo/redo', async () => {
    const value = draft(), sourceRef = { sourceId: '3401f1f2-2f6c-4e01-8a8d-427863d9658d', sourceVersionId: 'f87c6f66-625e-4028-a410-1618c471b8ac', revision: 1 };
    await value.apply([{ targetId: 'p1', op: 'bind', value: { sourceRef, transformId: 'copy', updateMode: 'propose' }, beforeHash: (await value.target('p1'))!.hash }], context);
    const changed = await value.apply([{ targetId: 'p1', op: 'set', value: paragraph('p1', 'Manual replacement'), beforeHash: (await value.target('p1'))!.hash }], context);
    expect((await value.target('p1'))!.binding?.override).toEqual({ reason: context.reason, actorId, at: context.at });
    await expect(value.apply([{ targetId: 'p1', op: 'set', value: paragraph('p1', 'Automatic replacement'), beforeHash: (await value.target('p1'))!.hash }], { ...context, origin: 'ai' })).rejects.toThrow('locked');
    const undone = await value.apply(inverseInputs(changed.inverse), { ...context, origin: 'history' }, changed.inverse);
    expect((await value.target('p1'))!.binding).toMatchObject({ sourceRef, updateMode: 'propose' });
    expect((await value.target('p1'))!.binding?.override).toBeUndefined();
    await value.apply(inverseInputs(undone.inverse), { ...context, origin: 'history' }, undone.inverse);
    expect((await value.target('p1'))!.binding?.override?.reason).toBe(context.reason);
    const removed = await value.apply([{ targetId: 'p1', op: 'remove', beforeHash: (await value.target('p1'))!.hash }], context);
    expect(await value.target('p1')).toBeNull();
    expect((await value.state()).bindings.p1?.sourceRef).toEqual(sourceRef);
    await value.apply(inverseInputs(removed.inverse), { ...context, origin: 'history' }, removed.inverse);
    expect((await value.target('p1'))!.binding?.override?.actorId).toBe(actorId);
  });
  it('changes only sheet settings with exact undo and rejects hidden cell replacements', async () => {
    const table: ArtifactContent = { kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Prices', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Prices', rowCount: 2, columnCount: 2, cellData: { 0: { 0: { v: 'SKU', t: 1 } } } } } }, stableIds: { sheet: { rows: ['r1', 'r2'], columns: ['sku', 'price'] } } };
    const value = draft(table), targetId = tableSheetTargetId('sheet');
    const applied = await value.apply([{ targetId, op: 'set', beforeHash: (await value.target(targetId))!.hash, value: { kind: 'sheet-settings', name: 'Estimate', freeze: { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 }, charts: [{ id: 'prices', title: 'Prices', type: 'bar', labelColumnId: 'sku', valueColumnIds: ['price'], rowIds: ['r1'] }] } }], context);
    expect((await value.state()).content).toMatchObject({ workbook: { sheets: { sheet: { name: 'Estimate', cellData: table.workbook.sheets.sheet!.cellData } } } });
    const undone = await value.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse);
    expect((await value.state()).content).toEqual(table);
    await value.apply(inverseInputs(undone.inverse), { ...context, origin: 'history' }, undone.inverse);
    await expect(value.apply([{ targetId, op: 'set', beforeHash: (await value.target(targetId))!.hash, value: { kind: 'sheet-settings', cellData: {} } }], context)).rejects.toThrow('invalid-operation-value');
  });
  it('roundtrips named and cropped layers without altering the original asset reference', async () => {
    const assetId = '68eb98a7-71ba-4ec3-b4c1-ed8ec3d4df88';
    const design: ArtifactContent = { kind: 'design', schemaVersion: 1, pages: [{ id: 'page', width: 800, height: 600, unit: 'px', background: '#ffffff', layers: [{ id: 'photo', type: 'image', assetId, transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0 }, style: {} }] }] };
    const value = draft(design), previous = (await value.target('photo'))!;
    const changed = await value.apply([{ targetId: 'photo', op: 'set', beforeHash: previous.hash, value: { ...previous.value as Record<string, JsonValue>, name: 'Product', crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 } } }], context);
    expect((await value.target('photo'))!.value).toMatchObject({ assetId, name: 'Product', crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 } });
    await value.apply(inverseInputs(changed.inverse), { ...context, origin: 'history' }, changed.inverse);
    expect((await value.state()).content).toEqual(design);
  });
  it('keeps text and fill bindings independent and geometry-only edits do not create value overrides', async () => {
    const design: ArtifactContent = { kind: 'design', schemaVersion: 1, pages: [{ id: 'page', width: 800, height: 600, unit: 'px', background: '#ffffff', layers: [{ id: 'price', type: 'text', text: '131 900 ₸', transform: { x: 10, y: 20, width: 220, height: 48, rotation: 0 }, style: { fill: '#112233' } }] }] };
    const textRef = { sourceId: '3401f1f2-2f6c-4e01-8a8d-427863d9658d', sourceVersionId: 'f87c6f66-625e-4028-a410-1618c471b8ac', revision: 1 };
    const fillRef = { sourceId: 'd37a9a8c-d39e-4f3d-8fd3-05373ce2cae9', sourceVersionId: '29b446f0-febd-4e56-a078-ce7a31f00f32', revision: 1 };
    const graph = new MerkleJson(), value = new ArtifactDraft(graph, graph.encode(createArtifactState(design, [textRef, fillRef], [
      { targetElementId: 'price', targetProperty: 'text', sourceRef: textRef, transformId: 'price-text', updateMode: 'propose' },
      { targetElementId: 'price', targetProperty: 'fill', sourceRef: fillRef, transformId: 'brand-fill', updateMode: 'propose' },
    ]) as unknown as JsonValue));
    const textBeforeGeometry = (await value.target('price', 'text'))!;
    const whole = (await value.target('price'))!;
    await value.apply([{ targetId: 'price', op: 'set', beforeHash: whole.hash, value: { ...whole.value as Record<string, JsonValue>, transform: { x: 90, y: 110, width: 260, height: 52, rotation: 2 } } }], context);
    expect((await value.target('price', 'text'))!.binding?.override).toBeUndefined();
    expect((await value.target('price', 'fill'))!.binding?.override).toBeUndefined();
    // The text precondition is property-scoped, so the prior geometry-only edit
    // does not invalidate the reviewed text change.
    await value.apply([{ targetId: 'price', targetProperty: 'text', op: 'set', beforeHash: textBeforeGeometry.hash, value: '143 600 ₸' }], context);
    expect((await value.target('price', 'text'))!.binding?.override?.reason).toBe(context.reason);
    expect((await value.target('price', 'fill'))!.binding?.override).toBeUndefined();
    expect((await value.target('price'))!.value).toMatchObject({ text: '143 600 ₸', style: { fill: '#112233' }, transform: { x: 90, y: 110 } });
    await value.apply([{ targetId: 'price', targetProperty: 'fill', op: 'set', beforeHash: (await value.target('price', 'fill'))!.hash, value: '#445566' }], context);
    expect((await value.target('price', 'fill'))!.binding?.override?.reason).toBe(context.reason);
    await expect(value.apply([{ targetId: 'price', targetProperty: 'geometry' as never, op: 'set', beforeHash: (await value.target('price'))!.hash, value: 1 }], context)).rejects.toThrow();
  });
  it('restores table merges exactly and permits formulas unaffected by a structural edit', async () => {
    const table: ArtifactContent = { kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Prices', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Prices', rowCount: 3, columnCount: 2, cellData: {}, mergeData: [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }] } } }, stableIds: { sheet: { rows: ['r1', 'r2', 'r3'], columns: ['sku', 'price'] } } };
    const value = draft(table), row = tableRowTargetId('sheet', 'r2');
    const removed = await value.apply([{ targetId: row, op: 'remove', beforeHash: (await value.target(row))!.hash }], context);
    await value.apply(inverseInputs(removed.inverse), { ...context, origin: 'history' }, removed.inverse);
    expect((await value.state()).content).toEqual(table);
    const cell = tableCellTargetId('sheet', 'r1', 'price');
    await value.apply([{ targetId: cell, op: 'set', value: { f: '=1+1' }, beforeHash: (await value.target(cell))!.hash }], context);
    const changed = await value.apply([{ targetId: row, op: 'remove', beforeHash: (await value.target(row))!.hash }], context);
    expect((await value.target(cell))!.value).toEqual({ f: '=1+1' });
    await value.apply(inverseInputs(changed.inverse), { ...context, origin: 'history' }, changed.inverse);
    expect((await value.target(cell))!.value).toEqual({ f: '=1+1' });
  });
  it('rewrites cross-sheet formulas with guarded exact undo/redo and protects formula locks', async () => {
    const table: ArtifactContent = { kind: 'table', schemaVersion: 1, workbook: { id: 'book', name: 'Prices', appVersion: '1', locale: 'ruRU', sheetOrder: ['sheet', 'summary'], sheets: {
      sheet: { id: 'sheet', name: 'Prices', rowCount: 3, columnCount: 2, cellData: { 0: { 0: { v: 10 } }, 1: { 0: { v: 20 } }, 2: { 1: { f: '=SUM(A1:A3)', v: 30, t: 2 } } }, freeze: { xSplit: 0, ySplit: 3, startRow: 2, startColumn: -1 } },
      summary: { id: 'summary', name: 'Summary', rowCount: 1, columnCount: 1, cellData: { 0: { 0: { f: "='Prices'!$A$2", v: 20, t: 2 } } } },
    } }, stableIds: { sheet: { rows: ['r1', 'r2', 'r3'], columns: ['sku', 'price'] }, summary: { rows: ['total'], columns: ['value'] } } };
    const value = draft(table), row = tableRowTargetId('sheet', 'r2'), formula = tableCellTargetId('summary', 'total', 'value');
    const lock = await value.apply([{ targetId: formula, op: 'lock', value: { locked: true, reason: 'Approved total' }, beforeHash: (await value.target(formula))!.hash }], context);
    await expect(value.apply([{ targetId: row, op: 'remove', beforeHash: (await value.target(row))!.hash }], { ...context, origin: 'ai' })).rejects.toThrow('locked');
    await value.apply(inverseInputs(lock.inverse), { ...context, origin: 'history' }, lock.inverse);
    const removed = await value.apply([{ targetId: row, op: 'remove', beforeHash: (await value.target(row))!.hash }], context);
    expect((await value.target(formula))!.value).toEqual({ f: '=#REF!' });
    expect((await value.target(tableCellTargetId('sheet', 'r3', 'price')))!.value).toEqual({ f: '=SUM(A1:A2)' });
    const undone = await value.apply(inverseInputs(removed.inverse), { ...context, origin: 'history' }, removed.inverse);
    expect((await value.state()).content).toEqual(table);
    const redone = await value.apply(inverseInputs(undone.inverse), { ...context, origin: 'history' }, undone.inverse);
    await value.apply([{ targetId: formula, op: 'set', value: { f: '=1+1' }, beforeHash: (await value.target(formula))!.hash }], context);
    const root = value.root;
    await expect(value.apply(inverseInputs(redone.inverse), { ...context, origin: 'history' }, redone.inverse)).rejects.toThrow('before-hash');
    expect(value.root).toBe(root);
  });
  it('validates design and plan semantics after addressable changes and preserves other elements', async () => {
    const design: ArtifactContent = { kind: 'design', schemaVersion: 1, pages: [{ id: 'page', width: 800, height: 600, unit: 'px', background: '#ffffff', layers: [{ id: 'title', type: 'text', text: 'Original', transform: { x: 0, y: 0, width: 200, height: 40, rotation: 0 }, style: {} }] }] };
    const value = draft(design), changed = await value.apply([{ targetId: 'title', op: 'style', value: { fill: '#112233' }, beforeHash: (await value.target('title'))!.hash }], context);
    await value.apply(inverseInputs(changed.inverse), { ...context, origin: 'history' }, changed.inverse);
    expect((await value.state()).content).toEqual(design);
    const entry = { id: 'one', title: 'Prepare', status: 'todo' as const, resourceIds: [], dependencies: [], checklist: [], availabilityVersionIds: [] };
    const plan = draft({ kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [entry, { ...entry, id: 'two', dependencies: ['one'] }] });
    await expect(plan.apply([{ targetId: 'one', op: 'set', value: { ...entry, dependencies: ['two'] }, beforeHash: (await plan.target('one'))!.hash }], context)).rejects.toThrow();
    expect((await plan.target('one'))!.value).toEqual(entry);
    const resourceId = '68eb98a7-71ba-4ec3-b4c1-ed8ec3d4df88', availabilityVersionId = 'a02465e0-f2ce-4e8d-8bc2-4a4cdf6496f7';
    const operational = { ...entry, description: 'Проверить срок и загрузку.', assignments: [{ resourceId, resourceRevision: 2, availabilityVersionId, effort: { decimal: '4.5', unit: 'hour' } }], linkedArtifactIds: [resourceId], sourceRefs: [{ sourceId: resourceId, sourceVersionId: availabilityVersionId, revision: 1 }], calendar: { uid: 'tirlik-one@example.test', sequence: 3 }, capacityOverride: { reason: 'Подтверждено руководителем', actorId, acceptedAt: context.at, availabilityVersionIds: [availabilityVersionId], assessmentKey: 'a'.repeat(64) } };
    const applied = await plan.apply([{ targetId: 'one', op: 'set', value: operational, beforeHash: (await plan.target('one'))!.hash }], context);
    expect((await plan.target('one'))!.value).toEqual(operational);
    await plan.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse);
    expect((await plan.target('one'))!.value).toEqual(entry);
  });
});
