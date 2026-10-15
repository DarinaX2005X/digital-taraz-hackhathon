import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, PageBreak } from 'docx';
import JSZip from 'jszip';
import { importDocx } from '@/features/documents/server/docx';
import { documentText } from '@/features/documents/domain/document';

describe('real DOCX structured conversion', () => {
  it('imports actual OOXML heading, Unicode, formatting, table and explicit layout report', async () => {
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph({ text: 'Ұсыныс', heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ children: [new TextRun({ text: 'Delivery terms', bold: true }), new TextRun(' in Taraz')] }),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Price')] }), new TableCell({ children: [new Paragraph('12 000 ₸')] })] })] }),
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph('After page break'),
    ] }] }));
    const result = await importDocx(bytes);
    expect(result.content.document.content!.some((node) => node.type === 'heading')).toBe(true);
    expect(result.content.document.content!.some((node) => node.type === 'table')).toBe(true);
    expect(result.content.document.content!.some((node) => node.type === 'pageBreak')).toBe(true);
    expect(documentText(result.content.document)).toContain('12 000 ₸');
    expect(documentText(result.content.document)).toContain('Ұсыныс');
    expect(result.losses).toContainEqual({ code: 'layout', count: 1 });
    expect(JSON.stringify(result.content)).toContain('bold');
  });
  it('rejects non-Word archives and unsafe XML before conversion', async () => {
    const archive = new JSZip(); archive.file('[Content_Types].xml', '<Types/>');
    await expect(importDocx(await archive.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('invalid-docx');
    archive.file('word/document.xml', '<!DOCTYPE test [<!ENTITY x SYSTEM "file:///secret">]><doc/>');
    await expect(importDocx(await archive.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow();
  });
});
