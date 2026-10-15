import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractSource, validateSourceMagic } from '../../src/features/sources/server/parser';
import { inspectRelationships, readOfficeArchive } from '../../src/features/sources/server/archive';

const options = { encoding: 'utf-8' as const };
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
