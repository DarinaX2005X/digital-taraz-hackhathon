import ExcelJS from 'exceljs';
import type { JsonValue, TableCell } from '@/features/artifacts/domain/content-models';

export type TransferWarning = { code: string; targetId?: string; message: string };
export type CellStyle = Record<string, JsonValue>;
const rgb = (color: Partial<ExcelJS.Color> | undefined) => color?.argb && /^(?:[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(color.argb) ? `#${color.argb.slice(-6)}` : undefined;

/** Theme/indexed colors without a resolved RGB are reported by the importer. */
export function importStyle(style: Partial<ExcelJS.Style>): CellStyle | undefined {
  const result: CellStyle = {};
  const font = style.font, alignment = style.alignment;
  if (font?.name) result.ff = font.name;
  if (font?.size) result.fs = font.size;
  if (font?.bold) result.bl = 1;
  if (font?.italic) result.it = 1;
  if (font?.strike) result.st = { s: 1 };
  if (font?.underline) result.ul = { s: 1 };
  const foreground = rgb(font?.color); if (foreground) result.cl = { rgb: foreground };
  if (style.fill?.type === 'pattern' && style.fill.pattern === 'solid') { const color = rgb(style.fill.fgColor); if (color) result.bg = { rgb: color }; }
  if (alignment?.horizontal) result.ht = { left: 1, center: 2, right: 3, justify: 4, fill: 1, centerContinuous: 2, distributed: 4 }[alignment.horizontal];
  if (alignment?.vertical) result.vt = { top: 1, middle: 2, bottom: 3, justify: 2, distributed: 2 }[alignment.vertical];
  if (alignment?.wrapText) result.tb = 3;
  if (style.numFmt && style.numFmt !== 'General') result.n = { pattern: style.numFmt };
  if (style.border) {
    const border: CellStyle = {};
    for (const [excel, univer] of [['top', 't'], ['right', 'r'], ['bottom', 'b'], ['left', 'l']] as const) {
      const edge = style.border[excel];
      if (edge?.style) border[univer] = { s: edge.style === 'double' ? 6 : edge.style === 'thick' ? 3 : edge.style === 'medium' ? 2 : 1, cl: { rgb: rgb(edge.color) ?? '#222222' } };
    }
    if (Object.keys(border).length) result.bd = border;
  }
  return Object.keys(result).length ? result : undefined;
}

function record(value: JsonValue | undefined): Record<string, JsonValue> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined; }
const exportColor = (value: JsonValue | undefined): Partial<ExcelJS.Color> | undefined => { const color = record(value)?.rgb; return typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color) ? { argb: `FF${color.slice(1).toUpperCase()}` } : undefined; };

export function exportStyle(style: CellStyle | undefined): Partial<ExcelJS.Style> {
  if (!style) return {};
  const result: Partial<ExcelJS.Style> = {};
  result.font = { ...(typeof style.ff === 'string' ? { name: style.ff } : {}), ...(typeof style.fs === 'number' ? { size: style.fs } : {}), bold: style.bl === 1, italic: style.it === 1, underline: record(style.ul)?.s === 1, strike: record(style.st)?.s === 1, color: exportColor(style.cl) };
  const background = exportColor(style.bg); if (background) result.fill = { type: 'pattern', pattern: 'solid', fgColor: background };
  result.alignment = { horizontal: ({ 1: 'left', 2: 'center', 3: 'right', 4: 'justify' } as const)[Number(style.ht) as 1] ?? 'left', vertical: ({ 1: 'top', 2: 'middle', 3: 'bottom' } as const)[Number(style.vt) as 1] ?? 'bottom', wrapText: style.tb === 3 };
  const pattern = record(style.n)?.pattern; if (typeof pattern === 'string') result.numFmt = pattern;
  const border = record(style.bd);
  if (border) {
    result.border = {};
    for (const [excel, univer] of [['top', 't'], ['right', 'r'], ['bottom', 'b'], ['left', 'l']] as const) {
      const edge = record(border[univer]); if (edge) result.border[excel] = { style: edge.s === 6 ? 'double' : edge.s === 3 ? 'thick' : edge.s === 2 ? 'medium' : 'thin', color: exportColor(edge.cl) };
    }
  }
  return result;
}

export function scalarCell(value: string): TableCell {
  // Source strings beginning with =,+,-,@ never become executable formulas.
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value.replace(/\D/g, '').length <= 15 && Number.isFinite(Number(value))) return { v: Number(value), t: 2 };
  return { v: value, t: 1 };
}

export function csvField(value: TableCell['v']): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Only untrusted text gets an apostrophe; actual negative numbers stay numeric.
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
