import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type TextMatch = { from: number; to: number };
export type FindState = { query: string; matchCase: boolean; active: number };
export const documentFindKey = new PluginKey<FindState>('tirlikDocumentFind');
export function findDocumentText(doc: ProseMirrorNode, query: string, matchCase = false): TextMatch[] {
  if (!query || query.length > 200) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  const matches: TextMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, '\n', '\ufffc');
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      if (!match[0].includes('\ufffc')) matches.push({ from: position + 1 + match.index, to: position + 1 + match.index + match[0].length });
      if (matches.length >= 5000) break;
    }
    return false;
  });
  return matches.slice(0, 5000);
}

export function documentFindPlugin() {
  return new Plugin<FindState>({
    key: documentFindKey,
    state: { init: () => ({ query: '', matchCase: false, active: 0 }), apply: (transaction, previous) => transaction.getMeta(documentFindKey) as FindState | undefined ?? previous },
    props: { decorations(state) {
      const find = documentFindKey.getState(state)!;
      return DecorationSet.create(state.doc, findDocumentText(state.doc, find.query, find.matchCase).map((match, index) => Decoration.inline(match.from, match.to, { class: index === find.active ? 'document-match document-match-active' : 'document-match' })));
    } },
  });
}
