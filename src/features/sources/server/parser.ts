import { parse } from 'csv-parse';
import sharp from 'sharp';
import type { SourceChunk, SourceFormat, SourceFragment, SourceManifest, SourceOptions } from '../../../contracts/sources';
import { SourceManifestSchema } from '../../../contracts/sources';
import { IdentityError } from '../../identity/server/http';
import { extractOffice } from './office';
import { sourceHash } from './storage';
import { inspectSourceFont } from './font';

export const SOURCE_MEDIA: Record<SourceFormat, string> = { text: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff' };
const bad = (key: string) => new IdentityError('VALIDATION_FAILED', `sources.errors.${key}`);

export function validateSourceMagic(bytes: Buffer, format: SourceFormat) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const valid = format === 'ttf' ? starts(0, 1, 0, 0) : format === 'otf' ? bytes.subarray(0, 4).toString('ascii') === 'OTTO' : format === 'woff' ? bytes.subarray(0, 4).toString('ascii') === 'wOFF' : format === 'pdf' ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : format === 'png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      : format === 'jpeg' ? starts(0xff, 0xd8, 0xff)
        : format === 'webp' ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          : format === 'xlsx' || format === 'docx' ? starts(0x50, 0x4b, 0x03, 0x04)
            : !bytes.includes(0) && !starts(0x50, 0x4b, 0x03, 0x04) && !starts(0x4d, 0x5a) && !starts(0x7f, 0x45, 0x4c, 0x46);
  if (!valid) throw bad('format');
}

function decode(bytes: Buffer, encoding: SourceOptions['encoding']): string {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { throw bad('encoding'); }
}
export interface SourceExtraction { manifest: SourceManifest; snapshotHash: string; chunks: SourceChunk[]; pages: { page: number; state: 'ready' | 'pending' | 'needs-review' | 'failed' }[] }
export function buildExtraction(format: SourceFormat, byteHash: string, options: SourceOptions, fragments: SourceFragment[], sheets: string[], diagnostics: string[], pages: SourceExtraction['pages']): SourceExtraction {
  const chunks: SourceChunk[] = []; let batch: SourceFragment[] = [], bytes = 0;
  for (const fragment of fragments) {
    const length = Buffer.byteLength(JSON.stringify(fragment));
    if (batch.length && (batch.length >= 250 || bytes + length > 256 * 1024)) { chunks.push({ fragments: batch }); batch = []; bytes = 0; }
    batch.push(fragment); bytes += length;
  }
  if (batch.length) chunks.push({ fragments: batch });
  const manifest = SourceManifestSchema.parse({ parserVersion: 'tirlik-source-1', policyVersion: 'bounded-1', format, byteHash, options, chunkHashes: chunks.map((chunk) => sourceHash(JSON.stringify(chunk))), fragmentCount: fragments.length, rowCount: fragments.filter((fragment) => fragment.row !== undefined).length, pageCount: pages.length, sheets, diagnostics, complete: pages.every((page) => page.state === 'ready' || page.state === 'needs-review') });
  return { manifest, snapshotHash: sourceHash(JSON.stringify(manifest)), chunks, pages };
}

export async function extractSource(bytes: Buffer, format: SourceFormat, options: SourceOptions): Promise<SourceExtraction> {
  validateSourceMagic(bytes, format);
  const byteHash = sourceHash(bytes);
  let fragments: SourceFragment[] = [], sheets: string[] = [], diagnostics: string[] = [], pages: SourceExtraction['pages'] = [];
  if (format === 'csv' || format === 'tsv') {
    const value = decode(bytes, options.encoding);
    const delimiter = options.delimiter ?? (format === 'tsv' ? '\t' : value.split(/\r?\n/, 1)[0]!.split(';').length > value.split(/\r?\n/, 1)[0]!.split(',').length ? ';' : ',');
    const parser = parse(value, { delimiter, bom: true, relax_column_count: true, skip_empty_lines: false, max_record_size: 1024 * 1024 });
    let row = 0;
    try {
      for await (const record of parser) {
        if (++row > 100001) { parser.destroy(); throw bad('rowLimit'); }
        const values = record as string[];
        if (values.length > 100) { parser.destroy(); throw bad('columnLimit'); }
        if (values.some((cell) => cell.length > 64000)) { parser.destroy(); throw bad('tooLarge'); }
        fragments.push({ id: `row:${row}`, row, values, review: 'observed' });
      }
    } catch (error) { if (error instanceof IdentityError) throw error; throw bad('csv'); }
    const widths = new Set(fragments.map((fragment) => fragment.values!.length));
    if (widths.size > 1) diagnostics.push('uneven-rows');
  } else if (format === 'text') {
    const text = decode(bytes, options.encoding);
    for (let offset = 0; offset < text.length; offset += 8000) fragments.push({ id: `text:${offset}`, text: text.slice(offset, offset + 8000), review: 'observed' });
  } else if (format === 'xlsx' || format === 'docx') {
    ({ fragments, sheets, diagnostics } = await extractOffice(bytes, format));
  } else if (format === 'pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, useWasm: false, stopAtErrors: true });
    try {
      const document = await loading.promise;
      if (document.numPages > 100) throw bad('pageLimit');
      for (let page = 1; page <= document.numPages; page++) {
        const item = await document.getPage(page), content = await item.getTextContent();
        const text = content.items.map((entry) => 'str' in entry ? entry.str + (entry.hasEOL ? '\n' : ' ') : '').join('');
        if (text.length > 1_000_000) throw bad('tooLarge');
        if (text.trim()) {
          for (let offset = 0; offset < text.length; offset += 8000) fragments.push({ id: `page:${page}:${offset}`, page, text: text.slice(offset, offset + 8000), review: 'observed' });
          pages.push({ page, state: 'ready' });
        } else pages.push({ page, state: 'pending' });
        item.cleanup();
      }
    } catch (error) { if (error instanceof IdentityError) throw error; throw bad('pdf'); }
    finally { await loading.destroy(); }
    if (pages.some((page) => page.state === 'pending')) diagnostics.push('vision-required');
  } else if (format === 'ttf' || format === 'otf' || format === 'woff') {
    const font = inspectSourceFont(bytes, format);
    fragments = [{ id: 'font:metadata', text: `${font.family} — ${font.subfamily}`, review: 'observed' }];
  } else {
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 20_000_000, animated: false }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000 || (metadata.pages ?? 1) > 1 || metadata.format !== (format === 'jpeg' ? 'jpeg' : format)) throw bad('image');
    } catch (error) { if (error instanceof IdentityError) throw error; throw bad('image'); }
    if (options.purpose !== 'visual') { pages = [{ page: 1, state: 'pending' }]; diagnostics.push('vision-required'); }
  }
  if (!fragments.length && pages.every((page) => page.state === 'ready') && !(options.purpose === 'visual' && ['png', 'jpeg', 'webp'].includes(format))) diagnostics.push('empty-content');
  return buildExtraction(format, byteHash, options, fragments, sheets, diagnostics, pages);
}
