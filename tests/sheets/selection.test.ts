import { describe, expect, it } from 'vitest';
import { createBlankTable } from '@/features/sheets/domain/model';
import { fillDownCells, replaceCells, selectedCells, selectionStats } from '@/features/sheets/domain/selection';
import { excelFormulaNames, excelSheetNames } from '@/features/sheets/server/excel-names';
describe('sheet range operations', () => {
  it('fills formulas with relative row offsets, preserves anchors, and drops cached results', () => {
    const content = createBlankTable('Data'), sheetId = content.workbook.sheetOrder[0]!;
    content.workbook.sheets[sheetId]!.cellData = { 0: { 0: { f: '=$B1+C$2', v: 999, t: 2, s: { bl: 1 } } } };
    expect(fillDownCells(content, { sheetId, row: 0, column: 0, endRow: 2, endColumn: 0 }).map((item) => item.cell)).toEqual([{ f: '=$B2+C$2', s: { bl: 1 } }, { f: '=$B3+C$2', s: { bl: 1 } }]);
  });
  it('replaces literal query text case-insensitively without treating dollar values as patterns', () => {
    const content = createBlankTable('Data'), sheetId = content.workbook.sheetOrder[0]!;
    content.workbook.sheets[sheetId]!.cellData = { 0: { 0: { v: 'a.b and A.B', t: 1 } } };
    expect(replaceCells(content, sheetId, 'a.b', '$&')[0]!.value).toBe('$& and $&');
  });
  it('bounds edits and computes coverage without counting numeric-looking text', () => {
    const content = createBlankTable('Data'), sheetId = content.workbook.sheetOrder[0]!;
    content.workbook.sheets[sheetId]!.cellData = { 0: { 0: { v: 2, t: 2 }, 1: { v: '3', t: 1 } }, 1: { 0: { v: 4, t: 2 } } };
    expect(selectionStats(content, { sheetId, row: 0, column: 0, endRow: 1, endColumn: 1 })).toEqual({ count: 2, unknown: 2, sum: 6, average: 3 });
    expect(() => selectedCells(content, { sheetId, row: 0, column: 0, endRow: 99, endColumn: 25 })).toThrow('editRange');
  });
  it('rewrites only actual sheet references after safe unique Excel names are chosen', () => {
    const long = 'Very long business worksheet title one', secondName = 'Very long business worksheet title two';
    const table = createBlankTable(long), second = createBlankTable(secondName), secondId = second.workbook.sheetOrder[0]!;
    table.workbook.sheets[secondId] = second.workbook.sheets[secondId]!; table.workbook.sheetOrder.push(secondId); table.stableIds[secondId] = second.stableIds[secondId]!;
    const names = excelSheetNames(table), firstName = names.get(long.toLowerCase())!, nextName = names.get(secondName.toLowerCase())!;
    expect(firstName.length).toBeLessThanOrEqual(31); expect(nextName.length).toBeLessThanOrEqual(31); expect(firstName).not.toBe(nextName);
    expect(excelFormulaNames(`=IF(A1="${long}",'${long}'!$A$2,'${secondName}'!B3)`, names)).toBe(`=IF(A1="${long}",'${firstName}'!$A$2,'${nextName}'!B3)`);
  });
});
