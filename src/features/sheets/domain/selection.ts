import type { TableCell } from '@/features/artifacts/domain/content-models';
import type { TableContent } from './model';
import { copyFormula } from './formulas';
export type SheetRange = { sheetId: string; row: number; column: number; endRow: number; endColumn: number };
export function selectedCells(content: TableContent, range: SheetRange, max = 1000) {
  const sheet = content.workbook.sheets[range.sheetId];
  if (!sheet || range.row < 0 || range.column < 0 || range.endRow >= sheet.rowCount || range.endColumn >= sheet.columnCount || (range.endRow - range.row + 1) * (range.endColumn - range.column + 1) > max) throw new Error('sheets.errors.editRange');
  const cells: { address: { sheetId: string; row: number; column: number }; cell: TableCell }[] = [];
  for (let row = range.row; row <= range.endRow; row++) for (let column = range.column; column <= range.endColumn; column++) cells.push({ address: { sheetId: range.sheetId, row, column }, cell: sheet.cellData[row]?.[column] ?? {} });
  return cells;
}
export function selectionStats(content: TableContent, range: SheetRange) {
  let count = 0, sum = 0;
  const sheet = content.workbook.sheets[range.sheetId]; if (!sheet) throw new Error('sheets.errors.range');
  for (const [row, cells] of Object.entries(sheet.cellData)) {
    if (Number(row) < range.row || Number(row) > range.endRow) continue;
    for (const [column, cell] of Object.entries(cells)) if (Number(column) >= range.column && Number(column) <= range.endColumn && typeof cell.v === 'number' && Number.isFinite(cell.v)) { count++; sum += cell.v; }
  }
  return { count, unknown: (range.endRow - range.row + 1) * (range.endColumn - range.column + 1) - count, sum, average: count ? sum / count : null };
}
export function findCells(content: TableContent, sheetId: string, query: string) {
  if (!query) return [];
  const needle = query.toLocaleLowerCase(), sheet = content.workbook.sheets[sheetId];
  if (!sheet) return [];
  return Object.entries(sheet.cellData).flatMap(([row, cells]) => Object.entries(cells).flatMap(([column, cell]) => String(cell.f ?? cell.v ?? '').toLocaleLowerCase().includes(needle) ? [{ sheetId, row: Number(row), column: Number(column), cell }] : []));
}
export function fillDownCells(content: TableContent, range: SheetRange) {
  return selectedCells(content, range).filter(({ address }) => address.row > range.row).map(({ address }) => {
    const original = content.workbook.sheets[range.sheetId]!.cellData[range.row]?.[address.column] ?? {};
    const cell = structuredClone(original);
    if (cell.f) { cell.f = copyFormula(cell.f, address.row - range.row, 0); delete cell.v; delete cell.t; }
    return { address, cell };
  });
}
export function replaceCells(content: TableContent, sheetId: string, query: string, replacement: string) {
  const matches = findCells(content, sheetId, query);
  if (matches.length > 1000) throw new Error('sheets.errors.editRange');
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'gi');
  return matches.map((match) => ({ ...match, value: String(match.cell.f ?? match.cell.v ?? '').replace(pattern, () => replacement) }));
}
