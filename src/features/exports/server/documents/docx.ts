import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun, LevelFormat, PageBreak, PageNumber, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, type IRunOptions } from 'docx';
import sharp from 'sharp';
import type { DocumentNode } from '../../../artifacts/domain/content-models';
import type { RenderInput, RenderedFile } from '../types';
import { checkDocumentFonts, loadDocumentFonts } from './fonts';
import { IdentityError } from '../../../identity/server/http';

const attr = (node: DocumentNode, key: string, fallback = 1) => typeof node.attrs?.[key] === 'number' ? node.attrs[key] as number : fallback;
const text = (node: DocumentNode, key: string) => typeof node.attrs?.[key] === 'string' ? node.attrs[key] as string : undefined;
const color = (value: unknown) => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value) ? value.slice(1) : typeof value === 'string' && /^#[a-f\d]{3}$/i.test(value) ? value.slice(1).split('').map((c) => c + c).join('') : undefined;
export async function renderDocx(input: RenderInput): Promise<RenderedFile> {
  if (input.content.kind !== 'document') throw new IdentityError('VALIDATION_FAILED', 'exports.errors.formatUnavailable');
  const warnings = checkDocumentFonts(input.content.document, input.options.replaceUnsupportedFonts), fonts = await loadDocumentFonts();
  const pagePoints = input.options.layout.pageSize === 'A4' ? [595.3, 841.9] : [612, 792];
  const contentWidthPx = (pagePoints[input.options.layout.orientation === 'portrait' ? 0 : 1]! - input.options.layout.marginMm * 2 * 72 / 25.4) / 0.75;
  const numbering: { reference: string; levels: { level: number; format: typeof LevelFormat.DECIMAL | typeof LevelFormat.BULLET; text: string; start: number; alignment: typeof AlignmentType.LEFT; style: { paragraph: { indent: { left: number; hanging: number } } } }[] }[] = [];
  let sequence = 0;
  async function inline(node: DocumentNode, availableWidth = contentWidthPx): Promise<(TextRun | ExternalHyperlink | ImageRun)[]> {
    input.signal?.throwIfAborted();
    if (node.type === 'hardBreak') return [new TextRun({ break: 1 })];
    if (node.type === 'image') {
      const id = text(node, 'assetId'); if (!id) throw new IdentityError('VALIDATION_FAILED', 'exports.errors.imageUnavailable');
      const asset = await input.assets.image(id), data = asset.mediaType === 'image/png' || asset.mediaType === 'image/jpeg' ? Buffer.from(asset.bytes) : await sharp(asset.bytes).png().toBuffer();
      const requestedWidth = attr(node, 'width', asset.width), requestedHeight = attr(node, 'height', requestedWidth * asset.height / asset.width);
      const width = Math.min(requestedWidth, availableWidth), height = width * requestedHeight / requestedWidth;
      return [new ImageRun({ type: asset.mediaType === 'image/jpeg' ? 'jpg' : 'png', data, transformation: { width, height }, altText: { title: text(node, 'title') ?? '', description: text(node, 'alt') ?? '', name: 'image' } })];
    }
    if (node.type !== 'text' && node.type !== 'dataField') return (await Promise.all((node.content ?? []).map((child) => inline(child, availableWidth)))).flat();
    const options: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = { text: node.type === 'dataField' ? text(node, 'value') ?? '' : node.text ?? '', font: 'Noto Sans' };
    let href: string | undefined;
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') options.bold = true;
      if (mark.type === 'italic') options.italics = true;
      if (mark.type === 'underline') options.underline = {};
      if (mark.type === 'strike') options.strike = true;
      if (mark.type === 'code') options.shading = { fill: 'F1F3F5' };
      if (mark.type === 'link') href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : undefined;
      if (mark.type === 'textStyle') { if (typeof mark.attrs?.fontSize === 'number') options.size = mark.attrs.fontSize * 2; const foreground = color(mark.attrs?.color), background = color(mark.attrs?.backgroundColor); if (foreground) options.color = foreground; if (background) options.shading = { fill: background }; }
    }
    const run = new TextRun(options); return href ? [new ExternalHyperlink({ link: href, children: [run] })] : [run];
  }
  async function blocks(nodes: DocumentNode[], list?: { reference: string; level: number }, quote = false, availableWidth = contentWidthPx): Promise<(Paragraph | Table)[]> {
    const output: (Paragraph | Table)[] = [];
    for (const node of nodes) {
      input.signal?.throwIfAborted();
      if (node.type === 'bulletList' || node.type === 'orderedList') {
        const reference = `list-${sequence++}`, level = Math.min(list ? list.level + 1 : 0, 8);
        numbering.push({ reference, levels: Array.from({ length: 9 }, (_, n) => ({ level: n, format: node.type === 'orderedList' ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: node.type === 'orderedList' ? `%${n + 1}.` : '•', start: attr(node, 'start', 1), alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (n + 1), hanging: 260 } } } })) });
        for (const item of node.content ?? []) output.push(...await blocks(item.content ?? [], { reference, level }, quote, availableWidth));
      } else if (node.type === 'table') {
        const rows: TableRow[] = [], columns = Math.max(1, ...(node.content ?? []).map((row) => (row.content ?? []).reduce((sum, cell) => sum + attr(cell, 'colspan'), 0)));
        for (const row of node.content ?? []) {
          const cells: TableCell[] = [];
          for (const cell of row.content ?? []) { const children = await blocks(cell.content ?? [], undefined, false, availableWidth * attr(cell, 'colspan') / columns - 16); if (!children.length || children.at(-1) instanceof Table) children.push(new Paragraph('')); const widths = cell.attrs?.colwidth;
            cells.push(new TableCell({ children, columnSpan: attr(cell, 'colspan'), rowSpan: attr(cell, 'rowspan'), ...(Array.isArray(widths) && widths.every((v) => typeof v === 'number') ? { width: { size: (widths as number[]).reduce((a, b) => a + b, 0) * 15, type: WidthType.DXA } } : {}), ...(cell.type === 'tableHeader' ? { shading: { fill: 'EDF1F4' } } : {}) })); }
          rows.push(new TableRow({ children: cells, tableHeader: (row.content ?? []).every((cell) => cell.type === 'tableHeader'), cantSplit: false }));
        }
        output.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      } else if (node.type === 'blockquote') {
        output.push(...await blocks(node.content ?? [], list, true, availableWidth - 24));
      } else if (node.type === 'pageBreak') output.push(new Paragraph({ children: [new PageBreak()] }));
      else {
        const alignment = ({ left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED } as const)[text(node, 'textAlign') as 'left'] ?? AlignmentType.LEFT;
        const heading = node.type === 'heading' ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][attr(node, 'level') - 1] : undefined;
        output.push(new Paragraph({ children: await inline(node, availableWidth), alignment, heading, ...(list && node === nodes[0] ? { numbering: list } : {}), spacing: { after: 140 }, ...(quote ? { indent: { left: 360 }, border: { left: { color: 'CAD0D8', size: 12, style: BorderStyle.SINGLE } } } : {}) }));
      }
    }
    return output;
  }
  const layout = input.options.layout, historical = input.historicalDraft ? ({ ru: 'Исторический черновик', kk: 'Тарихи нобай', en: 'Historical draft' }[input.locale] + ` · v${input.revision}`) : '';
  const children = await blocks(input.content.document.content ?? []), header = [historical, layout.headerText].filter(Boolean).join(' · '), footer = layout.footerText ?? '';
  const dimensions = layout.pageSize === 'A4' ? [11906, 16838] : [12240, 15840], landscape = layout.orientation === 'landscape';
  const document = new Document({ title: input.title, creator: 'Tirlik', description: `Immutable revision ${input.revision}`, fonts: [{ name: 'Noto Sans', data: fonts.regular, bold: fonts.bold }], numbering: { config: numbering }, styles: { default: { document: { run: { font: 'Noto Sans', size: 22 }, paragraph: { spacing: { after: 140 } } } } }, sections: [{ properties: { page: { size: { width: dimensions[landscape ? 1 : 0], height: dimensions[landscape ? 0 : 1] }, margin: { top: layout.marginMm * 56.693, bottom: layout.marginMm * 56.693, left: layout.marginMm * 56.693, right: layout.marginMm * 56.693, header: 400, footer: 400 } } }, headers: header ? { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: header, size: 16, color: '64748B' })] })] }) } : undefined, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: footer, size: 16 }), ...(layout.pageNumbers ? [new TextRun({ children: [' ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16 })] : [])] })] }) }, children }] });
  return { bytes: await Packer.toBuffer(document), mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', warnings };
}
