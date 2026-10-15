import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { documentExtensions } from '@/features/documents/client/extensions';
import { fromEditorJson, readDocument } from '@/features/documents/domain/document';
import { document, paragraph } from './fixtures';
import { snapshot } from './fixtures';
import { documentOperations } from '@/features/documents/domain/commands';

describe('Tiptap canonical roundtrip without a browser', () => {
  it('preserves identifiers, link titles, styles, list starts and table geometry', () => {
    const input = document([
      { type: 'heading', attrs: { id: 'heading', level: 6, textAlign: 'center' }, content: [{ type: 'text', text: 'Ә Ғ Қ Ң Ө Ұ Ү Һ І', marks: [{ type: 'link', attrs: { href: 'https://example.org', title: 'Terms' } }, { type: 'textStyle', attrs: { fontSize: 18, color: '#086a70', fontFamily: 'Arial' } }] }] },
      { type: 'orderedList', attrs: { id: 'list', start: 3 }, content: [{ type: 'listItem', attrs: { id: 'li' }, content: [paragraph('item', 'Item')] }] },
      { type: 'table', attrs: { id: 'table' }, content: [{ type: 'tableRow', attrs: { id: 'row' }, content: [{ type: 'tableHeader', attrs: { id: 'cell', colspan: 1, rowspan: 1, colwidth: [180] }, content: [paragraph('inside', 'Meaning')] }] }] },
      { type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'dataField', attrs: { id: 'field', value: '12 000 ₸' } }] },
      { type: 'image', attrs: { id: 'image', assetId: crypto.randomUUID(), alt: 'Image', width: 100, height: 50 } },
      { type: 'pageBreak', attrs: { id: 'break' } },
    ]);
    const schema = getSchema(documentExtensions({ workspaceId: '', userId: '', unavailable: '' }));
    const result = fromEditorJson(schema.nodeFromJSON(input.document).toJSON());
    expect(result).toEqual(readDocument(input));
    expect(schema.nodes.codeBlock).toBeUndefined(); expect(schema.nodes.horizontalRule).toBeUndefined();
  });
  it('does not rewrite unrelated imported formatting when editing a different paragraph', async () => {
    const input = document([{ type: 'paragraph', attrs: { id: 'marked' }, content: [{ type: 'text', text: 'Untouched', marks: [{ type: 'italic' }, { type: 'bold' }] }] }, paragraph('edit', 'Before')]);
    const schema = getSchema(documentExtensions({ workspaceId: '', userId: '', unavailable: '' }));
    const output = schema.nodeFromJSON(input.document).toJSON();
    output.content[1].content[0].text = 'After';
    const desired = fromEditorJson(output, input);
    expect(desired.document.content![0]).toEqual(input.document.content![0]);
    expect((await documentOperations(snapshot(input), desired, 'Manual edit')).map((operation) => operation.targetId)).toEqual(['edit']);
  });
});
