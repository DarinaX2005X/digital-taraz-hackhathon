import type { SourceRef } from '@/contracts/artifacts';
import type { CommandGroupDraft } from '@/features/artifacts/client/grouping';
import { createEditorArtifactState, expectedSourceRevisions as currentSourceRevisions } from '@/features/artifacts/client/snapshot-state';
import type { ArtifactSnapshot, SourceFreshness } from '@/features/artifacts/contracts';
import { collectSourceRefs } from '@/features/artifacts/domain/content-state';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import { ArtifactDraft, type ArtifactOperation, type OperationContext } from '@/features/artifacts/domain/operations';
import type { ArtifactState } from '@/features/artifacts/domain/targets';
import { alignedLayers, distributedLayers, resizeLayer, selectionBounds, translateLayer, ungroupLayer, type Alignment } from './geometry';
import { cloneLayer, DesignActionError, isLayerLocked, layerLocations, selectedRoots, type DesignContent, type DesignLayer, type DesignPage, type LayerLocation } from './model';

export type DesignAction =
  | { type: 'transform-layers'; transforms: { id: string; transform: DesignLayer['transform'] }[] }
  | { type: 'insert-layer'; pageId: string; layer: DesignLayer; beforeId?: string | null }
  | { type: 'update-layer'; id: string; patch: Partial<Omit<DesignLayer, 'id' | 'type' | 'layers'>> }
  | { type: 'replace-layer'; id: string; layer: DesignLayer }
  | { type: 'style'; ids: string[]; style: DesignLayer['style'] }
  | { type: 'translate'; ids: string[]; x: number; y: number }
  | { type: 'remove'; ids: string[] }
  | { type: 'duplicate'; ids: string[]; offset?: number }
  | { type: 'order'; ids: string[]; direction: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'group'; ids: string[] }
  | { type: 'ungroup'; ids: string[] }
  | { type: 'align'; ids: string[]; alignment: Alignment; toPage?: boolean }
  | { type: 'distribute'; ids: string[]; axis: 'x' | 'y' }
  | { type: 'lock'; ids: string[]; locked: boolean }
  | { type: 'visibility'; ids: string[]; hidden: boolean }
  | { type: 'bind'; id: string; sourceRef: SourceRef; transformId: string; value: string }
  | { type: 'bind-color'; id: string; sourceRef: SourceRef; value: string }
  | { type: 'unbind'; id: string }
  | { type: 'insert-page'; page: DesignPage; beforeId?: string | null }
  | { type: 'update-page'; id: string; patch: Partial<Omit<DesignPage, 'id' | 'layers'>> }
  | { type: 'duplicate-page'; id: string }
  | { type: 'remove-page'; id: string }
  | { type: 'move-page'; id: string; beforeId: string | null };

export type DesignActionResult = { state: ArtifactState; operations: ArtifactOperation[]; selection: string[]; pageId?: string };
type ActionOptions = { makeId?: () => string; context: OperationContext };
const json = (value: unknown): JsonValue => value as JsonValue;

