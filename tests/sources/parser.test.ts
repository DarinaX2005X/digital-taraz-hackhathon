import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractSource, extractSourceToSink, sourceParserFailureCategory, SOURCE_CHUNK_FRAGMENT_LIMIT, validateSourceMagic } from '../../src/features/sources/server/parser';
import { inspectRelationships, readOfficeArchive } from '../../src/features/sources/server/archive';
import { sourcePageImage } from '../../src/features/sources/server/page-image';

const options = { encoding: 'utf-8' as const };
async function scanPdf(image: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ autoFirstPage: false, compress: false }), chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk)); document.on('error', reject); document.on('end', () => resolve(Buffer.concat(chunks)));
    document.addPage({ size: 'A4', margin: 0 }); document.image(image, 36, 36, { fit: [523, 770], align: 'center', valign: 'center' }); document.end();
  });
}
describe('bounded source extraction', () => {
  it('keeps lexical numbers, duplicate and empty rows, formulas as text, and source coordinates', async () => {
    const result = await extractSource(Buffer.from('sku,amount,note\n0012,"12,50",=SUM(A1:A2)\n0012,,same\n\n'), 'csv', options);
    expect(result.chunks.flatMap((chunk) => chunk.fragments).map((row) => row.values)).toEqual([['sku', 'amount', 'note'], ['0012', '12,50', '=SUM(A1:A2)'], ['0012', '', 'same'], ['']]);
    expect(result.manifest.complete).toBe(true);
    expect(result.manifest.diagnostics).toContain('uneven-rows');
    expect(result.snapshotHash).not.toBe(result.manifest.byteHash);
    const changedPolicy = await extractSource(Buffer.from('a;b\n001;2'), 'csv', { ...options, delimiter: ';' });
    const changedOptions = await extractSource(Buffer.from('a;b\n001;2'), 'csv', { ...options, delimiter: ',' });
    expect(changedOptions.snapshotHash).not.toBe(changedPolicy.snapshotHash);
  });
  it('retains every fixture history row, including disputed values for later mapping', async () => {
    const result = await extractSource(await readFile('fixtures/business/homegoods/history.csv'), 'csv', options);
    expect(result.manifest.rowCount).toBe(1527);
    expect(result.chunks.flatMap((chunk) => chunk.fragments)).toHaveLength(1527);
  });
  it('streams 100000 CSV rows through bounded sequential chunks without materializing them in the result', async () => {
    const rows = Array.from({ length: 99_999 }, (_, index) => `${String(index + 1).padStart(6, '0')},${index + 1}`);
    const bytes = Buffer.from(`SKU,price\n${rows.join('\n')}\n`);
    let emitted = 0, seen = 0, active = 0, peakActive = 0, firstId = '', lastId = '';
    const result = await extractSourceToSink(bytes, 'csv', options, async ({ ordinal, content }) => {
      active += 1; peakActive = Math.max(peakActive, active);
      expect(ordinal).toBe(emitted); expect(content.fragments.length).toBeLessThanOrEqual(SOURCE_CHUNK_FRAGMENT_LIMIT);
      firstId ||= content.fragments[0]!.id; lastId = content.fragments.at(-1)!.id; seen += content.fragments.length; emitted += 1;
      await Promise.resolve(); active -= 1;
    });
    expect(result).not.toHaveProperty('chunks');
    expect(result.manifest).toMatchObject({ rowCount: 100_000, fragmentCount: 100_000, complete: true });
    expect(result.manifest.chunkHashes).toHaveLength(400); expect(result.stats).toEqual({ emittedChunks: 400, peakBufferedFragments: 250 });
    expect({ emitted, seen, peakActive, firstId, lastId }).toEqual({ emitted: 400, seen: 100_000, peakActive: 1, firstId: 'row:1', lastId: 'row:100000' });
  }, 30_000);
  it('extracts the original DOCX and XLSX fixtures without executing embedded formulas', async () => {
    const doc = await extractSource(await readFile('fixtures/business/services/request.docx'), 'docx', options);
    expect(doc.manifest.complete).toBe(true); expect(doc.manifest.fragmentCount).toBeGreaterThan(2);
    const workbook = await extractSource(await readFile('fixtures/business/homegoods/business-materials.xlsx'), 'xlsx', options);
    expect(workbook.manifest.sheets.length).toBeGreaterThan(1); expect(workbook.manifest.rowCount).toBeGreaterThan(1526);
    expect(workbook.chunks.flatMap((chunk) => chunk.fragments).some((fragment) => fragment.values?.some((value) => /^0\d/.test(value)))).toBe(true);
  });
  it('extracts text PDF and marks an actual image as needing recognition', async () => {
    const pdf = await extractSource(await readFile('fixtures/business/services/terms.pdf'), 'pdf', options);
    expect(pdf.manifest.complete).toBe(true); expect(pdf.manifest.fragmentCount).toBeGreaterThan(0);
    const photo = await extractSource(await readFile('fixtures/business/services/product-photo.jpg'), 'jpeg', options);
    expect(photo.manifest.complete).toBe(false); expect(photo.pages).toEqual([{ page: 1, state: 'pending' }]);
  });
  it('keeps an image-only PDF partial and renders only its requested OCR page', async () => {
    const pdf = await scanPdf(await readFile('fixtures/business/services/product-photo.jpg'));
    const extracted = await extractSource(pdf, 'pdf', options);
    expect(extracted.manifest).toMatchObject({ complete: false, pageCount: 1, diagnostics: ['vision-required'] });
    expect(extracted.pages).toEqual([{ page: 1, state: 'pending' }]);
    const page = await sourcePageImage(pdf, 'pdf', 1), metadata = await sharp(page).metadata();
    expect(metadata).toMatchObject({ format: 'png' });
    expect(metadata.width).toBeLessThanOrEqual(2400); expect(metadata.height).toBeLessThanOrEqual(3200);
    await expect(sourcePageImage(pdf, 'pdf', 2)).rejects.toMatchObject({ failure: 'invalid_result' });
  });
  it('keeps bounded paste, TSV and supported raster formats distinct', async () => {
    const text = await extractSource(Buffer.from('Қызмет бағасы: 12,50 ₸'), 'text', options);
    expect(text.chunks[0]!.fragments[0]!.text).toBe('Қызмет бағасы: 12,50 ₸');
    const tsv = await extractSource(Buffer.from('code\tprice\n001\t12,50'), 'tsv', options);
    expect(tsv.chunks.flatMap((chunk) => chunk.fragments).map((fragment) => fragment.values)).toEqual([['code', 'price'], ['001', '12,50']]);
    const photo = await readFile('fixtures/business/services/product-photo.jpg');
    const png = await sharp(photo).png().toBuffer(), webp = await sharp(photo).webp().toBuffer();
    expect((await extractSource(png, 'png', { ...options, purpose: 'visual' })).manifest.complete).toBe(true);
    expect((await extractSource(webp, 'webp', { ...options, purpose: 'visual' })).manifest.complete).toBe(true);
    expect((await extractSource(png, 'png', { ...options, purpose: 'text' })).pages).toEqual([{ page: 1, state: 'pending' }]);
  });
  it('reads equivalent worksheet targets without changing any rows or source coordinates', async () => {
    const bytes = await readFile('fixtures/business/homegoods/business-materials.xlsx');
    const original = await extractSource(bytes, 'xlsx', options);
    expect(original.manifest.rowCount).toBe(1590);
    for (const rewrite of [
      (target: string) => `/xl/${target}`,
      (target: string) => `../xl/${target}`,
      (target: string) => `/xl/${target.replace('worksheets', '%77orksheets')}`,
    ]) {
      const zip = await JSZip.loadAsync(bytes);
      const name = 'xl/_rels/workbook.xml.rels';
      const relations = await zip.file(name)!.async('string');
      zip.file(name, relations.replace(/Target="(worksheets\/[^\"]+)"/g, (_, target: string) => `Target="${rewrite(target)}"`));
      const parsed = await extractSource(await zip.generateAsync({ type: 'nodebuffer' }), 'xlsx', options);
      expect(parsed.chunks).toEqual(original.chunks);
      expect(parsed.manifest.sheets).toEqual(original.manifest.sheets);
    }
  });
  it('rejects worksheet traversal and external worksheet relationships before reading cells', async () => {
    const bytes = await readFile('fixtures/business/homegoods/business-materials.xlsx');
    for (const target of ['../../secret.xml', '%2e%2e/%2e%2e/secret.xml', '//other/file.xml', '/%2e%2e/secret.xml', 'file:///secret.xml']) {
      const zip = await JSZip.loadAsync(bytes), name = 'xl/_rels/workbook.xml.rels';
      zip.file(name, (await zip.file(name)!.async('string')).replace(/Target="worksheets\/[^\"]+"/, `Target="${target}"`));
      await expect(extractSource(await zip.generateAsync({ type: 'nodebuffer' }), 'xlsx', options)).rejects.toThrow();
    }
  });
  it('rejects wrong magic, unbounded columns and malformed text', async () => {
    expect(() => validateSourceMagic(Buffer.from('not a PDF'), 'pdf')).toThrow();
    await expect(extractSource(Buffer.from(Array.from({ length: 101 }, () => 'x').join(',')), 'csv', options)).rejects.toMatchObject({ messageKey: 'sources.errors.columnLimit' });
    await expect(extractSource(Buffer.from([0xff, 0xff]), 'text', options)).rejects.toMatchObject({ messageKey: 'sources.errors.encoding' });
  });
  it('reduces parser failures to a safe category without retaining error text', () => {
    expect(sourceParserFailureCategory(new TypeError('private document detail'))).toBe('TypeError');
    expect(sourceParserFailureCategory(Object.assign(new Error('private document detail'), { name: 'unsafe value: secret' }))).toBe('Error');
    expect(sourceParserFailureCategory('private document detail')).toBe('string');
  });
  it('rejects archive expansion, external relationships, XML entities and macro payloads', async () => {
    const bomb = new JSZip(); bomb.file('large.xml', 'x'.repeat(2 * 1024 * 1024));
    await expect(readOfficeArchive(await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))).rejects.toThrow();
    for (const dangerous of [
      ['word/_rels/document.xml.rels', '<Relationships><Relationship Id="x" Target="https://example.test/secret" TargetMode="External"/></Relationships>'],
      ['word/document.xml', '<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///secret">]><doc>&x;</doc>'],
      ['word/vbaProject.bin', 'macro'],
    ]) {
      const zip = new JSZip(); zip.file('[Content_Types].xml', '<Types/>'); zip.file('word/document.xml', '<w:document xmlns:w="w"><w:p><w:t>Hello</w:t></w:p></w:document>'); zip.file(dangerous[0]!, dangerous[1]!);
      await expect(extractSource(await zip.generateAsync({ type: 'nodebuffer' }), 'docx', options)).rejects.toThrow();
    }
  });
  it('preserves ordinary hyperlinks and package-relative relationships without allowing external resources', () => {
    const relationships = (target: string, type: string, mode = '') => new Map([['word/_rels/document.xml.rels', Buffer.from(`<Relationships><Relationship Type="${type}" Target="${target}" ${mode}/></Relationships>`)]]);
    expect(() => inspectRelationships(relationships('https://example.test/path', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', 'TargetMode="External"'))).not.toThrow();
    expect(() => inspectRelationships(relationships('../docProps/core.xml', 'metadata'))).not.toThrow();
    expect(() => inspectRelationships(relationships('/word/media/image.png', 'image'))).not.toThrow();
    for (const target of ['file:///secret', 'javascript:alert(1)', 'https://user:secret@example.test/']) expect(() => inspectRelationships(relationships(target, 'type/hyperlink', 'TargetMode="External"'))).toThrow();
    expect(() => inspectRelationships(relationships('https://example.test/image.png', 'type/image', 'TargetMode="External"'))).toThrow();
    expect(() => inspectRelationships(relationships('../../secret', 'image'))).toThrow();
    expect(() => inspectRelationships(relationships('%2e%2e/%2e%2e/secret', 'image'))).toThrow();
  });
});
