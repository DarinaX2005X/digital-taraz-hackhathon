import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createBlankTable } from '../../src/features/sheets/domain/model';
import { sheetExportAdapter } from '../../src/features/exports/server/sheets';
import { documentInput } from './fixture';

describe('sheet adapter contract', () => {
  it('keeps source text with leading zeroes beside numeric and formula cells', async () => {
    const content = createBlankTable('Prices'), sheetId = content.workbook.sheetOrder[0]!;
    content.workbook.sheets[sheetId]!.cellData = {
      0: {
        0: { v: '00123', t: 1 },
        1: { v: 2.5, t: 2 },
        2: { f: '=B1*2', v: 999, t: 2 },
      },
    };
    const rendered = await sheetExportAdapter.render({
      ...documentInput(),
      content,
      title: 'Prices',
      format: 'xlsx',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(rendered.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Prices')!;
    expect(sheet.getCell('A1').value).toBe('00123');
    expect(sheet.getCell('B1').value).toBe(2.5);
    expect(sheet.getCell('C1').formula).toBe('B1*2');
    expect(sheet.getCell('C1').result).toBe(5);
  });
});
