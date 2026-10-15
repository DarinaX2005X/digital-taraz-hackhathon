import { z } from 'zod';
import type { ArtifactContent, TableCell } from '@/features/artifacts/domain/content-models';
import { validateArtifactContent, validateTableCell } from '@/features/artifacts/domain/semantic-validation';
import { tableCellTargetId } from '@/features/artifacts/domain/targets';

export type TableContent = Extract<ArtifactContent, { kind: 'table' }>;
export type Workbook = TableContent['workbook'];
export type CellAddress = { sheetId: string; row: number; column: number };
export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 100;

export function requireTable(input: unknown): TableContent {
  const content = validateArtifactContent(input);
  if (content.kind !== 'table') throw new Error('sheets.errors.notTable');
  return content;
}

export function createBlankTable(name = 'Sheet 1', options: { rows?: number; columns?: number; id?: () => string } = {}): TableContent {
  const id = options.id ?? (() => crypto.randomUUID());
  const sheetId = id();
  const rows = options.rows ?? 100, columns = options.columns ?? 26;
  return requireTable({ kind: 'table', schemaVersion: 1,
    workbook: { id: id(), name, appVersion: '1.0.4', locale: 'enUS', sheetOrder: [sheetId], sheets: {
      [sheetId]: { id: sheetId, name, rowCount: rows, columnCount: columns, cellData: {} },
    } }, stableIds: { [sheetId]: { rows: Array.from({ length: rows }, id), columns: Array.from({ length: columns }, id) } },
  });
}

export function stableCellId(content: TableContent, address: CellAddress): string {
  const ids = content.stableIds[address.sheetId];
  const row = ids?.rows[address.row], column = ids?.columns[address.column];
  if (!row || !column) throw new Error('sheets.errors.range');
  return tableCellTargetId(address.sheetId, row, column);
}

export function cellAt(content: TableContent, address: CellAddress): TableCell | undefined {
  return content.workbook.sheets[address.sheetId]?.cellData[address.row]?.[address.column];
}

export function columnLabel(index: number): string {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}

export function addressLabel(address: CellAddress): string { return `${columnLabel(address.column)}${address.row + 1}`; }

/** Raw source strings remain strings. Only explicit editor input interprets numbers/formulas. */
export function editorCell(input: string, previous?: TableCell): TableCell {
  const style = previous?.s === undefined ? {} : { s: previous.s };
  if (input.startsWith('=')) return validateTableCell({ ...style, f: input });
  if (input.startsWith("'")) return { ...style, v: input.slice(1), t: 1 };
  if (input === '') return style;
  if (/^[+-]?(?:0|[1-9]\d*)(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(input)) {
    const number = Number(input.replace(',', '.'));
    if (Number.isFinite(number) && input.replace(/[^0-9]/g, '').length <= 15) return { ...style, v: number, t: 2 };
  }
  return { ...style, v: input, t: 1 };
}

export const ColumnUnitSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('number') }),
  z.strictObject({ kind: z.literal('money'), currency: z.string().regex(/^[A-Z]{3}$/), date: z.iso.date().optional() }),
  z.strictObject({ kind: z.literal('quantity'), unit: z.string().trim().min(1).max(40) }),
  z.strictObject({ kind: z.literal('date') }),
  z.strictObject({ kind: z.literal('text') }),
]);
export type ColumnUnit = z.infer<typeof ColumnUnitSchema>;

export function columnUnit(content: TableContent, sheetId: string, column: number): ColumnUnit | undefined {
  const raw = content.workbook.sheets[sheetId]?.columnData?.[column]?.tirlikUnit;
  const result = ColumnUnitSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
