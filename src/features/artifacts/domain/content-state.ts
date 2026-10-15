import { z } from 'zod';
import { FieldBindingSchema, SourceRefSchema, fieldBindingIdentity, fieldBindingProperty, type FieldBinding, type SourceRef, type ArtifactKind } from '../../../contracts/artifacts';
import { ElementIdSchema, IdSchema, InstantSchema } from '../../../contracts/primitives';
import { ContentValidationError, hashJson, measureJson } from './canonical';
import type { ArtifactContent, DesignLayer, DocumentNode, JsonValue } from './content-models';
import { validateArtifactContent, uniqueIds } from './semantic-validation';
import { buildTargetIndex, locateTarget, targetPropertyValue, targetValue, type ArtifactState, type TargetLock } from './targets';

export const TargetLockSchema = z.strictObject({ reason: z.string().trim().min(1).max(1000), actorId: IdSchema, at: InstantSchema });
export const TargetLocksSchema = z.record(ElementIdSchema, TargetLockSchema);

export function createArtifactState(input: unknown, sourceRefs: readonly SourceRef[] = [], bindings: readonly FieldBinding[] = [], locks: Record<string, TargetLock> = {}): ArtifactState {
  const content = validateArtifactContent(input);
  const parsedRefs = z.array(SourceRefSchema).max(1000).parse(sourceRefs);
  const parsedBindings = z.array(FieldBindingSchema).max(10000).parse(bindings);
  const parsedLocks = TargetLocksSchema.parse(locks);
  uniqueIds(parsedBindings.map(fieldBindingIdentity), 'duplicate-binding-target');
  uniqueIds(parsedRefs.map((ref) => hashJson(ref as JsonValue)), 'duplicate-source-ref');
  const index = buildTargetIndex(content);
  const refHashes = new Set(parsedRefs.map((ref) => hashJson(ref as JsonValue)));
  for (const binding of parsedBindings) {
    const locator = locateTarget(index, binding.targetElementId);
    if (!locator) throw new ContentValidationError('missing-binding-target');
    if (binding.targetProperty) targetPropertyValue(locator.kind, targetValue(content, locator), fieldBindingProperty(binding));
    if (!refHashes.has(hashJson(binding.sourceRef as JsonValue))) throw new ContentValidationError('binding-source-not-declared');
  }
  for (const targetId of Object.keys(parsedLocks)) if (!locateTarget(index, targetId)) throw new ContentValidationError('missing-lock-target');
  const bindingRefs = new Set(parsedBindings.map((binding) => hashJson(binding.sourceRef as JsonValue)));
  return { format: 1, content, contentMetrics: measureArtifactContent(content), sourceRefs: parsedRefs.filter((ref) => !bindingRefs.has(hashJson(ref as JsonValue))), bindings: Object.fromEntries(parsedBindings.map((binding) => [fieldBindingIdentity(binding), binding])), locks: parsedLocks, retiredTargets: {}, index };
}

export function countTreeNodes(node: DocumentNode | DesignLayer): number {
  const stack: (DocumentNode | DesignLayer)[] = [node]; let count = 0;
  while (stack.length) { const current = stack.pop()!; count++; stack.push(...('transform' in current ? current.layers ?? [] : current.content ?? [])); }
  return count;
}
export function measureArtifactContent(content: ArtifactContent): ArtifactState['contentMetrics'] {
  const metrics = measureJson(content);
  return { bytes: metrics.bytes, values: metrics.values, documentNodes: content.kind === 'document' ? countTreeNodes(content.document) : 0, designLayers: content.kind === 'design' ? content.pages.reduce((sum, page) => sum + page.layers.reduce((subtotal, layer) => subtotal + countTreeNodes(layer), 0), 0) : 0 };
}

export function collectSourceRefs(state: Pick<ArtifactState, 'sourceRefs' | 'bindings'>): SourceRef[] {
  const refs = new Map(state.sourceRefs.map((ref) => [hashJson(ref as JsonValue), ref]));
  for (const binding of Object.values(state.bindings)) refs.set(hashJson(binding.sourceRef as JsonValue), binding.sourceRef);
  return [...refs.values()];
}

export function blankArtifactContent(kind: ArtifactKind, makeId: () => string = () => crypto.randomUUID().replaceAll('-', '')): ArtifactContent {
  if (kind === 'document') return { kind, schemaVersion: 1, document: { type: 'doc', attrs: { id: makeId() }, content: [{ type: 'paragraph', attrs: { id: makeId() }, content: [] }] } };
  if (kind === 'plan') return { kind, schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [] };
  if (kind === 'design') return { kind, schemaVersion: 1, pages: [{ id: makeId(), width: 1080, height: 1080, unit: 'px', background: '#ffffff', layers: [] }] };
  const sheetId = makeId();
  return {
    kind, schemaVersion: 1,
    workbook: { id: makeId(), name: 'Workbook', appVersion: '1', locale: 'ruRU', sheetOrder: [sheetId], sheets: { [sheetId]: { id: sheetId, name: 'Sheet 1', rowCount: 100, columnCount: 26, cellData: {} } } },
    stableIds: { [sheetId]: { rows: Array.from({ length: 100 }, makeId), columns: Array.from({ length: 26 }, makeId) } },
  };
}
