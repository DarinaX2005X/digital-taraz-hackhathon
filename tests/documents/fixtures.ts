import { snapshot as artifactSnapshot } from '../artifacts/client/fixtures';
import type { DocumentContent, DocumentNode } from '@/features/documents/domain/document';

export const paragraph = (id: string, text = ''): DocumentNode => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : [] });
export function document(content: DocumentNode[] = [paragraph('first', 'Ұсыныс'), paragraph('second', 'Delivery in Taraz')]): DocumentContent {
  return { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content } };
}
export function snapshot(content = document()) { return { ...artifactSnapshot(), content, history: [] }; }
