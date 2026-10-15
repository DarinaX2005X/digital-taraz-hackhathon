import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { importTable } from '@/features/sheets/server/import';
import { exportTable } from '@/features/sheets/server/export';
import { createBlankTable } from '@/features/sheets/domain/model';
import { csvField } from '@/features/sheets/server/transfer';

describe('spreadsheet file transfer', () => {
  it('uses the source delimiter convention and rejects excess rows before building the workbook', async () => {
    const imported = await importTable(new TextEncoder().encode('code;price\n001;12.5'), { format: 'csv', fileName: 'data.csv', seed: 'semicolons' });
    const sheet = imported.content.workbook.sheets[imported.content.workbook.sheetOrder[0]!]!;
    expect(sheet.cellData[1]![1]!.v).toBe(12.5);
    await expect(importTable(new TextEncoder().encode('a\n'.repeat(20001)), { format: 'csv', fileName: 'too-many.csv', seed: 'rows' })).rejects.toThrow('importRange');
  });
  it('imports CSV without evaluating formula-like source text or losing leading zeros', async () => {
    const bytes = new TextEncoder().encode('code,value,note\r\n00123,12.5,"a,b"\r\n=SUM(A1:A2),9007199254740993,"line\nline"');
    const result = await importTable(bytes, { format: 'csv', fileName: 'Data.csv', seed: 'same' });
    const sheet = result.content.workbook.sheets[result.content.workbook.sheetOrder[0]!]!;
    expect(sheet.cellData[1]![0]).toEqual({ v: '00123', t: 1 }); expect(sheet.cellData[1]![1]).toEqual({ v: 12.5, t: 2 });
    expect(sheet.cellData[2]![0]).toEqual({ v: '=SUM(A1:A2)', t: 1 }); expect(sheet.cellData[2]![1]!.v).toBe('9007199254740993');
    expect((await importTable(bytes, { format: 'csv', fileName: 'Data.csv', seed: 'same' })).previewHash).toBe(result.previewHash);
  });
  it('round-trips XLSX sheets, basic formatting, merged cells and formula results', async () => {
    const book = new ExcelJS.Workbook(), data = book.addWorksheet('Data'), report = book.addWorksheet('Report');
    data.getCell('A1').value = 10; data.getCell('A2').value = 20; data.getCell('A1').font = { bold: true, color: { argb: 'FF123456' } };
    data.getCell('B1').value = 'Header'; data.mergeCells('B1:C1'); data.getColumn(1).width = 22;
    report.getCell('A1').value = { formula: 'SUM(Data!A1:A2)', result: 999 };
    const imported = await importTable(new Uint8Array(await book.xlsx.writeBuffer()), { format: 'xlsx', fileName: 'book.xlsx', seed: 'xlsx' });
    const table = imported.content, first = table.workbook.sheets[table.workbook.sheetOrder[0]!]!, second = table.workbook.sheets[table.workbook.sheetOrder[1]!]!;
    expect(second.cellData[0]![0]).toMatchObject({ f: '=SUM(Data!A1:A2)', v: 30 }); expect(first.mergeData).toEqual([{ startRow: 0, endRow: 0, startColumn: 1, endColumn: 2 }]);
    expect(first.cellData[0]![0]!.s).toMatchObject({ bl: 1, cl: { rgb: '#123456' } });
    const output = await exportTable(table, { format: 'xlsx', locale: 'en' }), reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Buffer.from(output.bytes) as unknown as Parameters<typeof reopened.xlsx.load>[0]);
    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(['Data', 'Report']); expect(reopened.getWorksheet('Report')!.getCell('A1').result).toBe(30);
    expect(reopened.getWorksheet('Data')!.getCell('A1').font.bold).toBe(true); expect(reopened.getWorksheet('Data')!.getCell('C1').master.address).toBe('B1');
  });
  it('neutralizes formula injection in CSV strings but keeps negative numbers numeric', () => {
    expect(csvField('=1+1')).toBe("'=1+1"); expect(csvField('\t@SUM(A1)')).toBe("'\t@SUM(A1)"); expect(csvField('-42')).toBe("'-42"); expect(csvField(-42)).toBe('-42'); expect(csvField('a,"b"')).toBe('"a,""b"""');
  });
  it('requires a selected sheet for multi-sheet CSV and exports fresh values', async () => {
    const table = createBlankTable('Data'), id = table.workbook.sheetOrder[0]!; table.workbook.sheets[id]!.cellData = { 0: { 0: { v: 3, t: 2 }, 1: { f: '=A1*2', v: 777, t: 2 } } };
    const other = createBlankTable('Other'), otherId = other.workbook.sheetOrder[0]!; table.workbook.sheetOrder.push(otherId); table.workbook.sheets[otherId] = other.workbook.sheets[otherId]!; table.stableIds[otherId] = other.stableIds[otherId]!;
    await expect(exportTable(table, { format: 'csv', locale: 'en' })).rejects.toThrow('selectExportSheet');
    const output = await exportTable(table, { format: 'csv', sheetId: id, locale: 'en' }); expect(new TextDecoder().decode(output.bytes)).toContain('3,6');
  });
});
