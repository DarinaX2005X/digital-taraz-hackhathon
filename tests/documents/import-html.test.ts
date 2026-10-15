import { describe, expect, it } from 'vitest';
import { importDocumentHtml } from '@/features/documents/domain/import-html';
import { documentText } from '@/features/documents/domain/document';

describe('safe structured paste/import', () => {
  it('preserves headings, nested lists, links, Unicode and merged table cells', () => {
    const { content, losses } = importDocumentHtml('<h2>Ұсыныс</h2><ol start="3"><li>First<ul><li><b>Nested</b></li></ul></li></ol><p><a href="https://example.org">Terms</a></p><table><tr><th colspan="2">Price</th></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(content.document.content!.map((node) => node.type)).toEqual(['heading', 'orderedList', 'paragraph', 'table']);
    expect(content.document.content![1]!.attrs!.start).toBe(3);
    expect(content.document.content![3]!.content![0]!.content![0]!.attrs!.colspan).toBe(2);
    expect(losses).toEqual([]);
  });
  it('drops active content and remote images without fetching or retaining executable attributes', () => {
    const { content, losses } = importDocumentHtml('<script>steal()</script><p onclick="bad()">Safe<a href="javascript:bad()">link</a></p><img src="https://private.example/image"><svg><text>bad</text></svg>');
    expect(documentText(content.document)).toBe('Safelink');
    expect(JSON.stringify(content)).not.toMatch(/javascript|onclick|steal|https:\/\/private/);
    expect(losses.map((loss) => loss.code)).toEqual(expect.arrayContaining(['unsupported-content', 'unsafe-link', 'image-omitted']));
  });
  it('lifts trusted private images from paragraphs, preserving adjacent text and stable asset IDs', () => {
    const id = crypto.randomUUID();
    const { content, losses } = importDocumentHtml(`<p>Before<img src="tirlik-asset:${id}" alt="Lamp">After</p>`, { assetIds: new Set([id]) });
    expect(content.document.content!.map((node) => node.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(content.document.content![1]!.attrs).toMatchObject({ assetId: id, alt: 'Lamp' });
    expect(losses).toEqual([]);
  });
  it('reports malformed table flattening and keeps every cell value instead of silently clipping', () => {
    const result = importDocumentHtml('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>');
    expect(result.losses).toContainEqual({ code: 'table-flattened', count: 1 });
    expect(documentText(result.content.document)).toBe('A\tB\nC');
  });
  it('bounds large and deeply nested clipboard input', () => {
    expect(() => importDocumentHtml('x'.repeat(2 * 1024 * 1024 + 1))).toThrow('paste-too-large');
    expect(() => importDocumentHtml('<div>'.repeat(35) + 'text' + '</div>'.repeat(35))).toThrow('document-too-complex');
  });
});
