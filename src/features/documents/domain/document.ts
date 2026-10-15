import { ArtifactContentSchema, DocumentNodeSchema, type ArtifactContent, type DocumentNode, type JsonValue } from '@/features/artifacts/domain/content-models';
import { validateArtifactContent } from '@/features/artifacts/domain/semantic-validation';
import { assertBoundedJson, ContentValidationError } from '@/features/artifacts/domain/canonical';

export type DocumentContent = Extract<ArtifactContent, { kind: 'document' }>;
export type { DocumentNode };
export const DOCUMENT_SCHEMA_VERSION = 1;
export const newDocumentId = () => crypto.randomUUID();

export function readDocument(value: unknown): DocumentContent {
  const content = validateArtifactContent(value);
  if (content.kind !== 'document') throw new ContentValidationError('document-required');
  return content;
}

/** Only editor defaults are removed here. Unknown attributes still fail the canonical validator. */
export function fromEditorJson(value: unknown): DocumentContent {
  assertBoundedJson(value);
  const root = DocumentNodeSchema.parse(value);
  function clean(node: DocumentNode): DocumentNode {
    const attrs = { ...node.attrs };
    for (const key of ['textAlign', 'colwidth', 'alt', 'title', 'width', 'height']) if (attrs[key] === null) delete attrs[key];
    const marks = node.marks?.map((mark) => {
      const attributes = { ...mark.attrs };
      if (mark.type === 'link') for (const key of ['target', 'rel', 'class']) delete attributes[key];
      for (const key of Object.keys(attributes)) if (attributes[key] === null) delete attributes[key];
      return { type: mark.type, ...(Object.keys(attributes).length ? { attrs: attributes } : {}) };
    });
    return { type: node.type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(node.text !== undefined ? { text: node.text } : {}), ...(marks?.length ? { marks } : {}), ...(node.content ? { content: node.content.map(clean) } : {}) };
  }
  return readDocument({ kind: 'document', schemaVersion: DOCUMENT_SCHEMA_VERSION, document: clean(root) });
}

export function assignDocumentIds(node: DocumentNode, makeId = newDocumentId, regenerate = false): DocumentNode {
  const seen = new Set<string>();
  function visit(item: DocumentNode): DocumentNode {
    const result = { ...item };
    if (!['text', 'hardBreak'].includes(item.type)) {
      let id = !regenerate && typeof item.attrs?.id === 'string' ? item.attrs.id : undefined;
      if (!id || seen.has(id)) id = makeId();
      if (seen.has(id)) throw new ContentValidationError('duplicate-element-id');
      seen.add(id);
      result.attrs = { ...item.attrs, id };
    }
    if (item.content) result.content = item.content.map(visit);
    return result;
  }
  return visit(node);
}

export function migrateDocument(value: unknown, makeId = newDocumentId): { content: DocumentContent; migrated: boolean } {
  assertBoundedJson(value);
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) throw new ContentValidationError('missing-schema-version');
  if (value.schemaVersion === DOCUMENT_SCHEMA_VERSION) return { content: readDocument(value), migrated: false };
  if (value.schemaVersion !== 0 || !('document' in value) || !('kind' in value) || value.kind !== 'document') throw new ContentValidationError('unsupported-document-version');
  const document = DocumentNodeSchema.parse(value.document);
  return { content: readDocument({ kind: 'document', schemaVersion: 1, document: assignDocumentIds(document, makeId) }), migrated: true };
}

export function serializeDocument(content: DocumentContent): string { return JSON.stringify(readDocument(content)); }
export function parseDocument(serialized: string): DocumentContent {
  if (serialized.length > 20 * 1024 * 1024) throw new ContentValidationError('content-too-large');
  return readDocument(ArtifactContentSchema.parse(JSON.parse(serialized)));
}
export function nodeId(node: DocumentNode | undefined): string | undefined { return typeof node?.attrs?.id === 'string' ? node.attrs.id : undefined; }
export function documentText(node: DocumentNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'dataField') return String(node.attrs?.value ?? '');
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(documentText).join(['paragraph', 'heading'].includes(node.type) ? '' : '\n');
}
export function asJson(value: DocumentNode | DocumentContent): JsonValue { return value as unknown as JsonValue; }
