import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import type { DocumentNode } from '../../../artifacts/domain/content-models';
import { IdentityError } from '../../../identity/server/http';
import type { RenderInput, RenderedFile } from '../types';
import { prepareDocumentFonts } from './custom-fonts';
import { EXPORT_MAX_BYTES } from '../storage';
import { exportColor } from './colors';

interface Style { size: number; bold: boolean; italic: boolean; color: string; family?: string; background?: string; underline?: boolean; strike?: boolean; href?: string }
interface Run { text: string; style: Style; width: number }
interface Line { type: 'line'; runs: Run[]; height: number; width: number; align: string }
interface Picture { type: 'image'; data: Buffer; width: number; height: number }
interface Gap { type: 'gap'; height: number }
interface ForcedBreak { type: 'break'; height: 0 }
interface Grid { type: 'grid'; height: number; width: number; leaves: { unit: Line | Picture; x: number; y: number; width: number }[]; boxes: { x: number; y: number; width: number; height: number; header: boolean }[]; breaks: number[]; rowEnds: number[]; headerHeight: number }
type Unit = Line | Picture | Gap | ForcedBreak | Grid;
const numeric = (node: DocumentNode, key: string, fallback: number) => typeof node.attrs?.[key] === 'number' ? node.attrs[key] as number : fallback;
const string = (node: DocumentNode, key: string, fallback = '') => typeof node.attrs?.[key] === 'string' ? node.attrs[key] as string : fallback;
const defaultStyle: Style = { size: 11, bold: false, italic: false, color: '#18212F' };
const color = (value: unknown) => exportColor(value) ? value as string : undefined;

