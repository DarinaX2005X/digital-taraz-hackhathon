'use client';

import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { documentFindPlugin } from './find';

const identified = ['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'pageBreak', 'dataField'];
export const StableDocumentIds = Extension.create({
  name: 'stableDocumentIds',
  addGlobalAttributes() { return [{ types: identified, attributes: { id: { default: null, parseHTML: () => null, renderHTML: (attrs) => ({ 'data-document-id': attrs.id }) } } }]; },
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction(transactions, _old, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const seen = new Set<string>();
      const transaction = state.tr;
      const rootId = typeof state.doc.attrs.id === 'string' ? state.doc.attrs.id : crypto.randomUUID();
      seen.add(rootId);
      if (state.doc.attrs.id !== rootId) transaction.setDocAttribute('id', rootId);
      state.doc.descendants((node, position) => {
        if (!identified.includes(node.type.name)) return;
        let id = typeof node.attrs.id === 'string' ? node.attrs.id : undefined;
        if (!id || seen.has(id)) id = crypto.randomUUID();
        seen.add(id);
        if (node.attrs.id !== id) transaction.setNodeMarkup(position, undefined, { ...node.attrs, id });
      });
      return transaction.docChanged ? transaction : null;
    } }), documentFindPlugin()];
  },
});

export const DocumentTextStyle = Mark.create({
  name: 'textStyle',
  addAttributes() {
    return {
      color: { default: null, parseHTML: (element) => element.style.color || null },
      backgroundColor: { default: null, parseHTML: (element) => element.style.backgroundColor || null },
      fontSize: { default: null, parseHTML: (element) => element.style.fontSize.endsWith('px') ? Number.parseFloat(element.style.fontSize) : null },
      fontFamily: { default: null, parseHTML: (element) => element.style.fontFamily.replace(/["']/g, '') || null },
    };
  },
  parseHTML() { return [{ tag: 'span[style]' }]; },
  renderHTML({ mark }) {
    const attrs = mark.attrs;
    const style = [attrs.color ? `color:${attrs.color}` : '', attrs.backgroundColor ? `background-color:${attrs.backgroundColor}` : '', attrs.fontSize ? `font-size:${attrs.fontSize}px` : '', attrs.fontFamily ? `font-family:${attrs.fontFamily}` : ''].filter(Boolean).join(';');
    return ['span', { style }, 0];
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'document-page-break' })],
});
export const DataField = Node.create({
  name: 'dataField', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ value: { default: '', parseHTML: (element) => element.textContent ?? '' } }),
  parseHTML: () => [{ tag: 'span[data-document-field]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-document-field': '', class: 'document-data-field' }), String(node.attrs.value)],
  renderText: ({ node }) => String(node.attrs.value),
});

type ImageOptions = { workspaceId: string; userId: string; unavailable: string };
function PrivateImageView({ node, selected, extension }: NodeViewProps) {
  const options = extension.options as ImageOptions;
  const [image, setImage] = useState<{ assetId: string; url: string } | null>(null);
  const assetId = String(node.attrs.assetId);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl: string | undefined;
    void fetch(`/api/sources/assets/${encodeURIComponent(assetId)}?workspaceId=${encodeURIComponent(options.workspaceId)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'X-Tirlik-User-Id': options.userId } })
      .then(async (response) => { if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(response.headers.get('content-type')?.split(';')[0] ?? '')) throw new Error('image-unavailable'); return response.blob(); })
      .then((blob) => { if (controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setImage({ assetId, url: objectUrl }); })
      .catch(() => { if (!controller.signal.aborted) setImage(null); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, options.workspaceId, options.userId]);
  return <NodeViewWrapper as="figure" data-selected={selected || undefined} className="document-image" contentEditable={false}>
    {image?.assetId === assetId ?
      // Private image URLs are short-lived browser blobs, not public optimization URLs.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image.url} alt={String(node.attrs.alt ?? '')} width={typeof node.attrs.width === 'number' ? node.attrs.width : undefined} height={typeof node.attrs.height === 'number' ? node.attrs.height : undefined} /> :
      <span role="status"><ImageOff aria-hidden="true" size={24} />{options.unavailable}</span>}
  </NodeViewWrapper>;
}
export const PrivateImage = Node.create<ImageOptions>({
  name: 'image', group: 'block', atom: true, draggable: true,
  addOptions: () => ({ workspaceId: '', userId: '', unavailable: '' }),
  addAttributes: () => ({ assetId: { default: null }, alt: { default: null }, title: { default: null }, width: { default: null }, height: { default: null } }),
  // Pasted HTML cannot claim access to an arbitrary private asset.
  parseHTML: () => [],
  renderHTML: ({ HTMLAttributes }) => ['figure', { 'data-image-asset': HTMLAttributes.assetId }],
  addNodeView: () => ReactNodeViewRenderer(PrivateImageView),
});
