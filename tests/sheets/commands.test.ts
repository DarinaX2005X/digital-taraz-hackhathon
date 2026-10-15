import { describe, expect, it } from 'vitest';
import { sheetCommand, sheetDraft, sheetStructureCommand, sheetSettingsCommand } from '@/features/sheets/domain/commands';
import { editableChange } from '@/features/sheets/domain/editing';
import { stableCellId } from '@/features/sheets/domain/model';
import { inverseInputs } from '@/features/artifacts/domain/operations';
import { snapshot } from './fixtures';

describe('direct spreadsheet command adapter', () => {
  it('changes an input and dependent caches in one undoable canonical group, then reopens the exact result', async () => {
    const initial = snapshot(), desired = structuredClone(initial.content), sheetId = desired.workbook.sheetOrder[0]!;
    desired.workbook.sheets[sheetId]!.cellData[0]![0]!.v = 15;
    const group = await sheetCommand(initial, desired, 'Change quantity');
    expect(group!.commands).toHaveLength(1); expect(group!.commands[0]!.operations).toHaveLength(2);
    const draft = sheetDraft(initial), context = { actorId: initial.viewer.userId, at: group!.metadataAt!, origin: 'human' as const, reason: 'Change quantity' };
    const applied = await draft.apply(group!.commands[0]!.operations, context), saved = (await draft.state()).content;
    expect(saved.kind).toBe('table'); if (saved.kind !== 'table') return;
    expect(saved.workbook.sheets[sheetId]!.cellData[1]![0]!.v).toBe(35);
    const reopened = sheetDraft(snapshot(saved)); expect((await reopened.state()).content).toEqual(saved);
    const undone = await draft.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse); expect((await draft.state()).content).toEqual(initial.content);
    await draft.apply(inverseInputs(undone.inverse), { ...context, origin: 'history' }, undone.inverse); expect((await draft.state()).content).toEqual(saved);
  });
  it('tracks bound input overrides with current source heads while preserving pinned provenance', async () => {
    const initial = snapshot(), id = initial.content.workbook.sheetOrder[0]!, targetId = stableCellId(initial.content, { sheetId: id, row: 0, column: 0 });
    const sourceRef = { sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 1 };
    initial.artifact.sourceRefs = [sourceRef]; initial.artifact.bindings = [{ targetElementId: targetId, sourceRef, transformId: 'identity', updateMode: 'propose' }]; initial.sourceFreshness = [{ sourceRef, status: 'stale', sourceStatus: 'stale', currentRevision: 2 }];
    const desired = structuredClone(initial.content); desired.workbook.sheets[id]!.cellData[0]![0]!.v = 16;
    const group = await sheetCommand(initial, desired, 'Manual quantity'); expect(group!.expectedSourceRevisions).toEqual({ [sourceRef.sourceId]: 2 });
    const draft = sheetDraft(initial); await draft.apply(group!.commands[0]!.operations, { actorId: initial.viewer.userId, at: group!.metadataAt!, origin: 'human', reason: 'Manual quantity' });
    expect((await draft.target(targetId))!.binding).toMatchObject({ sourceRef, override: { reason: 'Manual quantity' } });
  });
  it('inserts a stable row with transformed formulas and undoes the complete structural change', async () => {
    const initial = snapshot(), id = initial.content.workbook.sheetOrder[0]!, formulaId = stableCellId(initial.content, { sheetId: id, row: 1, column: 0 });
    const group = await sheetStructureCommand(initial, id, 'row', 'insert', 0, 0, 'Insert row');
    const draft = sheetDraft(initial), context = { actorId: initial.viewer.userId, at: group.metadataAt!, origin: 'human' as const, reason: 'Insert row' };
    const applied = await draft.apply(group.commands[0]!.operations, context);
    expect((await draft.target(formulaId))!.value).toMatchObject({ f: '=SUM(A2:B2)' });
    await draft.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse); expect((await draft.state()).content).toEqual(initial.content);
  });
  it('records freeze settings without replacing cells and invalidates visible caches only for input changes', async () => {
    const initial = snapshot(), id = initial.content.workbook.sheetOrder[0]!;
    const group = await sheetSettingsCommand(initial, id, { freeze: { xSplit: 1, ySplit: 1, startRow: 0, startColumn: 0 } }, 'Freeze headers');
    const draft = sheetDraft(initial); await draft.apply(group.commands[0]!.operations, { actorId: initial.viewer.userId, at: group.metadataAt!, origin: 'human', reason: 'Freeze headers' });
    const content = (await draft.state()).content; if (content.kind !== 'table') throw new Error('kind'); expect(content.workbook.sheets[id]!.freeze?.xSplit).toBe(1); expect(content.workbook.sheets[id]!.cellData).toEqual(initial.content.workbook.sheets[id]!.cellData);
    const style = structuredClone(initial.content); style.workbook.sheets[id]!.cellData[0]![0]!.s = { bl: 1 }; expect(editableChange(initial.content, style).workbook.sheets[id]!.cellData[1]![0]!.v).toBe(30);
    style.workbook.sheets[id]!.cellData[0]![0]!.v = 99; expect(editableChange(initial.content, style).workbook.sheets[id]!.cellData[1]![0]!.v).toBeUndefined();
  });
});