export async function renderPdf(input: RenderInput): Promise<RenderedFile> {
  if (input.content.kind !== 'document') throw new IdentityError('VALIDATION_FAILED', 'exports.errors.formatUnavailable');
  const fonts = await prepareDocumentFonts(input), warnings = fonts.warnings, layout = input.options.layout;
  const margin = layout.marginMm * 72 / 25.4, pdf = new PDFDocument({ autoFirstPage: false, bufferPages: true, compress: true, info: { Title: input.title, Author: 'Tirlik', CreationDate: new Date(input.createdAt), Subject: `Immutable revision ${input.revision}` } });
  pdf.registerFont('body', fonts.builtin.regular); pdf.registerFont('bold', fonts.builtin.bold);
  for (const [family, face] of fonts.faces) if (family !== 'Noto Sans') pdf.registerFont(family, face.regular);
  const chunks: Buffer[] = []; let byteSize = 0;
  const completed = new Promise<Buffer>((resolve, reject) => { pdf.on('data', (part: Buffer) => { byteSize += part.length; if (byteSize > EXPORT_MAX_BYTES) { pdf.destroy(new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooLarge')); return; } chunks.push(part); }); pdf.on('error', reject); pdf.on('end', () => resolve(Buffer.concat(chunks))); });
  // Attach rejection immediately, including when layout fails before awaiting the stream.
  void completed.catch(() => undefined);
  let pageCount = 0, y = margin, width = 0, bottom = 0;
  const page = () => { input.signal?.throwIfAborted(); if (++pageCount > 1000) throw new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooLarge'); pdf.addPage({ size: layout.pageSize, layout: layout.orientation, margins: { top: margin, bottom: margin, left: margin, right: margin } }); width = pdf.page.width - 2 * margin; bottom = pdf.page.height - margin; y = margin; };
  const font = (style: Style) => { const family = fonts.resolve(style.family); return pdf.font(family === 'Noto Sans' ? style.bold ? 'bold' : 'body' : family).fontSize(style.size); };
  const measure = (value: string, style: Style) => { font(style); return pdf.widthOfString(value); };
  function runs(node: DocumentNode, inherited: Style): { text: string; style: Style }[] {
    if (node.type === 'hardBreak') return [{ text: '\n', style: inherited }];
    if (node.type !== 'text' && node.type !== 'dataField') return (node.content ?? []).flatMap((child) => runs(child, inherited));
    const style = { ...inherited };
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') style.bold = true; if (mark.type === 'italic') style.italic = true; if (mark.type === 'underline') style.underline = true; if (mark.type === 'strike') style.strike = true;
      if (mark.type === 'link') { style.href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : undefined; style.underline = true; }
      if (mark.type === 'code') style.background = '#F1F3F5';
      if (mark.type === 'textStyle') { if (typeof mark.attrs?.fontSize === 'number') style.size = mark.attrs.fontSize; if (typeof mark.attrs?.fontFamily === 'string') style.family = mark.attrs.fontFamily; style.color = color(mark.attrs?.color) ?? style.color; style.background = color(mark.attrs?.backgroundColor) ?? style.background; }
    }
    return [{ text: node.type === 'dataField' ? string(node, 'value') : node.text ?? '', style }];
  }
  function lines(node: DocumentNode, available: number, prefix = ''): Line[] {
    const size = node.type === 'heading' ? [24, 20, 17, 14, 12, 11][numeric(node, 'level', 1) - 1] ?? 11 : 11;
    const base = { ...defaultStyle, size, bold: node.type === 'heading' }, source = [...(prefix ? [{ text: prefix, style: base }] : []), ...runs(node, base)];
    const result: Line[] = []; let current: Run[] = [], currentWidth = 0, height = size * 1.4;
    const flush = (last = false) => { const align = string(node, 'textAlign', 'left'); result.push({ type: 'line', runs: current, height, width: currentWidth, align: last && align === 'justify' ? 'left' : align }); current = []; currentWidth = 0; height = size * 1.4; };
    const add = (value: string, style: Style) => { const valueWidth = measure(value, style); current.push({ text: value, style, width: valueWidth }); currentWidth += valueWidth; height = Math.max(height, style.size * 1.4); };
    for (const run of source) {
      const tokens = run.text.split(/(\r\n|\r|\n|[^\S\r\n]+)/u).filter(Boolean);
      for (const token of tokens) {
        if (/^[\r\n]+$/.test(token)) { flush(true); continue; }
        const tokenWidth = measure(token, run.style);
        if (currentWidth + tokenWidth <= available) { add(token, run.style); continue; }
        if (current.length) flush();
        if (tokenWidth <= available) { add(token, run.style); continue; }
        // Break a long URL or word by grapheme, preserving every character.
        for (const { segment } of new Intl.Segmenter(input.locale, { granularity: 'grapheme' }).segment(token)) { const segmentWidth = measure(segment, run.style); if (segmentWidth > available) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooWide'); if (currentWidth + segmentWidth > available && current.length) flush(); add(segment, run.style); }
      }
    }
    if (current.length || !result.length) flush(true); return result;
  }
  async function picture(node: DocumentNode, available: number): Promise<Picture> {
    const asset = await input.assets.image(string(node, 'assetId')), data = ['image/png', 'image/jpeg'].includes(asset.mediaType) ? Buffer.from(asset.bytes) : await sharp(asset.bytes).png().toBuffer();
    const requestedWidth = numeric(node, 'width', asset.width) * 0.75, requestedHeight = numeric(node, 'height', requestedWidth / 0.75 * asset.height / asset.width) * 0.75, factor = Math.min(1, available / requestedWidth, (bottom - margin - 24) / requestedHeight);
    return { type: 'image', data, width: requestedWidth * factor, height: requestedHeight * factor };
  }
  async function units(nodes: DocumentNode[], available: number, depth = 0): Promise<Unit[]> {
    const result: Unit[] = [];
    for (const node of nodes) {
      input.signal?.throwIfAborted();
      if (node.type === 'image') result.push(await picture(node, available));
      else if (node.type === 'bulletList' || node.type === 'orderedList') {
        let n = numeric(node, 'start', 1);
        for (const item of node.content ?? []) { const children = item.content ?? [], first = children[0]; if (first) result.push(...lines(first, available, `${'  '.repeat(depth)}${node.type === 'orderedList' ? `${n++}.` : '•'} `)); result.push(...await units(children.slice(1), available, depth + 1)); }
      } else if (node.type === 'blockquote') result.push(...await units(node.content ?? [], available, depth));
      else if (node.type === 'table') result.push(await layoutTable(node, available));
      else if (node.type === 'pageBreak') result.push({ type: 'break', height: 0 });
      else result.push(...lines(node, available));
      result.push({ type: 'gap', height: 5 });
    }
    return result;
  }
  function draw(unit: Unit, x: number, top: number, available: number) {
    if (unit.type === 'gap' || unit.type === 'break') return;
    if (unit.type === 'grid') { drawGrid(unit, x, top, 0, unit.height); return; }
    if (unit.type === 'image') { pdf.image(unit.data, x, top, { width: unit.width, height: unit.height }); return; }
    let offset = unit.align === 'right' ? available - unit.width : unit.align === 'center' ? (available - unit.width) / 2 : 0;
    const spaces = unit.runs.reduce((count, run) => count + (run.text.match(/ /g)?.length ?? 0), 0), spaceExtra = unit.align === 'justify' && spaces ? Math.max(0, available - unit.width) / spaces : 0;
    for (const run of unit.runs) {
      font(run.style);
      const background = exportColor(run.style.background), foreground = exportColor(run.style.color)!;
      if (background) pdf.save().fillColor(`#${background.hex}`, background.alpha).rect(x + offset, top, run.width, unit.height).fill().restore();
      const syntheticBold = run.style.bold && fonts.resolve(run.style.family) !== 'Noto Sans';
      pdf.save().lineWidth(syntheticBold ? 0.22 : 0).strokeColor(`#${foreground.hex}`, foreground.alpha).fillColor(`#${foreground.hex}`, foreground.alpha).text(run.text, x + offset, top, { lineBreak: false, width: Math.max(available, run.width + 1), oblique: run.style.italic, underline: run.style.underline, strike: run.style.strike, link: run.style.href, stroke: syntheticBold, fill: true }).restore(); offset += run.width + spaceExtra * (run.text.match(/ /g)?.length ?? 0);
    }
  }
  function flow(content: Unit[], x: number, available: number) {
    for (const unit of content) { if (unit.type === 'break') { page(); continue; } if (unit.type === 'grid') { flowGrid(unit, x); continue; } if (unit.height > bottom - margin) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooTall'); if (y + unit.height > bottom) page(); draw(unit, x, y, available); y += unit.height; }
  }
  async function layoutTable(node: DocumentNode, available: number): Promise<Grid> {
    const rows = node.content ?? [], occupied: boolean[][] = [], placed: { node: DocumentNode; row: number; column: number; rowSpan: number; columnSpan: number }[] = [];
    let columns = 0;
    rows.forEach((row, rowIndex) => {
      occupied[rowIndex] ??= []; let column = 0;
      for (const cell of row.content ?? []) {
        while (occupied[rowIndex]![column]) column++;
        const rowSpan = numeric(cell, 'rowspan', 1), columnSpan = numeric(cell, 'colspan', 1);
        if (rowIndex + rowSpan > rows.length) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.tableGrid');
        for (let checkedRow = rowIndex; checkedRow < rowIndex + rowSpan; checkedRow++) {
          occupied[checkedRow] ??= [];
          for (let checkedColumn = column; checkedColumn < column + columnSpan; checkedColumn++) {
            if (occupied[checkedRow]![checkedColumn]) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.tableGrid');
            occupied[checkedRow]![checkedColumn] = true;
          }
        }
        placed.push({ node: cell, row: rowIndex, column, rowSpan, columnSpan }); column += columnSpan; columns = Math.max(columns, column);
      }
    });
    if (!columns || rows.some((_, rowIndex) => Array.from({ length: columns }, (_, column) => occupied[rowIndex]?.[column]).some((value) => !value))) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.tableGrid');
    const sizes = Array<number>(columns).fill(available / columns);
    for (const cell of placed) { const specified = cell.node.attrs?.colwidth; if (Array.isArray(specified)) specified.forEach((size, index) => { if (typeof size === 'number') sizes[cell.column + index] = size * 0.75; }); }
    const total = sizes.reduce((left, right) => left + right, 0); for (let column = 0; column < columns; column++) sizes[column] = sizes[column]! * available / total;
    const cells = await Promise.all(placed.map(async (cell) => {
      const cellWidth = sizes.slice(cell.column, cell.column + cell.columnSpan).reduce((left, right) => left + right, 0), x = sizes.slice(0, cell.column).reduce((left, right) => left + right, 0);
      if (cellWidth <= 18) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooWide');
      const content = await units(cell.node.content ?? [], cellWidth - 12);
      return { ...cell, x, width: cellWidth, content, height: content.reduce((totalHeight, unit) => totalHeight + unit.height, 0) + 12 };
    }));
    const rowHeights = Array<number>(rows.length).fill(18);
    for (const cell of cells) if (cell.rowSpan === 1) rowHeights[cell.row] = Math.max(rowHeights[cell.row]!, cell.height);
    for (const cell of cells) {
      const existing = rowHeights.slice(cell.row, cell.row + cell.rowSpan).reduce((left, right) => left + right, 0);
      if (existing < cell.height) rowHeights[cell.row + cell.rowSpan - 1]! += cell.height - existing;
    }
    const starts = [0]; rowHeights.forEach((height) => starts.push(starts.at(-1)! + height));
    const grid: Grid = { type: 'grid', height: starts.at(-1)!, width: available, leaves: [], boxes: [], breaks: [], rowEnds: starts.slice(1), headerHeight: 0 };
    for (const cell of cells) {
      const top = starts[cell.row]!, height = starts[cell.row + cell.rowSpan]! - top;
      grid.boxes.push({ x: cell.x, y: top, width: cell.width, height, header: cell.node.type === 'tableHeader' });
      let cursor = top + 6;
      for (const unit of cell.content) {
        if (unit.type === 'grid') {
          grid.leaves.push(...unit.leaves.map((leaf) => ({ ...leaf, x: leaf.x + cell.x + 6, y: leaf.y + cursor })));
          grid.boxes.push(...unit.boxes.map((box) => ({ ...box, x: box.x + cell.x + 6, y: box.y + cursor })));
          grid.breaks.push(...unit.breaks.map((point) => point + cursor));
        } else if (unit.type === 'break') grid.breaks.push(cursor);
        else if (unit.type !== 'gap') grid.leaves.push({ unit, x: cell.x + 6, y: cursor, width: cell.width - 12 });
        cursor += unit.height;
      }
    }
    let headerRows = 0;
    for (const row of rows) { if (!(row.content?.length && row.content.every((cell) => cell.type === 'tableHeader'))) break; headerRows++; }
    if (headerRows && !placed.some((cell) => cell.row < headerRows && cell.row + cell.rowSpan > headerRows)) grid.headerHeight = starts[headerRows]!;
    if (grid.headerHeight > (bottom - margin) / 3) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.tableHeaderTooTall');
    return grid;
  }
  function drawGrid(grid: Grid, x: number, top: number, from: number, to: number) {
    for (const box of grid.boxes) {
      const start = Math.max(from, box.y), end = Math.min(to, box.y + box.height); if (end <= start) continue;
      const yy = top + start - from;
      pdf.save().lineWidth(0.5).strokeColor('#CBD5E1');
      if (box.header) pdf.fillColor('#EDF1F4').rect(x + box.x, yy, box.width, end - start).fill();
      pdf.moveTo(x + box.x, yy).lineTo(x + box.x, yy + end - start).stroke(); pdf.moveTo(x + box.x + box.width, yy).lineTo(x + box.x + box.width, yy + end - start).stroke();
      if (Math.abs(start - box.y) < 0.01 || start === from) pdf.moveTo(x + box.x, yy).lineTo(x + box.x + box.width, yy).stroke();
      if (Math.abs(end - box.y - box.height) < 0.01 || end === to) pdf.moveTo(x + box.x, yy + end - start).lineTo(x + box.x + box.width, yy + end - start).stroke();
      pdf.restore();
    }
    for (const leaf of grid.leaves) if (leaf.y >= from - 0.01 && leaf.y + leaf.unit.height <= to + 0.01) draw(leaf.unit, x + leaf.x, top + leaf.y - from, leaf.width);
  }
  function flowGrid(grid: Grid, x: number) {
    let cursor = 0;
    const next = () => { page(); if (grid.headerHeight && cursor >= grid.headerHeight) { drawGrid(grid, x, y, 0, grid.headerHeight); y += grid.headerHeight; } };
    while (cursor < grid.height - 0.01) {
      input.signal?.throwIfAborted();
      if (bottom - y < 24) next();
      let end = Math.min(grid.height, cursor + bottom - y);
      const forced = grid.breaks.filter((point) => point > cursor + 0.01 && point < end).sort((left, right) => left - right)[0]; if (forced !== undefined) end = forced;
      const rowBoundary = grid.rowEnds.filter((point) => point > cursor + 0.01 && point <= end).at(-1);
      if (rowBoundary !== undefined && end < grid.height && rowBoundary - cursor >= (end - cursor) / 2) end = rowBoundary;
      for (;;) { const crossing = grid.leaves.filter((leaf) => leaf.y < end - 0.01 && leaf.y + leaf.unit.height > end + 0.01 && leaf.y + leaf.unit.height > cursor); if (!crossing.length) break; const cut = Math.min(...crossing.map((leaf) => leaf.y)); if (cut >= end) break; end = cut; }
      if (end <= cursor + 0.01) {
        if (y > margin + (cursor >= grid.headerHeight ? grid.headerHeight : 0) + 0.01) { next(); continue; }
        throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooTall');
      }
      drawGrid(grid, x, y, cursor, end); y += end - cursor; cursor = end;
      if (cursor < grid.height - 0.01) next();
    }
    y += 8;
  }
  async function table(node: DocumentNode) { flowGrid(await layoutTable(node, width), margin); }
  try {
    page();
    for (const node of input.content.document.content ?? []) { input.signal?.throwIfAborted(); if (node.type === 'pageBreak') page(); else if (node.type === 'table') await table(node); else flow(await units([node], width), margin, width); }
    const range = pdf.bufferedPageRange(), historical = input.historicalDraft ? { ru: 'Исторический черновик', kk: 'Тарихи нобай', en: 'Historical draft' }[input.locale] + ` · v${input.revision}` : '';
    for (let p = range.start; p < range.start + range.count; p++) {
      pdf.switchToPage(p); const header = [historical, layout.headerText].filter(Boolean).join(' · '), footer = [layout.footerText, layout.pageNumbers ? `${p + 1} / ${range.count}` : ''].filter(Boolean).join(' · ');
      pdf.font('body').fontSize(8).fillColor('#64748B');
      if (header) pdf.text(header, margin, 16, { width, lineBreak: false, ellipsis: true });
      if (footer) { const old = pdf.page.margins.bottom; pdf.page.margins.bottom = 0; pdf.text(footer, margin, pdf.page.height - 24, { width, align: 'right', lineBreak: false }); pdf.page.margins.bottom = old; }
    }
    pdf.end(); return { bytes: await completed, mediaType: 'application/pdf', warnings };
  } catch (error) { pdf.destroy(); throw error; }
}
