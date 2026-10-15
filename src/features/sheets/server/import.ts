import ExcelJS from 'exceljs';
import { parse } from 'csv-parse';
import { createHash } from 'node:crypto';
import type { TableCell } from '@/features/artifacts/domain/content-models';
import { inspectRelationships, readOfficeArchive } from '@/features/sources/server/archive';
import { createBlankTable, MAX_COLUMNS, MAX_ROWS, requireTable, stableCellId, type TableContent } from '../domain/model';
import { inspectFormula } from '../domain/formulas';
import { calculateWorkbook } from '../engine/calculate';
import { importStyle, scalarCell, type TransferWarning } from './transfer';

export type SheetImport = { content: TableContent; warnings: TransferWarning[]; sample: { sheetId: string; name: string; rows: number; columns: number; cells: string[][] }[]; previewHash: string };
export type SheetImportOptions = { format: 'xlsx' | 'csv' | 'tsv'; fileName: string; delimiter?: string; encoding?: 'utf-8' | 'windows-1251'; seed: string; signal?: AbortSignal };
const unsafeFormula = /\b(?:WEBSERVICE|HYPERLINK|IMAGE|IMPORTXML|IMPORTDATA|IMPORTHTML|RTD|DDE|CALL|REGISTER\.ID|EXEC)\s*\(|\[[^\]]+\]|\|/i;

