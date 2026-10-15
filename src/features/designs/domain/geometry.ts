import { DesignActionError, type DesignLayer, type DesignPage, type LayerTransform } from './model';

export type Point = { x: number; y: number };
export type Bounds = Point & { width: number; height: number };
export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export const MIN_LAYER_SIZE = 0.01;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function rotatePoint(point: Point, degrees: number): Point {
  const angle = radians(degrees), cosine = Math.cos(angle), sine = Math.sin(angle);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

/** Coordinates are relative to the parent's top-left; rotation uses that same origin. */
export function transformPoint(point: Point, transform: LayerTransform): Point {
  const rotated = rotatePoint(point, transform.rotation);
  return { x: transform.x + rotated.x, y: transform.y + rotated.y };
}

export function layerCorners(transform: LayerTransform): Point[] {
  return [{ x: 0, y: 0 }, { x: transform.width, y: 0 }, { x: transform.width, y: transform.height }, { x: 0, y: transform.height }].map((point) => transformPoint(point, transform));
}

export function boundsOfPoints(points: readonly Point[]): Bounds {
  if (!points.length) throw new DesignActionError('selection');
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export function layerBounds(layer: DesignLayer): Bounds { return boundsOfPoints(layerCorners(layer.transform)); }
export function selectionBounds(layers: readonly DesignLayer[]): Bounds { return boundsOfPoints(layers.flatMap((layer) => layerCorners(layer.transform))); }

export function translateLayer(layer: DesignLayer, x: number, y: number): DesignLayer {
  return { ...structuredClone(layer), transform: { ...layer.transform, x: layer.transform.x + x, y: layer.transform.y + y } };
}

export function alignedLayers(layers: readonly DesignLayer[], alignment: Alignment, reference?: Bounds): DesignLayer[] {
  const box = reference ?? selectionBounds(layers);
  return layers.map((layer) => {
    const own = layerBounds(layer);
    const dx = alignment === 'left' ? box.x - own.x : alignment === 'right' ? box.x + box.width - own.x - own.width : alignment === 'center-x' ? box.x + box.width / 2 - own.x - own.width / 2 : 0;
    const dy = alignment === 'top' ? box.y - own.y : alignment === 'bottom' ? box.y + box.height - own.y - own.height : alignment === 'center-y' ? box.y + box.height / 2 - own.y - own.height / 2 : 0;
    return translateLayer(layer, dx, dy);
  });
}

export function distributedLayers(layers: readonly DesignLayer[], axis: 'x' | 'y'): DesignLayer[] {
  if (layers.length < 3) throw new DesignActionError('selection');
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = layers.map((layer) => ({ layer, bounds: layerBounds(layer) })).sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  const first = sorted[0]!.bounds, last = sorted.at(-1)!.bounds;
  const gap = (last[axis] + last[size] - first[axis] - sorted.reduce((sum, entry) => sum + entry.bounds[size], 0)) / (sorted.length - 1);
  let cursor = first[axis];
  const changed = new Map(sorted.map(({ layer, bounds }) => {
    const delta = cursor - bounds[axis]; cursor += bounds[size] + gap;
    return [layer.id, translateLayer(layer, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0)];
  }));
  return layers.map((layer) => changed.get(layer.id)!);
}

/** Uniform group scaling preserves rotations without introducing an unrepresentable skew. */
export function scaleLayer(layer: DesignLayer, factor: number, scalePosition = true): DesignLayer {
  if (!Number.isFinite(factor) || factor <= 0) throw new DesignActionError('dimensions');
  const next = structuredClone(layer);
  next.transform = { ...next.transform, x: next.transform.x * (scalePosition ? factor : 1), y: next.transform.y * (scalePosition ? factor : 1), width: next.transform.width * factor, height: next.transform.height * factor };
  for (const key of ['fontSize', 'strokeWidth', 'radius']) if (typeof next.style[key] === 'number') next.style[key] *= factor;
  if (next.layers) next.layers = next.layers.map((child) => scaleLayer(child, factor));
  return next;
}

export function resizeLayer(layer: DesignLayer, width: number, height: number): DesignLayer {
  if (![width, height].every((value) => Number.isFinite(value) && value >= MIN_LAYER_SIZE && value <= 100000)) throw new DesignActionError('dimensions');
  if (layer.type === 'group') {
    const factor = width / layer.transform.width;
    if (Math.abs(height - layer.transform.height * factor) > 0.01) throw new DesignActionError('dimensions');
    return scaleLayer(layer, factor, false);
  }
  return { ...structuredClone(layer), transform: { ...layer.transform, width, height } };
}

export function ungroupLayer(group: DesignLayer): DesignLayer[] {
  if (group.type !== 'group') throw new DesignActionError('selection');
  return (group.layers ?? []).map((layer) => {
    const next = structuredClone(layer), point = transformPoint(layer.transform, group.transform);
    next.transform = { ...next.transform, ...point, rotation: next.transform.rotation + group.transform.rotation };
    if (group.hidden) next.hidden = true;
    const groupOpacity = typeof group.style.opacity === 'number' ? group.style.opacity : 1;
    if (groupOpacity !== 1) next.style.opacity = groupOpacity * (typeof next.style.opacity === 'number' ? next.style.opacity : 1);
    return next;
  });
}

export type SnapResult = { transform: LayerTransform; guides: { axis: 'x' | 'y'; position: number }[] };
export function snapLayer(layer: DesignLayer, page: Pick<DesignPage, 'width' | 'height'>, peers: readonly DesignLayer[], tolerance: number): SnapResult {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new DesignActionError('invalid');
  const own = layerBounds(layer);
  const candidates = { x: [0, page.width / 2, page.width], y: [0, page.height / 2, page.height] };
  for (const peer of peers) {
    if (peer.hidden || peer.id === layer.id) continue;
    const box = layerBounds(peer);
    candidates.x.push(box.x, box.x + box.width / 2, box.x + box.width);
    candidates.y.push(box.y, box.y + box.height / 2, box.y + box.height);
  }
  const guides: SnapResult['guides'] = [], transform = { ...layer.transform };
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? own.width : own.height;
    let best: { delta: number; position: number } | undefined;
    for (const edge of [own[axis], own[axis] + size / 2, own[axis] + size]) for (const position of candidates[axis]) {
      const delta = position - edge;
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, position };
    }
    if (best) { transform[axis] += best.delta; guides.push({ axis, position: best.position }); }
  }
  return { transform, guides };
}

export function fitPage(page: Pick<DesignPage, 'width' | 'height'>, available: { width: number; height: number }, padding = 32): number {
  return Math.max(0.01, Math.min(4, (Math.max(1, available.width) - Math.min(padding * 2, available.width / 2)) / page.width, (Math.max(1, available.height) - Math.min(padding * 2, available.height / 2)) / page.height));
}
