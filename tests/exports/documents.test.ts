import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderDocx } from '../../src/features/exports/server/documents/docx';
import { renderPdf } from '../../src/features/exports/server/documents/pdf';
import { documentInput, paragraph } from './fixture';
import type { DocumentNode } from '../../src/features/artifacts/domain/content-models';

describe('real document files from frozen content', () => {
  it('writes a valid DOCX package with Kazakh/Cyrillic text, marks, list start, spans and embedded fonts', async () => {
    const input = documentInput([
      { type: 'heading', attrs: { id: 'h', level: 2 }, content: [{ type: 'text', text: 'Қазақстан ұсынысы', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'Цена 12 000 ₸', marks: [{ type: 'textStyle', attrs: { fontSize: 14, color: '#123456' } }, { type: 'italic' }] }] },
      { type: 'orderedList', attrs: { id: 'list', start: 4 }, content: [{ type: 'listItem', attrs: { id: 'li' }, content: [paragraph('lip', 'Согласовать сроки')] }] },
      { type: 'table', attrs: { id: 'table' }, content: [{ type: 'tableRow', attrs: { id: 'r' }, content: [{ type: 'tableHeader', attrs: { id: 'c', colspan: 2, rowspan: 1, colwidth: [100, 100] }, content: [paragraph('cp', 'Итог')] }] }] },
    ]);
    input.options.layout.headerText = 'Клиенту'; input.historicalDraft = true;
    const file = await renderDocx(input), zip = await JSZip.loadAsync(file.bytes), xml = await zip.file('word/document.xml')!.async('string');
    expect(file.mediaType).toContain('wordprocessingml'); expect(xml).toContain('Қазақстан ұсынысы'); expect(xml).toContain('w:val="28"'); expect(xml).toContain('123456'); expect(xml).toContain('w:gridSpan w:val="2"');
    expect(await zip.file('word/numbering.xml')!.async('string')).toContain('w:start w:val="4"');
    expect(Object.keys(zip.files).filter((key) => key.endsWith('.odttf')).length).toBeGreaterThanOrEqual(2);
    expect(await zip.file('word/header1.xml')!.async('string')).toContain('Исторический черновик');
  });
  it('extracts every last-page row from a multi-page PDF with repeated table headers', async () => {
    const row = (index: number): DocumentNode => ({ type: 'tableRow', attrs: { id: `r${index}` }, content: [0, 1].map((column) => ({ type: index === 0 ? 'tableHeader' : 'tableCell', attrs: { id: `c${index}-${column}` }, content: [paragraph(`p${index}-${column}`, index === 0 ? (column ? 'Стоимость' : 'Позиция') : column ? `${index} 000 ₸` : `Материал №${index} · Қазақстан`)] })) });
    const input = documentInput([{ type: 'table', attrs: { id: 't' }, content: Array.from({ length: 90 }, (_, index) => row(index)) }]);
    const file = await renderPdf(input), loading = getDocument({ data: new Uint8Array(file.bytes), useSystemFonts: false, disableFontFace: true });
    try {
      const pdf = await loading.promise; expect(pdf.numPages).toBeGreaterThan(2); const pages: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) { const page = await pdf.getPage(n), text = await page.getTextContent(); pages.push(text.items.map((item) => 'str' in item ? item.str : '').join(' ')); }
      expect(pages.every((page) => page.includes('Позиция'))).toBe(true); expect(pages.join(' ')).toContain('Материал №89'); expect(pages.join(' ')).toContain('Қазақстан');
    } finally { await loading.destroy(); }
  });
  it('keeps all text when one table row continues onto another page', async () => {
    const input = documentInput([{ type: 'table', attrs: { id: 't' }, content: [{ type: 'tableRow', attrs: { id: 'r' }, content: [{ type: 'tableCell', attrs: { id: 'c' }, content: Array.from({ length: 120 }, (_, n) => paragraph(`p${n}`, `Unique line ${n}`)) }] }] }]);
    const result = await renderPdf(input), loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: false, disableFontFace: true });
    try { const pdf = await loading.promise; let all = ''; for (let page = 1; page <= pdf.numPages; page++) all += (await (await pdf.getPage(page)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ') + ' '; for (let n = 0; n < 120; n++) expect(all).toContain(`Unique line ${n}`); } finally { await loading.destroy(); }
  });
  it('rejects an unsupported font unless the frozen request explicitly chooses replacement', async () => {
    const input = documentInput([{ type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'Font requirement', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Unavailable Brand Face' } }] }] }]);
    await expect(renderDocx(input)).rejects.toMatchObject({ messageKey: 'exports.errors.fontUnavailable' });
    input.options.replaceUnsupportedFonts = true; expect((await renderDocx(input)).warnings).toEqual([{ code: 'font-replaced', message: 'Unavailable Brand Face' }]);
  });
  it('fails on an inaccessible image instead of generating a misleading empty file', async () => {
    const input = documentInput([{ type: 'image', attrs: { id: 'img', assetId: 'a873a7e4-f334-4be7-a951-2b6baeb038a0', width: 400, height: 300 } }]);
    input.assets.image = async () => { throw new Error('Image access revoked'); };
    await expect(renderDocx(input)).rejects.toThrow('Image access revoked'); await expect(renderPdf(input)).rejects.toThrow('Image access revoked');
  });
});