export async function importTable(bytes: Uint8Array, options: SheetImportOptions): Promise<SheetImport> {
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('sheets.errors.importSize');
  options.signal?.throwIfAborted();
  let sequence = 0;
  const id = () => `sheet_${createHash('sha256').update(`${options.seed}:${sequence++}`).digest('hex').slice(0, 24)}`;
  const warnings: TransferWarning[] = [];
  const warn = (code: string, targetId?: string) => { if (warnings.length < 1000 && !warnings.some((item) => item.code === code && item.targetId === targetId)) warnings.push({ code, targetId, message: code }); };
  let content: TableContent;
  if (options.format !== 'xlsx') {
    const text = new TextDecoder(options.encoding ?? 'utf-8', { fatal: true }).decode(bytes);
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = options.delimiter ?? (options.format === 'tsv' ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
    const parser = parse(text, { delimiter, bom: true, relax_column_count: true, skip_empty_lines: false, max_record_size: 1024 * 1024 });
    const rows: string[][] = [];
    try { for await (const record of parser) { const row = record as string[]; options.signal?.throwIfAborted(); if (rows.length >= MAX_ROWS || row.length > MAX_COLUMNS || row.some((value) => value.length > 100000)) throw new Error('sheets.errors.importRange'); rows.push(row); } }
    finally { parser.destroy(); }
    content = createBlankTable(options.fileName.slice(0, 240) || 'Table', { id, rows: Math.max(100, rows.length), columns: Math.max(26, ...rows.map((row) => row.length)) });
    const sheet = content.workbook.sheets[content.workbook.sheetOrder[0]!]!;
    rows.forEach((row, r) => { row.forEach((value, c) => { if (value !== '') (sheet.cellData[r] ??= {})[c] = scalarCell(value); }); });
  } else {
    const archive = await readOfficeArchive(Buffer.from(bytes)); inspectRelationships(archive);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof book.xlsx.load>[0]);
    if (!book.worksheets.length || book.worksheets.length > 100) throw new Error('sheets.errors.importRange');
    content = createBlankTable(options.fileName.slice(0, 240) || 'Workbook', { id });
    content.workbook.sheets = {}; content.workbook.sheetOrder = []; content.stableIds = {};
    if (book.properties.date1904) warn('dateSystem1904');
    for (const source of book.worksheets) {
      options.signal?.throwIfAborted();
      if (source.rowCount > MAX_ROWS || source.columnCount > MAX_COLUMNS) throw new Error('sheets.errors.importRange');
      const table = createBlankTable(source.name, { id, rows: Math.max(100, source.rowCount), columns: Math.max(26, source.columnCount) });
      const sheetId = table.workbook.sheetOrder[0]!, sheet = table.workbook.sheets[sheetId]!;
      content.workbook.sheetOrder.push(sheetId); content.workbook.sheets[sheetId] = sheet; content.stableIds[sheetId] = table.stableIds[sheetId]!;
      source.eachRow({ includeEmpty: false }, (sourceRow, r) => {
        if (sourceRow.height) (sheet.rowData ??= {})[r - 1] = { h: sourceRow.height * 96 / 72 };
        sourceRow.eachCell({ includeEmpty: false }, (sourceCell, c) => {
          if (sourceCell.isMerged && sourceCell.master.address !== sourceCell.address) return;
          const address = { sheetId, row: r - 1, column: c - 1 }, targetId = stableCellId(content, address);
          let cell: TableCell = {};
          const value = sourceCell.value;
          if (sourceCell.formula) {
            const formula = `=${sourceCell.formula}`;
            if (unsafeFormula.test(formula)) { cell = { v: formula, t: 1 }; warn('unsafeFormulaAsText', targetId); }
            else cell = { f: formula };
          } else if (value instanceof Date) {
            // ExcelJS resolves both workbook date systems to UTC. Store the
            // corresponding 1900-system serial, including the leap-year offset.
            let serial = value.getTime() / 86400000 + 25569;
            if (serial < 61) serial -= 1;
            cell = { v: serial, t: 2 };
          } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') cell = { v: value, t: typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : 1 };
          else if (value && typeof value === 'object' && 'richText' in value) { cell = { v: value.richText.map((run) => run.text).join(''), t: 1 }; warn('richTextFlattened', targetId); }
          else if (value && typeof value === 'object' && 'hyperlink' in value) { cell = { v: value.text, t: 1 }; warn('hyperlinkAsText', targetId); }
          else if (value && typeof value === 'object' && 'error' in value) cell = { v: value.error, t: 1 };
          const style = importStyle(sourceCell.style); if (style) cell.s = style;
          if (sourceCell.style.font?.color?.theme !== undefined || sourceCell.style.fill?.type === 'gradient') warn('styleSimplified', targetId);
          if (sourceCell.note) warn('commentsOmitted', targetId);
          (sheet.cellData[r - 1] ??= {})[c - 1] = cell;
        });
      });
      (source.columns ?? []).forEach((column, c) => { if (column.width) (sheet.columnData ??= {})[c] = { w: Math.round(column.width * 7 + 5) }; });
      sheet.mergeData = (source.model.merges ?? []).map((range) => {
        const [from, to] = range.split(':');
        const a = source.getCell(from!), b = source.getCell(to ?? from!);
        return { startRow: Number(a.row) - 1, endRow: Number(b.row) - 1, startColumn: Number(a.col) - 1, endColumn: Number(b.col) - 1 };
      });
      const frozen = (source.views ?? []).find((view) => view.state === 'frozen');
      if (frozen?.state === 'frozen') { const x = Math.min(sheet.columnCount, frozen.xSplit ?? 0), y = Math.min(sheet.rowCount, frozen.ySplit ?? 0); sheet.freeze = { xSplit: x, ySplit: y, startColumn: x - 1, startRow: y - 1 }; }
      if (source.getImages().length) warn('imagesOmitted', sheetId);
      if (source.state !== 'visible') warn('hiddenSheetVisible', sheetId);
    }
    // All sheet names are available before validating cross-sheet formula references.
    for (const [sheetId, sheet] of Object.entries(content.workbook.sheets)) for (const [row, cells] of Object.entries(sheet.cellData)) for (const [column, cell] of Object.entries(cells)) if (cell.f) {
      const issue = inspectFormula(cell.f, content, sheetId).issue;
      if (issue) warn(`formula:${issue.code}`, stableCellId(content, { sheetId, row: Number(row), column: Number(column) }));
    }
    if ([...archive.keys()].some((path) => path.startsWith('xl/charts/'))) warn('chartsOmitted');
    if ([...archive.keys()].some((path) => path.startsWith('xl/pivot'))) warn('pivotTablesOmitted');
  }
  content = (await calculateWorkbook(requireTable(content), { signal: options.signal })).content;
  const sample = content.workbook.sheetOrder.map((sheetId) => { const sheet = content.workbook.sheets[sheetId]!; return { sheetId, name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount, cells: Array.from({ length: Math.min(8, sheet.rowCount) }, (_, row) => Array.from({ length: Math.min(8, sheet.columnCount) }, (_, column) => String(sheet.cellData[row]?.[column]?.v ?? ''))) }; });
  const previewHash = createHash('sha256').update(JSON.stringify({ content, warnings })).digest('hex');
  return { content, warnings, sample, previewHash };
}
