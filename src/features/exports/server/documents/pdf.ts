import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import type { DocumentNode } from '../../../artifacts/domain/content-models';
import { IdentityError } from '../../../identity/server/http';
import type { RenderInput, RenderedFile } from '../types';
import { checkDocumentFonts, loadDocumentFonts } from './fonts';
import { EXPORT_MAX_BYTES } from '../storage';

interface Style { size: number; bold: boolean; italic: boolean; color: string; background?: string; underline?: boolean; strike?: boolean; href?: string }
interface Run { text: string; style: Style; width: number }
interface Line { type: 'line'; runs: Run[]; height: number; width: number; align: string }
interface Picture { type: 'image'; data: Buffer; width: number; height: number }
interface Gap { type: 'gap'; height: number }
type Unit = Line | Picture | Gap;
const numeric = (node: DocumentNode, key: string, fallback: number) => typeof node.attrs?.[key] === 'number' ? node.attrs[key] as number : fallback;
const string = (node: DocumentNode, key: string, fallback = '') => typeof node.attrs?.[key] === 'string' ? node.attrs[key] as string : fallback;
const defaultStyle: Style = { size: 11, bold: false, italic: false, color: '#18212F' };
const color = (value: unknown) => typeof value === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value) ? value : undefined;

export async function renderPdf(input: RenderInput): Promise<RenderedFile> {
  if (input.content.kind !== 'document') throw new IdentityError('VALIDATION_FAILED', 'exports.errors.formatUnavailable');
  const warnings = checkDocumentFonts(input.content.document, input.options.replaceUnsupportedFonts), fonts = await loadDocumentFonts(), layout = input.options.layout;
  const margin = layout.marginMm * 72 / 25.4, pdf = new PDFDocument({ autoFirstPage: false, bufferPages: true, compress: true, info: { Title: input.title, Author: 'Tirlik', CreationDate: new Date(input.createdAt), Subject: `Immutable revision ${input.revision}` } });
  pdf.registerFont('body', fonts.regular); pdf.registerFont('bold', fonts.bold);
  const chunks: Buffer[] = []; let byteSize = 0;
  const completed = new Promise<Buffer>((resolve, reject) => { pdf.on('data', (part: Buffer) => { byteSize += part.length; if (byteSize > EXPORT_MAX_BYTES) { pdf.destroy(new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooLarge')); return; } chunks.push(part); }); pdf.on('error', reject); pdf.on('end', () => resolve(Buffer.concat(chunks))); });
  // Attach rejection immediately, including when layout fails before awaiting the stream.
  void completed.catch(() => undefined);
  let pageCount = 0, y = margin, width = 0, bottom = 0;
  const page = () => { input.signal?.throwIfAborted(); if (++pageCount > 1000) throw new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooLarge'); pdf.addPage({ size: layout.pageSize, layout: layout.orientation, margins: { top: margin, bottom: margin, left: margin, right: margin } }); width = pdf.page.width - 2 * margin; bottom = pdf.page.height - margin; y = margin; };
  const font = (style: Style) => pdf.font(style.bold ? 'bold' : 'body').fontSize(style.size);
  const measure = (value: string, style: Style) => { font(style); return pdf.widthOfString(value); };
  function runs(node: DocumentNode, inherited: Style): { text: string; style: Style }[] {
    if (node.type === 'hardBreak') return [{ text: '\n', style: inherited }];
    if (node.type !== 'text' && node.type !== 'dataField') return (node.content ?? []).flatMap((child) => runs(child, inherited));
    const style = { ...inherited };
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') style.bold = true; if (mark.type === 'italic') style.italic = true; if (mark.type === 'underline') style.underline = true; if (mark.type === 'strike') style.strike = true;
      if (mark.type === 'link') { style.href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : undefined; style.underline = true; }
      if (mark.type === 'code') style.background = '#F1F3F5';
      if (mark.type === 'textStyle') { if (typeof mark.attrs?.fontSize === 'number') style.size = mark.attrs.fontSize; style.color = color(mark.attrs?.color) ?? style.color; style.background = color(mark.attrs?.backgroundColor) ?? style.background; }
    }
    return [{ text: node.type === 'dataField' ? string(node, 'value') : node.text ?? '', style }];
  }
  function lines(node: DocumentNode, available: number, prefix = ''): Line[] {
    const size = node.type === 'heading' ? [24, 20, 17, 14, 12, 11][numeric(node, 'level', 1) - 1] ?? 11 : 11;
    const base = { ...defaultStyle, size, bold: node.type === 'heading' }, source = [...(prefix ? [{ text: prefix, style: base }] : []), ...runs(node, base)];
    const result: Line[] = []; let current: Run[] = [], currentWidth = 0, height = size * 1.4;
    const flush = () => { result.push({ type: 'line', runs: current, height, width: currentWidth, align: string(node, 'textAlign', 'left') }); current = []; currentWidth = 0; height = size * 1.4; };
    const add = (value: string, style: Style) => { const valueWidth = measure(value, style); current.push({ text: value, style, width: valueWidth }); currentWidth += valueWidth; height = Math.max(height, style.size * 1.4); };
    for (const run of source) {
      const tokens = run.text.split(/(\r\n|\r|\n|[^\S\r\n]+)/u).filter(Boolean);
      for (const token of tokens) {
        if (/^[\r\n]+$/.test(token)) { flush(); continue; }
        const tokenWidth = measure(token, run.style);
        if (currentWidth + tokenWidth <= available) { add(token, run.style); continue; }
        if (current.length) flush();
        if (tokenWidth <= available) { add(token, run.style); continue; }
        // Break a long URL or word by grapheme, preserving every character.
        for (const { segment } of new Intl.Segmenter(input.locale, { granularity: 'grapheme' }).segment(token)) { const segmentWidth = measure(segment, run.style); if (segmentWidth > available) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooWide'); if (currentWidth + segmentWidth > available && current.length) flush(); add(segment, run.style); }
      }
    }
    if (current.length || !result.length) flush(); return result;
  }
  async function picture(node: DocumentNode, available: number): Promise<Picture> {
    const asset = await input.assets.image(string(node, 'assetId')), data = ['image/png', 'image/jpeg'].includes(asset.mediaType) ? Buffer.from(asset.bytes) : await sharp(asset.bytes).png().toBuffer();
    const requestedWidth = numeric(node, 'width', asset.width) * 0.75, requestedHeight = numeric(node, 'height', requestedWidth / 0.75 * asset.height / asset.width) * 0.75, factor = Math.min(1, available / requestedWidth, (bottom - margin) / requestedHeight);
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
      else if (node.type === 'table') throw new IdentityError('VALIDATION_FAILED', 'exports.errors.nestedTablePdf');
      else if (node.type === 'pageBreak') throw new IdentityError('VALIDATION_FAILED', 'exports.errors.cellPageBreak');
      else result.push(...lines(node, available));
      result.push({ type: 'gap', height: 5 });
    }
    return result;
  }
  function draw(unit: Unit, x: number, top: number, available: number) {
    if (unit.type === 'gap') return;
    if (unit.type === 'image') { pdf.image(unit.data, x, top, { width: unit.width, height: unit.height }); return; }
    let offset = unit.align === 'right' ? available - unit.width : unit.align === 'center' ? (available - unit.width) / 2 : 0;
    for (const run of unit.runs) {
      font(run.style);
      if (run.style.background) pdf.save().fillColor(run.style.background).rect(x + offset, top, run.width, unit.height).fill().restore();
      pdf.fillColor(run.style.color).text(run.text, x + offset, top, { lineBreak: false, width: Math.max(available, run.width + 1), oblique: run.style.italic, underline: run.style.underline, strike: run.style.strike, link: run.style.href }); offset += run.width;
    }
  }
  function flow(content: Unit[], x: number, available: number) {
    for (const unit of content) { if (unit.height > bottom - margin) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooTall'); if (y + unit.height > bottom) page(); draw(unit, x, y, available); y += unit.height; }
  }
  async function table(node: DocumentNode) {
    const rows = node.content ?? [];
    // Merge layout is delegated to DOCX until a PDF cell can retain its exact span.
    if (rows.some((row) => row.content?.some((cell) => numeric(cell, 'rowspan', 1) !== 1))) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.mergedRowsPdf');
    const columns = Math.max(1, ...rows.map((row) => (row.content ?? []).reduce((sum, cell) => sum + numeric(cell, 'colspan', 1), 0))), sizes = Array<number>(columns).fill(width / columns);
    let pos = 0;
    for (const cell of rows[0]?.content ?? []) { const specified = cell.attrs?.colwidth, span = numeric(cell, 'colspan', 1); if (Array.isArray(specified)) specified.forEach((size, index) => { if (typeof size === 'number') sizes[pos + index] = size * 0.75; }); pos += span; }
    const total = sizes.reduce((a, b) => a + b, 0); for (let c = 0; c < sizes.length; c++) sizes[c] = sizes[c]! * width / total;
    const prepared = await Promise.all(rows.map(async (row) => { let column = 0; return Promise.all((row.content ?? []).map(async (cell) => { const span = numeric(cell, 'colspan', 1), cellWidth = sizes.slice(column, column + span).reduce((a, b) => a + b, 0), x = margin + sizes.slice(0, column).reduce((a, b) => a + b, 0); column += span; if (cellWidth <= 12) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooWide'); return { x, width: cellWidth, header: cell.type === 'tableHeader', content: await units(cell.content ?? [], cellWidth - 12) }; })); }));
    const header = prepared[0]?.every((cell) => cell.header) ? prepared[0] : undefined;
    const fullHeight = (row: typeof prepared[number]) => Math.max(18, ...row.map((cell) => cell.content.reduce((sum, unit) => sum + unit.height, 0) + 12));
    const headerHeight = header ? fullHeight(header) : 0;
    if (headerHeight > (bottom - margin) / 3) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.tableHeaderTooTall');
    const drawChunk = (row: typeof prepared[number], portions: Unit[][], height: number) => {
      for (let i = 0; i < row.length; i++) { const cell = row[i]!; pdf.save().lineWidth(0.5).strokeColor('#CBD5E1'); if (cell.header) pdf.fillColor('#EDF1F4').rect(cell.x, y, cell.width, height).fillAndStroke(); else pdf.rect(cell.x, y, cell.width, height).stroke(); pdf.restore(); let top = y + 6; for (const unit of portions[i]!) { draw(unit, cell.x + 6, top, cell.width - 12); top += unit.height; } }
      y += height;
    };
    const continueTable = () => { page(); if (header) drawChunk(header, header.map((cell) => cell.content), headerHeight); };
    for (let r = 0; r < prepared.length; r++) {
      const row = prepared[r]!, queues = row.map((cell) => [...cell.content]), rowHeight = fullHeight(row);
      if (y + rowHeight > bottom && rowHeight <= bottom - margin - headerHeight) { if (r === 0) page(); else continueTable(); }
      do {
        if (bottom - y < 30) { if (r === 0) page(); else continueTable(); }
        const available = bottom - y - 12, portions = queues.map((queue) => { const part: Unit[] = []; let used = 0; while (queue.length && used + queue[0]!.height <= available) { const unit = queue.shift()!; used += unit.height; part.push(unit); } return part; });
        if (portions.every((part) => !part.length) && queues.some((queue) => queue.length)) { if (y > margin + headerHeight + 1) { continueTable(); continue; } throw new IdentityError('VALIDATION_FAILED', 'exports.errors.contentTooTall'); }
        const height = Math.max(18, ...portions.map((part) => part.reduce((sum, unit) => sum + unit.height, 0) + 12)); drawChunk(row, portions, height);
        if (queues.some((queue) => queue.length)) continueTable();
      } while (queues.some((queue) => queue.length));
    }
    y += 8;
  }
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
