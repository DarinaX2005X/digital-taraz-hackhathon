import type { SourceRef } from '@/contracts/artifacts';
import type { MaterialValue } from '@/contracts/materials';
import type { Locale } from '@/i18n';
import type { ArtifactSnapshot, SourceFreshness } from '@/features/artifacts/contracts';
import type { ArtifactOperation, OperationContext } from '@/features/artifacts/domain/operations';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { ContentValidationError } from '@/features/artifacts/domain/canonical';
import { documentDraft, documentOperations, commandForOperations } from './commands';
import { readDocument, type DocumentContent, type DocumentNode } from './document';
import { formatMaterialValue } from '@/features/dependencies/domain/transforms';
import type { DependencyEdge } from '@/contracts/dependency-edges';

/** Exact decimal formatting does not pass prices through binary floating-point. */
export function materialText(value: MaterialValue, locale: Locale): string {
  return formatMaterialValue(value, locale);
}

function context(snapshot: ArtifactSnapshot, reason: string): OperationContext { return { actorId: snapshot.viewer.userId, at: new Date().toISOString(), reason, origin: 'human' }; }
function edge(snapshot: ArtifactSnapshot, targetId: string, sourceRef: SourceRef, locale: Locale, reason: string): DependencyEdge {
  return { id: crypto.randomUUID(), inputs: [{ key: 'value', ref: { kind: 'source', sourceRef } }], target: { artifactId: snapshot.artifact.id, targetElementId: targetId }, transform: { kind: 'material-format', input: 'value', locale }, updateMode: 'deterministic', label: reason };
}

export function replaceDocumentFieldValue(content: DocumentContent, targetId: string, value: string): DocumentContent {
  let found = false;
  const visit = (node: DocumentNode): DocumentNode => {
    if (node.attrs?.id === targetId && node.type === 'dataField') { found = true; return { ...node, attrs: { ...node.attrs, value } }; }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  const desired = { ...content, document: visit(content.document) };
  if (!found) throw new ContentValidationError('document-field-required');
  return readDocument(desired);
}

export async function bindDocumentField(snapshot: ArtifactSnapshot, desired: DocumentContent, targetId: string, sourceRef: SourceRef, freshness: readonly SourceFreshness[], locale: Locale, reason: string) {
  const operationContext = context(snapshot, reason);
  const operations = await documentOperations(snapshot, desired, reason, operationContext.at);
  const draft = documentDraft(snapshot);
  await draft.apply(operations, operationContext);
  const target = await draft.target(targetId);
  if (!target || (target.value as { type?: string }).type !== 'dataField') throw new ContentValidationError('document-field-required');
  const bind: ArtifactOperation = { targetId, op: 'bind', beforeHash: target.hash, value: { sourceRef, transformId: 'material-value', updateMode: 'deterministic' } };
  await draft.apply([bind], operationContext);
  return { ...commandForOperations(snapshot, [...operations, bind], reason, [sourceRef], freshness, operationContext.at), dependencyEdges: [edge(snapshot, targetId, sourceRef, locale, reason)] };
}

export async function changeDocumentField(snapshot: ArtifactSnapshot, targetId: string, action: 'override' | 'restore' | 'unbind', value: string, reason: string, sourceRef?: SourceRef, freshness: readonly SourceFreshness[] = [], locale: Locale = 'ru') {
  const operationContext = context(snapshot, reason);
  const draft = documentDraft(snapshot), target = await draft.target(targetId);
  if (!target || (target.value as { type?: string }).type !== 'dataField' || !snapshot.artifact.bindings.some((binding) => binding.targetElementId === targetId)) throw new ContentValidationError('document-field-required');
  const operations: ArtifactOperation[] = [];
  if (action !== 'unbind') {
    const node = target.value as Record<string, JsonValue>;
    const operation: ArtifactOperation = { targetId, op: 'set', beforeHash: target.hash, value: { ...node, attrs: { ...node.attrs as Record<string, JsonValue>, value } } };
    await draft.apply([operation], operationContext); operations.push(operation);
  }
  if (action !== 'override') {
    if (action === 'restore' && !sourceRef) throw new ContentValidationError('material-source-required');
    const current = await draft.target(targetId);
    const operation: ArtifactOperation = { targetId, op: action === 'unbind' ? 'unbind' : 'bind', beforeHash: current!.hash, ...(sourceRef ? { value: { sourceRef, transformId: 'material-value', updateMode: 'deterministic' } } : {}) };
    await draft.apply([operation], operationContext); operations.push(operation);
  }
  return { ...commandForOperations(snapshot, operations, reason, sourceRef ? [sourceRef] : [], freshness, operationContext.at), ...(action === 'restore' && sourceRef ? { dependencyEdges: [edge(snapshot, targetId, sourceRef, locale, reason)] } : {}) };
}
