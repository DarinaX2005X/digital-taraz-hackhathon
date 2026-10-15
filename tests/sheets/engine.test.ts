import { describe, expect, it } from 'vitest';
import { calculateWorkbook } from '@/features/sheets/engine/calculate';
import { copyFormula, inspectFormula } from '@/features/sheets/domain/formulas';
import { createBlankTable, editorCell, stableCellId, type TableContent } from '@/features/sheets/domain/model';

function fixture(): TableContent {
  const table = createBlankTable('Data', { rows: 30, columns: 8 });
  const id = table.workbook.sheetOrder[0]!;
  table.workbook.sheets[id]!.cellData = {
    0: { 0: { v: 10, t: 2 }, 1: { v: 'retail', t: 1 } },
    1: { 0: { v: 20, t: 2 }, 1: { v: 'retail', t: 1 } },
    2: { 0: { v: -5, t: 2 }, 1: { v: 'service', t: 1 } },
    3: { 0: { v: 10, t: 2 }, 1: { v: 'service', t: 1 } },
  };
  const rates = createBlankTable('Rates', { rows: 2, columns: 2 });
  const rateId = rates.workbook.sheetOrder[0]!;
  rates.workbook.sheets[rateId]!.cellData = { 0: { 0: { v: 1.25, t: 2 } } };
  table.workbook.sheetOrder.push(rateId);
  table.workbook.sheets[rateId] = rates.workbook.sheets[rateId]!;
  table.stableIds[rateId] = rates.stableIds[rateId]!;
  return table;
}

