import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import sharp from 'sharp';
import type { SourceChunk, SourceFormat, SourceFragment, SourceManifest, SourceOptions } from '../../../contracts/sources';
import { SourceManifestSchema } from '../../../contracts/sources';
import { IdentityError } from '../../identity/server/http';
import { extractOffice } from './office';
import { sourceHash } from './storage';
import { inspectSourceFont } from './font';
import { validateSourceMagic } from './source-format';

export { SOURCE_MEDIA, validateSourceMagic } from './source-format';

export const SOURCE_CHUNK_FRAGMENT_LIMIT = 250;
export const SOURCE_CHUNK_TARGET_BYTES = 256 * 1024;
const SOURCE_SINGLE_FRAGMENT_LIMIT = 2 * 1024 * 1024;
const SOURCE_DECODE_WINDOW = 64 * 1024;
const bad = (key: string) => new IdentityError('VALIDATION_FAILED', `sources.errors.${key}`);

export function sourceParserFailureCategory(error: unknown) {
  if (!(error instanceof Error)) return typeof error;
  const category = error.name || error.constructor.name;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(category) ? category : 'Error';
}

function decode(bytes: Buffer, encoding: SourceOptions['encoding']): string {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { throw bad('encoding'); }
}

async function* decodedParts(bytes: Buffer, encoding: SourceOptions['encoding']) {
  const decoder = new TextDecoder(encoding, { fatal: true });
  try {
    for (let offset = 0; offset < bytes.length; offset += SOURCE_DECODE_WINDOW) {
      const value = decoder.decode(bytes.subarray(offset, offset + SOURCE_DECODE_WINDOW), { stream: offset + SOURCE_DECODE_WINDOW < bytes.length });
      if (value) yield value;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } catch { throw bad('encoding'); }
}

function detectedDelimiter(bytes: Buffer, format: 'csv' | 'tsv', options: SourceOptions) {
  if (options.delimiter) return options.delimiter;
  if (format === 'tsv') return '\t';
  let preview: string;
  try {
    const end = Math.min(bytes.length, SOURCE_DECODE_WINDOW);
    preview = new TextDecoder(options.encoding, { fatal: true }).decode(bytes.subarray(0, end), { stream: end < bytes.length });
  } catch { throw bad('encoding'); }
  preview = preview.split(/\r?\n/, 1)[0]!;
  return preview.split(';').length > preview.split(',').length ? ';' : ',';
}

export interface SourceChunkEmission { ordinal: number; hash: string; content: SourceChunk }
export type SourceChunkSink = (chunk: SourceChunkEmission) => void | Promise<void>;
export interface SourceExtractionStats { emittedChunks: number; peakBufferedFragments: number }
export interface SourceExtractionSummary {
  manifest: SourceManifest; snapshotHash: string;
  pages: { page: number; state: 'ready' | 'pending' | 'needs-review' | 'failed' }[];
  stats: SourceExtractionStats;
}
export interface SourceExtraction extends SourceExtractionSummary { chunks: SourceChunk[] }
class ChunkSinkError extends Error { constructor(readonly failure: unknown) { super('SOURCE_CHUNK_SINK_FAILED'); } }

class ChunkEmitter {
  private fragments: SourceFragment[] = [];
  private bytes = 0;
  readonly hashes: string[] = [];
  fragmentCount = 0;
  rowCount = 0;
  peakBufferedFragments = 0;
  constructor(private readonly sink: SourceChunkSink) {}
  async add(fragment: SourceFragment) {
    const length = Buffer.byteLength(JSON.stringify(fragment));
    if (length > SOURCE_SINGLE_FRAGMENT_LIMIT) throw bad('tooLarge');
    if (this.fragments.length && (this.fragments.length >= SOURCE_CHUNK_FRAGMENT_LIMIT || this.bytes + length > SOURCE_CHUNK_TARGET_BYTES)) await this.flush();
    this.fragments.push(fragment); this.bytes += length; this.fragmentCount += 1;
    if (fragment.row !== undefined) this.rowCount += 1;
    this.peakBufferedFragments = Math.max(this.peakBufferedFragments, this.fragments.length);
  }
  async finish() {
    await this.flush();
    return { emittedChunks: this.hashes.length, peakBufferedFragments: this.peakBufferedFragments };
  }
  private async flush() {
    if (!this.fragments.length) return;
    const content = { fragments: this.fragments }, hash = sourceHash(JSON.stringify(content)), ordinal = this.hashes.length;
    try { await this.sink({ ordinal, hash, content }); } catch (error) { throw new ChunkSinkError(error); }
    this.hashes.push(hash); this.fragments = []; this.bytes = 0;
  }
}

function manifest(format: SourceFormat, byteHash: string, options: SourceOptions, emitter: ChunkEmitter, sheets: string[], diagnostics: string[], pages: SourceExtractionSummary['pages']) {
  const value = SourceManifestSchema.parse({
    parserVersion: 'tirlik-source-1', policyVersion: 'bounded-1', format, byteHash, options,
    chunkHashes: emitter.hashes, fragmentCount: emitter.fragmentCount, rowCount: emitter.rowCount, pageCount: pages.length,
    sheets, diagnostics, complete: pages.every((page) => page.state === 'ready' || page.state === 'needs-review'),
  });
  return { manifest: value, snapshotHash: sourceHash(JSON.stringify(value)) };
}

function materializedChunks(fragments: SourceFragment[]) {
  const chunks: SourceChunk[] = []; let batch: SourceFragment[] = [], bytes = 0;
  for (const fragment of fragments) {
    const length = Buffer.byteLength(JSON.stringify(fragment));
    if (length > SOURCE_SINGLE_FRAGMENT_LIMIT) throw bad('tooLarge');
    if (batch.length && (batch.length >= SOURCE_CHUNK_FRAGMENT_LIMIT || bytes + length > SOURCE_CHUNK_TARGET_BYTES)) { chunks.push({ fragments: batch }); batch = []; bytes = 0; }
    batch.push(fragment); bytes += length;
  }
  if (batch.length) chunks.push({ fragments: batch });
  return chunks;
}

/** Used when a derived OCR manifest is rebuilt from already bounded persisted chunks. */
export function buildExtraction(format: SourceFormat, byteHash: string, options: SourceOptions, fragments: SourceFragment[], sheets: string[], diagnostics: string[], pages: SourceExtraction['pages']): SourceExtraction {
  const chunks = materializedChunks(fragments), chunkHashes = chunks.map((chunk) => sourceHash(JSON.stringify(chunk)));
  const value = SourceManifestSchema.parse({ parserVersion: 'tirlik-source-1', policyVersion: 'bounded-1', format, byteHash, options, chunkHashes, fragmentCount: fragments.length, rowCount: fragments.filter((fragment) => fragment.row !== undefined).length, pageCount: pages.length, sheets, diagnostics, complete: pages.every((page) => page.state === 'ready' || page.state === 'needs-review') });
  return { manifest: value, snapshotHash: sourceHash(JSON.stringify(value)), chunks, pages, stats: { emittedChunks: chunks.length, peakBufferedFragments: Math.min(fragments.length, SOURCE_CHUNK_FRAGMENT_LIMIT) } };
}

async function streamDelimited(bytes: Buffer, format: 'csv' | 'tsv', options: SourceOptions, emitter: ChunkEmitter, diagnostics: string[]) {
  const parser = Readable.from(decodedParts(bytes, options.encoding)).pipe(parse({ delimiter: detectedDelimiter(bytes, format, options), bom: true, relax_column_count: true, skip_empty_lines: false, max_record_size: 1024 * 1024 }));
  const widths = new Set<number>(); let row = 0;
  try {
    for await (const record of parser) {
      if (++row > 100001) { parser.destroy(); throw bad('rowLimit'); }
      const values = record as string[];
      if (values.length > 100) { parser.destroy(); throw bad('columnLimit'); }
      if (values.some((cell) => cell.length > 64000)) { parser.destroy(); throw bad('tooLarge'); }
      widths.add(values.length);
      await emitter.add({ id: `row:${row}`, row, values, review: 'observed' });
    }
  } catch (error) { if (error instanceof ChunkSinkError) throw error.failure; if (error instanceof IdentityError) throw error; throw bad('csv'); }
  if (widths.size > 1) diagnostics.push('uneven-rows');
}

/**
 * Production ingestion supplies a durable sink. CSV/TSV rows are decoded,
 * parsed and backpressured one bounded chunk at a time; the returned summary
 * contains only hashes/counts, never all rows or chunks.
 */
export async function extractSourceToSink(bytes: Buffer, format: SourceFormat, options: SourceOptions, sink: SourceChunkSink): Promise<SourceExtractionSummary> {
  validateSourceMagic(bytes, format);
  const byteHash = sourceHash(bytes), emitter = new ChunkEmitter(sink);
  let fragments: SourceFragment[] = [], sheets: string[] = [], diagnostics: string[] = [], pages: SourceExtractionSummary['pages'] = [];
  if (format === 'csv' || format === 'tsv') {
    await streamDelimited(bytes, format, options, emitter, diagnostics);
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
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      console.error('SOURCE_PDF_PARSE_FAILED', { category: sourceParserFailureCategory(error) });
      throw bad('pdf');
    }
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
  for (const fragment of fragments) await emitter.add(fragment);
  const stats = await emitter.finish();
  if (!emitter.fragmentCount && pages.every((page) => page.state === 'ready') && !(options.purpose === 'visual' && ['png', 'jpeg', 'webp'].includes(format))) diagnostics.push('empty-content');
  return { ...manifest(format, byteHash, options, emitter, sheets, diagnostics, pages), pages, stats };
}

/** Compatibility materializer for bounded unit/domain callers. Production upload uses extractSourceToSink. */
export async function extractSource(bytes: Buffer, format: SourceFormat, options: SourceOptions): Promise<SourceExtraction> {
  const chunks: SourceChunk[] = [];
  const extracted = await extractSourceToSink(bytes, format, options, ({ ordinal, content }) => { chunks[ordinal] = content; });
  return { ...extracted, chunks };
}
