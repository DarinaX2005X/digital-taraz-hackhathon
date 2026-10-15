import type { CommandGroupDraft } from '@/features/artifacts/client/grouping';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import { createEditorArtifactState, expectedSourceRevisions } from '@/features/artifacts/client/snapshot-state';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import { ArtifactDraft, type ArtifactOperation } from '@/features/artifacts/domain/operations';
import { ContentValidationError, hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue, TableCell } from '@/features/artifacts/domain/content-models';
import { tableColumnTargetId, tableRowTargetId, tableSheetTargetId } from '@/features/artifacts/domain/targets';
import { calculateWorkbook } from '../engine/calculate';
import { cellAt, requireTable, stableCellId, type CellAddress, type TableContent } from './model';

const json = (value: unknown) => value as JsonValue;
const same = (a: unknown, b: unknown) => hashJson(json(a ?? null)) === hashJson(json(b ?? null));
export function sheetDraft(snapshot: ArtifactSnapshot) {
  requireTable(snapshot.content); const graph = new MerkleJson();
  return new ArtifactDraft(graph, graph.encode(json(createEditorArtifactState(snapshot))));
}
export function sheetOperationsCommand(snapshot: ArtifactSnapshot, operations: ArtifactOperation[], reason: string, metadataAt = new Date().toISOString()): CommandGroupDraft {
  const sources = expectedSourceRevisions(snapshot);
  return { metadataAt, expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision }, expectedSourceRevisions: sources,
    commands: [{ artifactId: snapshot.artifact.id, baseRevision: snapshot.artifact.currentRevision, kind: 'table', operations, expectedSourceRevisions: sources, reason }] };
}
export async function sheetCommand(snapshot: ArtifactSnapshot, input: TableContent, reason: string): Promise<CommandGroupDraft | null> {
  const before = requireTable(snapshot.content), desired = (await calculateWorkbook(requireTable(input))).content;
  if (!same(before.stableIds, desired.stableIds) || !same(before.workbook.sheetOrder, desired.workbook.sheetOrder)) throw new ContentValidationError('use-structural-sheet-command');
  if (!same(before.workbook.styles, desired.workbook.styles) || before.workbook.id !== desired.workbook.id || before.workbook.name !== desired.workbook.name) throw new ContentValidationError('use-sheet-settings-command');
  const draft = sheetDraft(snapshot), operations: ArtifactOperation[] = [], metadataAt = new Date().toISOString();
  for (const sheetId of before.workbook.sheetOrder) {
    const oldSheet = before.workbook.sheets[sheetId]!, sheet = desired.workbook.sheets[sheetId]!;
    for (const row of new Set([...Object.keys(oldSheet.cellData), ...Object.keys(sheet.cellData)])) {
      for (const column of new Set([...Object.keys(oldSheet.cellData[row] ?? {}), ...Object.keys(sheet.cellData[row] ?? {})])) {
        const oldCell = oldSheet.cellData[row]?.[column], next = sheet.cellData[row]?.[column];
        if (same(oldCell, next)) continue;
        const targetId = stableCellId(before, { sheetId, row: Number(row), column: Number(column) });
        const target = await draft.target(targetId);
        const operation: ArtifactOperation = { targetId, beforeHash: target?.hash ?? null, op: next ? 'set' : 'remove', ...(next ? { value: json(next) } : {}) };
        await draft.apply([operation], { actorId: snapshot.viewer.userId, at: metadataAt, origin: 'human', reason }); operations.push(operation);
      }
    }
    const settings: Record<string, JsonValue> = { kind: 'sheet-settings' };
    for (const key of ['name', 'freeze', 'charts', 'calculation', 'mergeData', 'rowData', 'columnData'] as const) if (!same(oldSheet[key], sheet[key])) settings[key] = json(sheet[key] ?? null);
    if (Object.keys(settings).length > 1) {
      const targetId = tableSheetTargetId(sheetId), target = await draft.target(targetId);
      const operation: ArtifactOperation = { targetId, op: 'set', beforeHash: target?.hash ?? null, value: settings };
      await draft.apply([operation], { actorId: snapshot.viewer.userId, at: metadataAt, origin: 'human', reason }); operations.push(operation);
    }
  }
  if (operations.length > 1000) throw new ContentValidationError('sheets.errors.editRange');
  if (!same((await draft.state()).content, desired)) throw new ContentValidationError('sheet-command-mismatch');
  return operations.length ? sheetOperationsCommand(snapshot, operations, reason, metadataAt) : null;
}
export function changeCells(content: TableContent, cells: { address: CellAddress; cell: TableCell }[]): TableContent {
  const result = structuredClone(content);
  for (const { address, cell } of cells) {
    stableCellId(result, address);
    (result.workbook.sheets[address.sheetId]!.cellData[address.row] ??= {})[address.column] = cell;
  }
  return requireTable(result);
}
export async function sheetStructureCommand(snapshot: ArtifactSnapshot, sheetId: string, axis: 'row' | 'column', action: 'insert' | 'remove' | 'move', position: number, beforePosition: number | null, reason: string): Promise<CommandGroupDraft> {
  const content = requireTable(snapshot.content), ids = content.stableIds[sheetId]?.[axis === 'row' ? 'rows' : 'columns'];
  if (!ids || position < 0 || position >= ids.length || beforePosition !== null && (beforePosition < 0 || beforePosition >= ids.length)) throw new ContentValidationError('sheets.errors.range');
  const makeTarget = axis === 'row' ? tableRowTargetId : tableColumnTargetId;
  const id = action === 'insert' ? crypto.randomUUID() : ids[position]!;
  const targetId = makeTarget(sheetId, id), beforeId = beforePosition === null ? null : makeTarget(sheetId, ids[beforePosition]!);
  const target = await sheetDraft(snapshot).target(targetId);
  const value = action === 'insert' ? { sheetId, axis, id, beforeId, cells: {} } : action === 'move' ? { parentId: tableSheetTargetId(sheetId), beforeId } : undefined;
  return sheetOperationsCommand(snapshot, [{ targetId, op: action, beforeHash: target?.hash ?? null, ...(value ? { value: json(value) } : {}) }], reason);
}
export async function sheetSettingsCommand(snapshot: ArtifactSnapshot, sheetId: string, settings: Record<string, JsonValue>, reason: string) {
  const targetId = tableSheetTargetId(sheetId), target = await sheetDraft(snapshot).target(targetId);
  if (!target) throw new ContentValidationError('missing-sheet');
  return sheetOperationsCommand(snapshot, [{ targetId, op: 'set', beforeHash: target.hash, value: { kind: 'sheet-settings', ...settings } }], reason);
}
export function formattedCell(content: TableContent, address: CellAddress, style: Record<string, JsonValue>) {
  const cell = cellAt(content, address) ?? {};
  const previous = typeof cell.s === 'string' ? content.workbook.styles?.[cell.s] : cell.s;
  return { ...cell, s: { ...previous, ...style } };
}

