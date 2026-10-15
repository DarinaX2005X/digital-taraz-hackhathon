import { describe, expect, it } from 'vitest';
import { createBlankTable, stableCellId } from '@/features/sheets/domain/model';
import { calculateWorkbook } from '@/features/sheets/engine/calculate';
function exactTable() {
  const table = createBlankTable('Estimate', { rows: 10, columns: 6 }), id = table.workbook.sheetOrder[0]!, sheet = table.workbook.sheets[id]!;
  const cellId = (row: number, column: number) => stableCellId(table, { sheetId: id, row, column });
  sheet.cellData = { 0: { 0: { v: 2.5, t: 2 }, 1: { v: 19.99, t: 2 }, 2: { f: '=ROUND(A1*B1,2)' }, 3: { f: '=C1+1' } }, 1: { 0: { v: 1, t: 2 }, 1: { v: 0.1, t: 2 }, 2: { f: '=ROUND(A2*B2,2)' } }, 2: { 2: { f: '=SUM(C1:C2)' } }, 3: { 2: { f: '=C3' } }, 4: { 3: { f: '=SUM(C1:C2)' } } };
  sheet.calculation = { schemaVersion: 1, currency: 'KZT', scale: 2, rounding: 'half-up', lines: [{ id: 'line1', quantityCellId: cellId(0, 0), priceCellId: cellId(0, 1), amountCellId: cellId(0, 2), expectedFormula: '=ROUND(A1*B1,2)' }, { id: 'line2', quantityCellId: cellId(1, 0), priceCellId: cellId(1, 1), amountCellId: cellId(1, 2), expectedFormula: '=ROUND(A2*B2,2)' }], subtotalCellId: cellId(2, 2), subtotalFormula: '=SUM(C1:C2)', totalCellId: cellId(3, 2), totalFormula: '=C3' };
  return { table, id, sheet };
}
describe('exact commercial outputs inside the spreadsheet engine', () => {
  it('keeps exact half-up output and calculates ordinary dependants from that value', async () => {
    const { table, id } = exactTable(), result = await calculateWorkbook(table), sheet = result.content.workbook.sheets[id]!;
    expect(sheet.cellData[0]![2]).toMatchObject({ f: '=ROUND(A1*B1,2)', v: '49.98', t: 1 });
    expect(sheet.cellData[0]![3]!.v).toBe(50.98); expect(sheet.cellData[4]![3]!.v).toBeCloseTo(50.08, 10); expect(sheet.cellData[3]![2]!.v).toBe('50.08');
    expect(result.diagnostics).toEqual([]);
  });
  it('propagates an unrepresentable exact amount as NUM to ordinary dependants', async () => {
    const { table, id, sheet } = exactTable(); sheet.cellData[0]![0] = { v: '9007199254740993', t: 1 }; sheet.cellData[0]![1] = { v: 1, t: 2 };
    const result = await calculateWorkbook(table);
    expect(result.content.workbook.sheets[id]!.cellData[0]![2]!.v).toBe('9007199254740993.00');
    expect(result.content.workbook.sheets[id]!.cellData[0]![3]!.v).toBe('#NUM!');
  });
  it('leaves a customized output formula under ordinary spreadsheet semantics', async () => {
    const { table, id, sheet } = exactTable(); sheet.cellData[0]![2] = { f: '=7' };
    const result = await calculateWorkbook(table); expect(result.content.workbook.sheets[id]!.cellData[0]![2]).toMatchObject({ f: '=7', v: 7 });
    expect(result.content.workbook.sheets[id]!.cellData[0]![3]!.v).toBe(8);
  });
});
