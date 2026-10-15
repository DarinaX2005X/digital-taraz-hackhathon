import ExcelJS from 'exceljs';
import type { Locale } from '@/i18n/locales';
import { calculateWorkbook } from '../engine/calculate';
import { requireTable, type TableContent } from '../domain/model';
import { csvField, exportStyle, type CellStyle, type TransferWarning } from './transfer';
import { excelFormulaNames, excelSheetNames } from './excel-names';

const messages = {
  ru: { csv: 'CSV содержит значения выбранного листа. Формулы, оформление и связи остаются в рабочей таблице.', formula: 'В таблице есть формулы с ошибками; файл содержит явные ошибки, а не прежние результаты.', text: 'Текст, похожий на формулу, защищён апострофом при открытии CSV.', chart: 'Связи с источниками и встроенные диаграммы сохраняются в рабочей таблице.' },
  kk: { csv: 'CSV таңдалған парақ мәндерін қамтиды. Формулалар, пішімдеу және байланыстар жұмыс кестесінде қалады.', formula: 'Кестеде қате формулалар бар; файлда бұрынғы нәтижелер емес, қателер көрсетілген.', text: 'Формулаға ұқсас мәтін CSV ашылғанда апострофпен қорғалады.', chart: 'Дереккөз байланыстары мен кірістірілген диаграммалар жұмыс кестесінде сақталады.' },
  en: { csv: 'CSV contains the selected sheet’s values. Formulas, formatting and links remain in the working table.', formula: 'Some formulas have errors; the file includes explicit errors instead of stale results.', text: 'Formula-like text is protected with an apostrophe when opening CSV.', chart: 'Source bindings and embedded charts remain in the working table.' },
};

export async function exportTable(input: TableContent, options: { format: 'xlsx' | 'csv'; sheetId?: string; locale: Locale; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; mediaType: string; extension: string; warnings: TransferWarning[] }> {
  const calculation = await calculateWorkbook(requireTable(input), { signal: options.signal });
  const content = calculation.content, copy = messages[options.locale], warnings: TransferWarning[] = [];
  if (calculation.diagnostics.length) warnings.push({ code: 'formula-errors', message: copy.formula });
  options.signal?.throwIfAborted();
  if (options.format === 'csv') {
    const sheetId = options.sheetId ?? (content.workbook.sheetOrder.length === 1 ? content.workbook.sheetOrder[0] : undefined);
    if (!sheetId || !content.workbook.sheets[sheetId]) throw new Error('sheets.errors.selectExportSheet');
    const sheet = content.workbook.sheets[sheetId]!;
    let maxRow = -1, maxColumn = -1, protectedText = false;
    for (const [r, cells] of Object.entries(sheet.cellData)) for (const [c, cell] of Object.entries(cells)) {
      if (cell.v !== undefined && cell.v !== null || cell.f) { maxRow = Math.max(maxRow, Number(r)); maxColumn = Math.max(maxColumn, Number(c)); }
      if (typeof cell.v === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(cell.v)) protectedText = true;
    }
    const lines = Array.from({ length: maxRow + 1 }, (_, r) => Array.from({ length: maxColumn + 1 }, (_, c) => csvField(sheet.cellData[r]?.[c]?.v)).join(','));
    warnings.push({ code: 'csv-values-only', message: copy.csv });
    if (protectedText) warnings.push({ code: 'csv-protected-text', message: copy.text });
    return { bytes: new TextEncoder().encode(`\uFEFF${lines.join('\r\n')}\r\n`), mediaType: 'text/csv; charset=utf-8', extension: 'csv', warnings };
  }
  const book = new ExcelJS.Workbook(); book.creator = 'Tirlik'; book.calcProperties.fullCalcOnLoad = true;
  const names = excelSheetNames(content);
  for (const sheetId of content.workbook.sheetOrder) {
    options.signal?.throwIfAborted();
    const source = content.workbook.sheets[sheetId]!;
    const outputName = names.get(source.name.toLocaleLowerCase('en-US'))!;
    const sheet = book.addWorksheet(outputName);
    if (outputName !== source.name) warnings.push({ code: 'excel-sheet-name', targetId: sheetId, message: `${source.name} → ${outputName}` });
    if (source.freeze) sheet.views = [{ state: 'frozen', xSplit: source.freeze.xSplit, ySplit: source.freeze.ySplit }];
    for (const [r, cells] of Object.entries(source.cellData)) for (const [c, value] of Object.entries(cells)) {
      const cell = sheet.getCell(Number(r) + 1, Number(c) + 1);
      if (value.f) {
        const result = typeof value.v === 'string' && /^#(?:REF!|VALUE!|DIV\/0!|NAME\?|N\/A|NUM!|NULL!|CYCLE!)/.test(value.v) ? { error: (value.v === '#CYCLE!' ? '#VALUE!' : value.v) as ExcelJS.CellErrorValue['error'] } : value.v ?? undefined;
        cell.value = { formula: excelFormulaNames(value.f, names).slice(1), ...(result !== undefined && result !== null ? { result } : {}) };
      } else cell.value = value.v ?? null;
      cell.style = exportStyle(typeof value.s === 'string' ? content.workbook.styles?.[value.s] : value.s as CellStyle | undefined);
    }
    for (const [r, data] of Object.entries(source.rowData ?? {})) if (typeof data.h === 'number') sheet.getRow(Number(r) + 1).height = data.h * 72 / 96;
    for (const [c, data] of Object.entries(source.columnData ?? {})) if (typeof data.w === 'number') sheet.getColumn(Number(c) + 1).width = Math.max(1, (data.w - 5) / 7);
    for (const merge of source.mergeData ?? []) sheet.mergeCells(merge.startRow + 1, merge.startColumn + 1, merge.endRow + 1, merge.endColumn + 1);
  }
  warnings.push({ code: 'working-links-remain', message: copy.chart });
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  options.signal?.throwIfAborted();
  return { bytes, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx', warnings };
}