export async function sheetLockCommand(snapshot: ArtifactSnapshot, address: CellAddress, locked: boolean, reason: string) {
  const targetId = stableCellId(requireTable(snapshot.content), address), target = await sheetDraft(snapshot).target(targetId);
  if (!target) throw new ContentValidationError('missing-target');
  return sheetOperationsCommand(snapshot, [{ targetId, op: 'lock', beforeHash: target.hash, value: { locked, ...(locked ? { reason } : {}) } }], reason);
}

export async function sortSheetCommand(snapshot: ArtifactSnapshot, sheetId: string, column: number, descending: boolean, reason: string): Promise<CommandGroupDraft> {
  const content = requireTable(snapshot.content), sheet = content.workbook.sheets[sheetId]!, ids = content.stableIds[sheetId]!;
  const populated = Object.keys(sheet.cellData).map(Number).filter((row) => row > 0).sort((a, b) => a - b);
  const end = populated.at(-1) ?? 0;
  if (end > 1000) throw new ContentValidationError('sheets.errors.editRange');
  const order = ids.rows.slice(1, end + 1).map((id, index) => ({ id, row: index + 1, value: sheet.cellData[index + 1]?.[column]?.v }));
  order.sort((a, b) => {
    const aEmpty = a.value === null || a.value === undefined || a.value === '', bEmpty = b.value === null || b.value === undefined || b.value === '';
    if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty) || a.row - b.row;
    const compared = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value), 'en', { numeric: true });
    return (descending ? -compared : compared) || a.row - b.row;
  });
  const draft = sheetDraft(snapshot), operations: ArtifactOperation[] = [], metadataAt = new Date().toISOString();
  let beforeId: string | null = ids.rows[end + 1] ? tableRowTargetId(sheetId, ids.rows[end + 1]!) : null;
  for (const item of [...order].reverse()) {
    const targetId = tableRowTargetId(sheetId, item.id), target = await draft.target(targetId);
    const operation: ArtifactOperation = { targetId, op: 'move', beforeHash: target?.hash ?? null, value: { parentId: tableSheetTargetId(sheetId), beforeId } };
    await draft.apply([operation], { actorId: snapshot.viewer.userId, at: metadataAt, origin: 'human', reason }); operations.push(operation); beforeId = targetId;
  }
  return sheetOperationsCommand(snapshot, operations, reason, metadataAt);
}
