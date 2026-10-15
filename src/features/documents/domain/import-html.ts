import { Parser } from 'htmlparser2';
import { ContentValidationError } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { newDocumentId, readDocument, type DocumentContent, type DocumentNode } from './document';

export type ImportLossCode = 'layout' | 'unsupported-content' | 'unsafe-link' | 'image-omitted' | 'table-flattened' | 'formatting' | 'tracked-changes' | 'headers-footers' | 'footnotes' | 'embedded-object';
export interface ImportLoss { code: ImportLossCode; count: number }
export interface DocumentImport { content: DocumentContent; losses: ImportLoss[] }
type HtmlNode = { tag: string; attrs: Record<string, string>; children: HtmlNode[]; text?: string };
type Mark = NonNullable<DocumentNode['marks']>[number];
const dropped = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'form', 'input', 'button']);
const blockTags = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'hr', 'pre', 'figure']);
const knownTags = new Set([...blockTags, 'html', 'body', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'a', 'span', 'br', 'img', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', 'sup', 'sub']);

export function safeDocumentLink(href: string): boolean {
  if (href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return false;
  try { return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(href).protocol); } catch { return false; }
}

/** HTML is input data. Only typed, allowlisted document nodes leave this converter. */
export function importDocumentHtml(html: string, options: { makeId?: () => string; assetIds?: ReadonlySet<string> } = {}): DocumentImport {
  if (html.length > 2 * 1024 * 1024) throw new ContentValidationError('paste-too-large');
  const makeId = options.makeId ?? newDocumentId, loss = new Map<ImportLossCode, number>();
  const note = (code: ImportLossCode) => loss.set(code, (loss.get(code) ?? 0) + 1);
  const root: HtmlNode = { tag: 'body', attrs: {}, children: [] }, stack = [root];
  let nodes = 0;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (++nodes > 20000 || stack.length > 32) throw new ContentValidationError('document-too-complex');
      const node = { tag, attrs, children: [] };
      stack.at(-1)!.children.push(node); stack.push(node);
    },
    ontext(text) { if (++nodes > 40000) throw new ContentValidationError('document-too-complex'); stack.at(-1)!.children.push({ tag: '#text', attrs: {}, children: [], text }); },
    onclosetag() { if (stack.length > 1) stack.pop(); },
  }, { decodeEntities: true });
  parser.end(html);
  const attrs = (extra: Record<string, JsonValue> = {}) => ({ id: makeId(), ...extra });
  const paragraph = (content: DocumentNode[] = []): DocumentNode => ({ type: 'paragraph', attrs: attrs(), content });
  function mergeText(content: DocumentNode[]): DocumentNode[] {
    const merged: DocumentNode[] = [];
    for (const node of content) {
      const last = merged.at(-1);
      if (last?.type === 'text' && node.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(node.marks)) last.text! += node.text;
      else merged.push(node);
    }
    return merged;
  }
  function marksFor(node: HtmlNode, previous: Mark[]): Mark[] {
    const marks = [...previous];
    const markName = ({ b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline', s: 'strike', strike: 'strike', del: 'strike', code: 'code' } as const)[node.tag as 'b'];
    if (markName && !marks.some((mark) => mark.type === markName)) marks.push({ type: markName });
    if (node.tag === 'a' && node.attrs.href) {
      if (safeDocumentLink(node.attrs.href)) { const previousLink = marks.findIndex((mark) => mark.type === 'link'); if (previousLink >= 0) marks.splice(previousLink, 1); marks.push({ type: 'link', attrs: { href: node.attrs.href, ...(node.attrs.title ? { title: node.attrs.title.slice(0, 1000) } : {}) } }); }
      else note('unsafe-link');
    }
    if (node.attrs.style) {
      const styles: Record<string, JsonValue> = {};
      for (const declaration of node.attrs.style.split(';')) {
        const colon = declaration.indexOf(':'); if (colon < 0) continue;
        const key = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
        if (['color', 'background-color'].includes(key) && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) styles[key === 'color' ? 'color' : 'backgroundColor'] = value;
        else if (key === 'font-size' && /^\d+(?:\.\d+)?pt$/.test(value) && parseFloat(value) >= 1 && parseFloat(value) <= 400) styles.fontSize = parseFloat(value);
        else if (key === 'font-weight' && /^(bold|[6-9]00)$/.test(value)) { if (!marks.some((mark) => mark.type === 'bold')) marks.push({ type: 'bold' }); }
        else if (key === 'font-style' && value === 'italic') { if (!marks.some((mark) => mark.type === 'italic')) marks.push({ type: 'italic' }); }
        else if (key !== 'text-align') note('formatting');
      }
      if (Object.keys(styles).length) {
        const index = marks.findIndex((mark) => mark.type === 'textStyle');
        const inherited = index >= 0 ? marks.splice(index, 1)[0]!.attrs : {};
        marks.push({ type: 'textStyle', attrs: { ...inherited, ...styles } });
      }
    }
    return marks;
  }
  function imageNode(node: HtmlNode): DocumentNode | undefined {
    const assetId = /^tirlik-asset:([0-9a-f-]{36})$/i.exec(node.attrs.src ?? '')?.[1];
    if (!assetId || !options.assetIds?.has(assetId)) { note('image-omitted'); return; }
    const dimensions: Record<string, JsonValue> = {};
    for (const key of ['width', 'height']) if (/^\d+(?:\.\d+)?$/.test(node.attrs[key] ?? '') && Number(node.attrs[key]) > 0 && Number(node.attrs[key]) <= 100000) dimensions[key] = Number(node.attrs[key]);
    return { type: 'image', attrs: attrs({ assetId, alt: (node.attrs.alt ?? '').slice(0, 2000), ...dimensions }) };
  }
  function inline(nodes: HtmlNode[], inherited: Mark[] = []): DocumentNode[] {
    const result: DocumentNode[] = [];
    for (const node of nodes) {
      if (dropped.has(node.tag)) { note('unsupported-content'); continue; }
      if (node.tag === '#text') { if (node.text) result.push({ type: 'text', text: node.text, ...(inherited.length ? { marks: inherited } : {}) }); continue; }
      if (node.tag === 'br') { result.push({ type: 'hardBreak' }); continue; }
      if (node.tag === 'img') { note('image-omitted'); if (node.attrs.alt) result.push({ type: 'text', text: node.attrs.alt }); continue; }
      if (!knownTags.has(node.tag) || ['sup', 'sub'].includes(node.tag)) note('formatting');
      result.push(...inline(node.children, marksFor(node, inherited)));
    }
    return mergeText(result);
  }
  function inlineBlocks(node: HtmlNode, type: 'paragraph' | 'heading', extra: Record<string, JsonValue> = {}): DocumentNode[] {
    const result: DocumentNode[] = [], buffer: HtmlNode[] = [];
    const flush = () => { if (buffer.length) { result.push({ type, attrs: attrs(extra), content: inline(buffer.splice(0)) }); } };
    // Mammoth places pictures inside paragraphs; lift them to block images without losing adjacent text.
    for (const child of node.children) {
      if (child.tag === 'img') { flush(); const picture = imageNode(child); if (picture) result.push(picture); }
      else if (child.tag === 'hr') { flush(); result.push({ type: 'pageBreak', attrs: attrs() }); }
      else buffer.push(child);
    }
    flush(); return result.length ? result : [{ type, attrs: attrs(extra), content: [] }];
  }
  function table(node: HtmlNode): DocumentNode[] {
    const rows: HtmlNode[] = [];
    const visit = (item: HtmlNode) => { if (item.tag === 'tr') rows.push(item); else if (['table', 'thead', 'tbody', 'tfoot'].includes(item.tag)) item.children.forEach(visit); };
    visit(node);
    const content: DocumentNode[] = rows.map((row) => ({ type: 'tableRow', attrs: attrs(), content: row.children.filter((cell) => ['th', 'td'].includes(cell.tag)).map((cell) => ({
      type: cell.tag === 'th' ? 'tableHeader' : 'tableCell', attrs: attrs({ colspan: Math.max(1, Number(cell.attrs.colspan) || 1), rowspan: Math.max(1, Number(cell.attrs.rowspan) || 1) }), content: blocks(cell.children),
    })) }));
    const candidate: DocumentNode = { type: 'table', attrs: attrs(), content };
    try { readDocument({ kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: attrs(), content: [candidate] } }); return [candidate]; }
    catch { note('table-flattened'); return rows.map((row) => paragraph(inline(row.children.flatMap((cell, index) => [...(index ? [{ tag: '#text', text: '\t', attrs: {}, children: [] }] : []), ...cell.children])))); }
  }
  function blocks(children: HtmlNode[]): DocumentNode[] {
    const result: DocumentNode[] = [], buffer: HtmlNode[] = [];
    const flush = () => { if (buffer.length) { const content = inline(buffer.splice(0)); if (content.some((item) => item.type !== 'text' || item.text?.trim())) result.push(paragraph(content)); } };
    for (const node of children) {
      if (dropped.has(node.tag)) { note('unsupported-content'); continue; }
      if (node.tag === 'img') { flush(); const picture = imageNode(node); if (picture) result.push(picture); continue; }
      if (!blockTags.has(node.tag)) {
        if (['html', 'body'].includes(node.tag)) { flush(); result.push(...blocks(node.children)); }
        else buffer.push(node);
        continue;
      }
      flush();
      if (node.tag === 'p' || /^h[1-6]$/.test(node.tag)) {
        const alignment = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i.exec(node.attrs.style ?? '')?.[1]?.toLowerCase();
        result.push(...inlineBlocks(node, node.tag === 'p' ? 'paragraph' : 'heading', { ...(node.tag !== 'p' ? { level: Number(node.tag[1]) } : {}), ...(alignment ? { textAlign: alignment } : {}) }));
      } else if (['ul', 'ol'].includes(node.tag)) {
        const items = node.children.filter((child) => child.tag === 'li').map((item): DocumentNode => { const content = blocks(item.children); if (content[0]?.type !== 'paragraph') content.unshift(paragraph()); return { type: 'listItem', attrs: attrs(), content }; });
        if (items.length) result.push({ type: node.tag === 'ul' ? 'bulletList' : 'orderedList', attrs: attrs(node.tag === 'ol' ? { start: Math.max(1, Number(node.attrs.start) || 1) } : {}), content: items });
      } else if (node.tag === 'table') result.push(...table(node));
      else if (node.tag === 'blockquote') result.push({ type: 'blockquote', attrs: attrs(), content: blocks(node.children) });
      else if (node.tag === 'hr') result.push({ type: 'pageBreak', attrs: attrs() });
      else { if (node.tag === 'pre') note('formatting'); result.push(...blocks(node.children)); }
    }
    flush(); return result.length ? result : [paragraph()];
  }
  const document: DocumentNode = { type: 'doc', attrs: attrs(), content: blocks(root.children) };
  return { content: readDocument({ kind: 'document', schemaVersion: 1, document }), losses: [...loss].map(([code, count]) => ({ code, count })) };
}
