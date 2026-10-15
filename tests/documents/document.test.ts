import { describe, expect, it } from 'vitest';
import { assignDocumentIds, fromEditorJson, migrateDocument, parseDocument, readDocument, serializeDocument } from '@/features/documents/domain/document';
import { document, paragraph } from './fixtures';

describe('canonical document schema', () => {
  it('roundtrips Kazakh, marks, linked values, image references, tables and page breaks', () => {
    const value = document([
      { type: 'heading', attrs: { id: 'heading', level: 2 }, content: [{ type: 'text', text: 'Ә Ғ Қ Ң Ө Ұ Ү Һ І', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.org' } }] }] },
      { type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'dataField', attrs: { id: 'price', value: '12 000 ₸' } }] },
      { type: 'image', attrs: { id: 'image', assetId: crypto.randomUUID(), alt: 'Product', width: 600, height: 400 } },
      { type: 'pageBreak', attrs: { id: 'break' } },
      { type: 'table', attrs: { id: 'table' }, content: [{ type: 'tableRow', attrs: { id: 'row' }, content: [{ type: 'tableCell', attrs: { id: 'cell', colspan: 1, rowspan: 1 }, content: [paragraph('inside', 'Meaning')] }] }] },
    ]);
    expect(parseDocument(serializeDocument(value))).toEqual(value);
  });
  it('migrates only explicit legacy versions and keeps the original input intact', () => {
    const legacy = { kind: 'document', schemaVersion: 0, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Өз мәтіні' }] }] } };
    const result = migrateDocument(legacy);
    expect(result.migrated).toBe(true);
    expect(result.content.document.attrs?.id).toBeTruthy();
    expect(legacy.document).not.toHaveProperty('attrs');
    expect(migrateDocument(result.content).migrated).toBe(false);
    expect(() => migrateDocument({ ...legacy, schemaVersion: 99 })).toThrow('unsupported-document-version');
  });
  it('normalizes known engine defaults but rejects unsafe or unknown document content', () => {
    const value = document(); value.document.content![0]!.attrs!.textAlign = null;
    expect(fromEditorJson(value.document).document.content![0]!.attrs).toEqual({ id: 'first' });
    value.document.content![0]!.attrs!.onclick = 'alert(1)';
    expect(() => fromEditorJson(value.document)).toThrow('unsupported-node-attribute');
    expect(() => readDocument(document([{ type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }]))).toThrow('invalid-link');
  });
  it('repairs pasted duplicate IDs without changing the first original ID', () => {
    const value = document([paragraph('same', 'A'), paragraph('same', 'B')]);
    const fixed = assignDocumentIds(value.document);
    expect(fixed.content![0]!.attrs!.id).toBe('same');
    expect(fixed.content![1]!.attrs!.id).not.toBe('same');
    expect(readDocument({ ...value, document: fixed })).toBeTruthy();
  });
});
