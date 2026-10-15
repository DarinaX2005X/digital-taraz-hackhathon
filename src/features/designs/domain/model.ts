import type { ArtifactContent, DesignLayer } from '@/features/artifacts/domain/content-models';
import { validateArtifactContent } from '@/features/artifacts/domain/semantic-validation';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';

export type DesignContent = Extract<ArtifactContent, { kind: 'design' }>;
export type DesignPage = DesignContent['pages'][number];
export type LayerTransform = DesignLayer['transform'];
export type { DesignLayer };
export type LayerLocation = { layer: DesignLayer; pageId: string; parentId: string; ancestors: string[]; index: number };

export class DesignActionError extends Error {
  constructor(public readonly code: 'selection' | 'locked' | 'missing' | 'last-page' | 'mixed-parents' | 'dimensions' | 'too-many' | 'read-only' | 'invalid') { super(code); }
}

export function designContent(input: unknown): DesignContent {
  const content = validateArtifactContent(input);
  if (content.kind !== 'design') throw new DesignActionError('invalid');
  return content;
}

export function layerLocations(content: DesignContent): Map<string, LayerLocation> {
  const locations = new Map<string, LayerLocation>();
  function visit(layers: DesignLayer[], pageId: string, parentId: string, ancestors: string[]) {
    layers.forEach((layer, index) => {
      locations.set(layer.id, { layer, pageId, parentId, ancestors, index });
      if (layer.layers) visit(layer.layers, pageId, layer.id, [...ancestors, layer.id]);
    });
  }
  for (const page of content.pages) visit(page.layers, page.id, page.id, [page.id]);
  return locations;
}

export function selectedRoots(content: DesignContent, ids: readonly string[]): LayerLocation[] {
  const map = layerLocations(content), selected = new Set(ids);
  if (selected.size > 500) throw new DesignActionError('too-many');
  return [...selected].map((id) => {
    const value = map.get(id);
    if (!value) throw new DesignActionError('missing');
    return value;
  }).filter((value) => !value.ancestors.some((id) => selected.has(id)));
}

export function isLayerLocked(snapshot: Pick<ArtifactSnapshot, 'locks' | 'artifact'>, location: LayerLocation): boolean {
  const ids = new Set([location.layer.id, ...location.ancestors]);
  return [...ids].some((id) => !!snapshot.locks?.[id]) || snapshot.artifact.bindings.some((binding) => ids.has(binding.targetElementId) && !!binding.lock);
}

export function newLayer(type: 'text' | 'shape' | 'image', id: string, options: { text?: string; shape?: DesignLayer['shape']; assetId?: string; width?: number; height?: number } = {}): DesignLayer {
  const layer: DesignLayer = {
    id, type, transform: { x: 48, y: 48, width: options.width ?? (type === 'text' ? 480 : 240), height: options.height ?? (type === 'text' ? 96 : 240), rotation: 0 },
    style: type === 'text' ? { fill: '#202624', fontFamily: 'Noto Sans', fontSize: 48, fontWeight: 400, fontStyle: 'normal', textAlign: 'left', lineHeight: 1.2, letterSpacing: 0, opacity: 1 } : { fill: '#086a70', strokeWidth: 0, opacity: 1 },
  };
  if (type === 'text') layer.text = options.text ?? '';
  if (type === 'shape') layer.shape = options.shape ?? 'rect';
  if (type === 'image') {
    if (!options.assetId) throw new DesignActionError('invalid');
    layer.assetId = options.assetId;
    layer.style = { opacity: 1 };
  }
  return layer;
}

export function cloneLayer(layer: DesignLayer, makeId: () => string, idMap = new Map<string, string>()): DesignLayer {
  const id = makeId(); idMap.set(layer.id, id);
  return { ...structuredClone(layer), id, ...(layer.layers ? { layers: layer.layers.map((child) => cloneLayer(child, makeId, idMap)) } : {}) };
}

export function layerText(layer: DesignLayer): string {
  if (layer.type === 'text') return layer.text ?? '';
  return '';
}