describe('the installed Univer calculation engine', () => {
  it('recalculates the complete proven subset and ignores stale imported cache', async () => {
    const table = fixture(), id = table.workbook.sheetOrder[0]!;
    const cases: [string, unknown][] = [
      ['=SUM(A1:A4)', 35], ['=AVERAGE(A1:A4)', 8.75], ['=MIN(A1:A4)', -5], ['=MAX(A1:A4)', 20],
      ['=ROUND(10.126,2)', 10.13], ['=IF(A1>5,"yes","no")', 'yes'], ['=IFERROR(1/0,"invalid")', 'invalid'],
      ['=COUNT(A1:B4)', 4], ['=COUNTA(A1:B4)', 8], ['=COUNTIF(B1:B4,"retail")', 2],
      ['=SUMIF(B1:B4,"retail",A1:A4)', 30], ['=SUMIFS(A1:A4,B1:B4,"retail",A1:A4,">10")', 20],
      ['=(A1+A2)*2-A3/5', 61], ["='Rates'!A1*A1", 12.5], ['=$A$2*2', 40],
    ];
    cases.forEach(([f], row) => { (table.workbook.sheets[id]!.cellData[row] ??= {})[3] = { f, v: 999, t: 2 }; });
    const result = await calculateWorkbook(table);
    expect(result.diagnostics).toEqual([]);
    cases.forEach(([f, expected], row) => expect(result.content.workbook.sheets[id]!.cellData[row]![3]).toMatchObject({ f, v: expected }));
    table.workbook.sheets[id]!.cellData[0]![0] = { v: 30, t: 2 };
    const revised = await calculateWorkbook(table);
    expect(revised.content.workbook.sheets[id]!.cellData[0]![3]!.v).toBe(55);
    expect(revised.content.workbook.sheets[id]!.cellData[13]![3]!.v).toBe(37.5);
    expect(table.workbook.sheets[id]!.cellData[0]![3]!.v).toBe(999);
  });

  it('shows unsupported functions, cycles and arithmetic errors without stale success', async () => {
    const table = fixture(), id = table.workbook.sheetOrder[0]!;
    table.workbook.sheets[id]!.cellData[0]![3] = { f: '=NOT_SUPPORTED(A1)', v: 123, t: 2 };
    table.workbook.sheets[id]!.cellData[1]![3] = { f: '=D3', v: 123, t: 2 };
    table.workbook.sheets[id]!.cellData[2]![3] = { f: '=D2', v: 123, t: 2 };
    table.workbook.sheets[id]!.cellData[3]![3] = { f: '=1/0', v: 123, t: 2 };
    const result = await calculateWorkbook(table);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['unsupported', 'cycle', 'calculation']));
    expect(result.content.workbook.sheets[id]!.cellData[0]![3]!.v).toBe('#NAME?');
    expect(result.content.workbook.sheets[id]!.cellData[3]![3]!.v).toBe('#DIV/0!');
  });

  it('rejects mixed dated currency totals but permits numeric criteria', async () => {
    const table = fixture(), id = table.workbook.sheetOrder[0]!;
    table.workbook.sheets[id]!.columnData = { 0: { tirlikUnit: { kind: 'money', currency: 'KZT', date: '2026-10-14' } }, 1: { tirlikUnit: { kind: 'money', currency: 'USD', date: '2026-10-14' } } };
    table.workbook.sheets[id]!.cellData[0]![3] = { f: '=SUM(A1:B2)' };
    const result = await calculateWorkbook(table);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'unit-mismatch' })]);
    expect(result.content.workbook.sheets[id]!.cellData[0]![3]!.v).toBe('#VALUE!');
  });

  it('propagates a cycle into range totals and chains instead of publishing zero', async () => {
    const table = fixture(), id = table.workbook.sheetOrder[0]!;
    table.workbook.sheets[id]!.cellData = { 0: {
      0: { f: '=B1', v: 300, t: 2 }, 1: { f: '=A1', v: 300, t: 2 },
      2: { f: '=SUM(A1:B1)', v: 600, t: 2 }, 3: { f: '=C1+5' },
      4: { f: '=IFERROR(C1,"Fix source")' }, 5: { f: '=SUM(1,2)' },
    } };
    const result = await calculateWorkbook(table), cells = result.content.workbook.sheets[id]!.cellData[0]!;
    for (const column of [0, 1, 2, 3]) expect(cells[column]).toMatchObject({ v: '#CYCLE!', t: 1 });
    expect(cells[4]!.v).toBe('Fix source');
    expect(cells[5]!.v).toBe(3);
    expect(result.diagnostics.filter((d) => d.code === 'cycle').map((d) => d.column)).toEqual([0, 1]);
    expect(result.diagnostics.filter((d) => d.code === 'calculation').map((d) => d.column)).toEqual([2, 3]);
    expect(table.workbook.sheets[id]!.cellData[0]![0]!.v).toBe(300);
    table.workbook.sheets[id]!.cellData[0]![1] = { v: 7, t: 2 };
    const fixed = await calculateWorkbook(table);
    expect(fixed.diagnostics).toEqual([]);
    expect(fixed.content.workbook.sheets[id]!.cellData[0]![2]!.v).toBe(14);
  });

  it('detects self references and inter-sheet cycles', async () => {
    const table = fixture(), id = table.workbook.sheetOrder[0]!, rates = table.workbook.sheetOrder[1]!;
    table.workbook.sheets[id]!.cellData = { 0: { 0: { f: "='Rates'!A1" }, 1: { f: '=SUM(B1:B2)' } } };
    table.workbook.sheets[rates]!.cellData[0]![0] = { f: "='Data'!A1" };
    const result = await calculateWorkbook(table);
    expect(result.diagnostics.filter((d) => d.code === 'cycle')).toHaveLength(3);
  });
});

describe('formula policy and stable coordinates', () => {
  it('uses engine tokens to distinguish function syntax from quoted text', () => {
    const table = fixture(), id = table.workbook.sheetOrder[0]!;
    expect(inspectFormula('=IF(A1>0,"WEBSERVICE(x)","ok")', table, id).issue).toBeUndefined();
    expect(inspectFormula('=WEBSERVICE("https://example.com")', table, id).issue?.code).toBe('unsafe');
    expect(inspectFormula('=[Other.xlsx]Sheet1!A1', table, id).issue?.code).toBe('unsafe');
    expect(inspectFormula('=Missing!A1', table, id).issue?.code).toBe('reference');
    expect(copyFormula('=$A1+B$2', 1, 2)).toBe('=$A2+D$2');
  });
  it('preserves lexical IDs and large exact values when typing', () => {
    expect(editorCell('00123')).toEqual({ v: '00123', t: 1 });
    expect(editorCell('1234567890123456')).toEqual({ v: '1234567890123456', t: 1 });
    expect(editorCell('12,5')).toEqual({ v: 12.5, t: 2 });
    expect(editorCell("'=SUM(A1:A2)")).toEqual({ v: '=SUM(A1:A2)', t: 1 });
    const table = fixture(), sheetId = table.workbook.sheetOrder[0]!;
    expect(stableCellId(table, { sheetId, row: 0, column: 0 })).not.toBe(stableCellId(table, { sheetId, row: 1, column: 0 }));
  });
});