/** Resolve preconditions after every operation, so one gesture has an exact reversible journal. */
export async function applyDesignAction(state: ArtifactState, action: DesignAction, options: ActionOptions): Promise<DesignActionResult> {
  if (state.content.kind !== 'design') throw new DesignActionError('invalid');
  const makeId = options.makeId ?? (() => crypto.randomUUID()), graph = new MerkleJson();
  const draft = new ArtifactDraft(graph, graph.encode(json(state))), operations: ArtifactOperation[] = [];
  const content = state.content, locations = layerLocations(content);
  let selection: string[] = [], pageId: string | undefined;

  function page(id: string) {
    const found = content.pages.find((item) => item.id === id);
    if (!found) throw new DesignActionError('missing');
    return found;
  }
  function location(id: string) {
    const found = locations.get(id);
    if (!found) throw new DesignActionError('missing');
    return found;
  }
  const metadata = { locks: state.locks, artifact: { bindings: Object.values(state.bindings) } };
  function unlocked(items: LayerLocation[], includeDescendants = false) {
    const ids = new Set(items.map((item) => item.layer.id));
    const checked = includeDescendants ? [...locations.values()].filter((item) => ids.has(item.layer.id) || item.ancestors.some((id) => ids.has(id))) : items;
    for (const item of checked) if (isLayerLocked(metadata as Pick<ArtifactSnapshot, 'locks' | 'artifact'>, item)) throw new DesignActionError('locked');
  }
  function roots(ids: string[], sameParent = false) {
    const items = selectedRoots(content, ids);
    if (!items.length) throw new DesignActionError('selection');
    if (sameParent && items.some((item) => item.parentId !== items[0]!.parentId)) throw new DesignActionError('mixed-parents');
    return items.sort((a, b) => a.index - b.index);
  }
  async function operation(targetId: string, op: ArtifactOperation['op'], value?: unknown) {
    if (operations.length >= 1000) throw new DesignActionError('too-many');
    const command: ArtifactOperation = { targetId, op, ...(value === undefined ? {} : { value: json(value) }), beforeHash: (await draft.target(targetId))?.hash ?? null };
    await draft.apply([command], options.context); operations.push(command);
  }
  async function set(layer: DesignLayer) { await operation(layer.id, 'set', layer); }
  async function duplicateMetadata(idMap: Map<string, string>) {
    for (const [oldId, newId] of idMap) {
      const binding = state.bindings[oldId], lock = state.locks[oldId] ?? binding?.lock;
      if (binding) await operation(newId, 'bind', { sourceRef: binding.sourceRef, transformId: binding.transformId, updateMode: binding.updateMode, ...(binding.override ? { overrideReason: binding.override.reason } : {}) });
      if (lock) await operation(newId, 'lock', { locked: true, reason: lock.reason });
    }
  }

  switch (action.type) {
    case 'transform-layers': {
      const items = roots(action.transforms.map((item) => item.id)); unlocked(items, true);
      if (items.length !== action.transforms.length) throw new DesignActionError('selection');
      for (const item of items) {
        const transform = action.transforms.find((entry) => entry.id === item.layer.id)!.transform;
        const resized = resizeLayer(item.layer, transform.width, transform.height);
        await set({ ...resized, transform });
      }
      selection = items.map((item) => item.layer.id); pageId = items[0]!.pageId; break;
    }
    case 'insert-layer': {
      const parent = page(action.pageId);
      if (state.locks[parent.id]) throw new DesignActionError('locked');
      await operation(action.layer.id, 'insert', { parentId: parent.id, beforeId: action.beforeId ?? null, node: action.layer });
      selection = [action.layer.id]; pageId = parent.id; break;
    }
    case 'update-layer': case 'replace-layer': {
      const item = location(action.id); unlocked([item], true);
      let next = action.type === 'replace-layer' ? structuredClone(action.layer) : { ...structuredClone(item.layer), ...structuredClone(action.patch) };
      // Clearing optional inspector fields removes the key from canonical JSON.
      next = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as unknown as DesignLayer;
      if (next.id !== item.layer.id || next.type !== item.layer.type) throw new DesignActionError('invalid');
      if (item.layer.type === 'group' && (next.transform.width !== item.layer.transform.width || next.transform.height !== item.layer.transform.height)) {
        const scaled = resizeLayer(item.layer, next.transform.width, next.transform.height);
        next = { ...next, layers: scaled.layers, style: scaled.style };
      }
      await set(next); selection = [item.layer.id]; pageId = item.pageId; break;
    }
    case 'style': case 'translate': case 'visibility': {
      const items = roots(action.ids); unlocked(items, true);
      for (const item of items) {
        if (action.type === 'style') await operation(item.layer.id, 'style', action.style);
        else if (action.type === 'translate') await set(translateLayer(item.layer, action.x, action.y));
        else await set({ ...item.layer, hidden: action.hidden });
      }
      selection = items.map((item) => item.layer.id); break;
    }
    case 'remove': {
      const items = roots(action.ids); unlocked(items, true);
      for (const item of [...items].reverse()) await operation(item.layer.id, 'remove');
      pageId = items[0]!.pageId; break;
    }
    case 'duplicate': {
      const items = roots(action.ids);
      for (const item of items) {
        // A locked group cannot accept new children, but duplicating a locked layer is safe.
        if (item.ancestors.some((id) => state.locks[id] || state.bindings[id]?.lock)) throw new DesignActionError('locked');
        const idMap = new Map<string, string>(), copy = translateLayer(cloneLayer(item.layer, makeId, idMap), action.offset ?? 24, action.offset ?? 24);
        await operation(copy.id, 'insert', { parentId: item.parentId, beforeId: null, node: copy });
        await duplicateMetadata(idMap); selection.push(copy.id);
      }
      pageId = items[0]!.pageId; break;
    }
    case 'order': {
      const items = roots(action.ids, true); unlocked(items, true);
      const parentId = items[0]!.parentId, selected = new Set(items.map((item) => item.layer.id));
      const siblings = [...locations.values()].filter((item) => item.parentId === parentId).sort((a, b) => a.index - b.index).map((item) => item.layer.id);
      let order = [...siblings];
      if (action.direction === 'front') order = [...order.filter((id) => !selected.has(id)), ...order.filter((id) => selected.has(id))];
      if (action.direction === 'back') order = [...order.filter((id) => selected.has(id)), ...order.filter((id) => !selected.has(id))];
      if (action.direction === 'forward') for (let i = order.length - 2; i >= 0; i--) if (selected.has(order[i]!) && !selected.has(order[i + 1]!)) [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
      if (action.direction === 'backward') for (let i = 1; i < order.length; i++) if (selected.has(order[i]!) && !selected.has(order[i - 1]!)) [order[i], order[i - 1]] = [order[i - 1]!, order[i]!];
      for (let i = order.length - 1; i >= 0; i--) {
        const id = order[i]!;
        if (selected.has(id)) await operation(id, 'move', { parentId, beforeId: order[i + 1] ?? null });
      }
      selection = items.map((item) => item.layer.id); break;
    }
    case 'group': {
      const items = roots(action.ids, true); if (items.length < 2) throw new DesignActionError('selection'); unlocked(items, true);
      const box = selectionBounds(items.map((item) => item.layer)), groupId = makeId(), parentId = items[0]!.parentId;
      const group: DesignLayer = { id: groupId, type: 'group', transform: { ...box, width: Math.max(0.01, box.width), height: Math.max(0.01, box.height), rotation: 0 }, style: { opacity: 1 }, layers: [] };
      await operation(groupId, 'insert', { parentId, beforeId: items[0]!.layer.id, node: group });
      for (const item of items) {
        await set(translateLayer(item.layer, -box.x, -box.y));
        await operation(item.layer.id, 'move', { parentId: groupId, beforeId: null });
      }
      selection = [groupId]; pageId = items[0]!.pageId; break;
    }
    case 'ungroup': {
      const items = roots(action.ids); unlocked(items, true);
      if (items.some((item) => item.layer.type !== 'group')) throw new DesignActionError('selection');
      for (const item of items) {
        for (const child of ungroupLayer(item.layer)) {
          await set(child);
          await operation(child.id, 'move', { parentId: item.parentId, beforeId: item.layer.id }); selection.push(child.id);
        }
        await operation(item.layer.id, 'remove');
      }
      break;
    }
    case 'align': case 'distribute': {
      const items = roots(action.ids, true); unlocked(items, true);
      const layers = items.map((item) => item.layer), parent = items[0]!.parentId;
      let reference;
      if (action.type === 'align' && action.toPage) {
        if (parent !== items[0]!.pageId) throw new DesignActionError('mixed-parents');
        const target = page(parent); reference = { x: 0, y: 0, width: target.width, height: target.height };
      }
      for (const layer of action.type === 'align' ? alignedLayers(layers, action.alignment, reference) : distributedLayers(layers, action.axis)) await set(layer);
      selection = items.map((item) => item.layer.id); break;
    }
    case 'lock': {
      const items = roots(action.ids);
      for (const item of items) await operation(item.layer.id, 'lock', { locked: action.locked, ...(action.locked ? { reason: options.context.reason } : {}) });
      selection = items.map((item) => item.layer.id); break;
    }
    case 'bind': case 'bind-color': case 'unbind': {
      const item = location(action.id); unlocked([item]);
      if(action.type==='bind-color') {
        if(!['text','shape'].includes(item.layer.type)||!/^#[\da-f]{6}$/i.test(action.value))throw new DesignActionError('invalid');
        await operation(item.layer.id,'style',{fill:action.value});
        await operation(item.layer.id,'bind',{sourceRef:action.sourceRef,transformId:'brand-color',updateMode:'propose'});
      } else if (action.type === 'bind') {
        if (item.layer.type !== 'text') throw new DesignActionError('selection');
        await set({ ...item.layer, text: action.value });
        await operation(item.layer.id, 'bind', { sourceRef: action.sourceRef, transformId: action.transformId, updateMode: 'propose' });
      } else await operation(item.layer.id, 'unbind');
      selection = [item.layer.id]; break;
    }
    case 'insert-page':
      await operation(action.page.id, 'insert', { beforeId: action.beforeId ?? null, node: action.page }); pageId = action.page.id; break;
    case 'update-page': {
      const target = page(action.id); if (state.locks[target.id]) throw new DesignActionError('locked');
      await operation(target.id, 'set', { ...target, ...action.patch }); pageId = target.id; break;
    }
    case 'duplicate-page': {
      const original = page(action.id), idMap = new Map<string, string>(), id = makeId();
      const copy = { ...structuredClone(original), id, layers: original.layers.map((layer) => cloneLayer(layer, makeId, idMap)) };
      await operation(id, 'insert', { beforeId: null, node: copy }); await duplicateMetadata(idMap); pageId = id; break;
    }
    case 'remove-page': {
      const target = page(action.id); if (content.pages.length < 2) throw new DesignActionError('last-page');
      if (state.locks[target.id]) throw new DesignActionError('locked');
      unlocked([...locations.values()].filter((item) => item.pageId === target.id), true);
      await operation(target.id, 'remove'); pageId = content.pages.find((item) => item.id !== target.id)!.id; break;
    }
    case 'move-page': page(action.id); await operation(action.id, 'move', { beforeId: action.beforeId }); pageId = action.id; break;
  }
  return { state: await draft.state(), operations, selection, ...(pageId ? { pageId } : {}) };
}

export async function prepareDesignAction(snapshot: ArtifactSnapshot, action: DesignAction, reason: string, options: { makeId?: () => string; at?: string; sourceFreshness?: readonly SourceFreshness[] } = {}): Promise<DesignActionResult & { command: CommandGroupDraft }> {
  if (!snapshot.permissions.edit || ['archived', 'trashed'].includes(snapshot.artifact.status)) throw new DesignActionError('read-only');
  const metadataAt = options.at ?? new Date().toISOString();
  const result = await applyDesignAction(createEditorArtifactState(snapshot), action, { ...options, context: { actorId: snapshot.viewer.userId, at: metadataAt, origin: 'human', reason } });
  const expectedSourceRevisions = currentSourceRevisions(snapshot, collectSourceRefs(result.state), options.sourceFreshness);
  return { ...result, command: { metadataAt, expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision }, expectedSourceRevisions,
    commands: [{ artifactId: snapshot.artifact.id, baseRevision: snapshot.artifact.currentRevision, kind: 'design', operations: result.operations, expectedSourceRevisions, reason }] } };
}

export function designFromState(state: ArtifactState): DesignContent {
  if (state.content.kind !== 'design') throw new DesignActionError('invalid');
  return state.content;
}
