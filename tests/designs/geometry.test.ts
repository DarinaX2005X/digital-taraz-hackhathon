import { describe, expect, it } from 'vitest';
import { alignedLayers, distributedLayers, fitPage, layerBounds, layerCorners, resizeLayer, selectionBounds, snapLayer, transformPoint, ungroupLayer } from '@/features/designs/domain/geometry';
import { selectedRoots, type DesignLayer } from '@/features/designs/domain/model';
import { content, textLayer } from './fixtures';

describe('design geometry without a render surface', () => {
  it('aligns actual rotated corners and distributes uneven object sizes', () => {
    const first = textLayer('a', 50, 20); first.transform.rotation = 90;
    const second = textLayer('b', 420, 200), third = textLayer('c', 800, 30); third.transform.width = 100;
    const aligned = alignedLayers([first, second, third], 'left');
    aligned.forEach((layer) => expect(layerBounds(layer).x).toBeCloseTo(0));
    const distributed = distributedLayers([first, second, third], 'x').map(layerBounds);
    expect(distributed[1]!.x - distributed[0]!.x - distributed[0]!.width).toBeCloseTo(distributed[2]!.x - distributed[1]!.x - distributed[1]!.width);
    expect(distributed[0]!.x).toBeCloseTo(layerBounds(first).x);
    expect(distributed[2]!.x).toBeCloseTo(layerBounds(third).x);
  });
  it('keeps nested rotation and opacity through ungroup and uniform scale', () => {
    const child = textLayer('child', 10, 20); child.transform.rotation = 30; child.style.opacity = 0.8;
    const group: DesignLayer = { id: 'group', type: 'group', transform: { x: 200, y: 300, width: 400, height: 400, rotation: 45 }, style: { opacity: 0.5 }, layers: [child] };
    const points = layerCorners(child.transform).map((point) => transformPoint(point, group.transform));
    const ungrouped = ungroupLayer(group)[0]!;
    layerCorners(ungrouped.transform).forEach((point, i) => { expect(point.x).toBeCloseTo(points[i]!.x); expect(point.y).toBeCloseTo(points[i]!.y); });
    expect(ungrouped.style.opacity).toBeCloseTo(0.4);
    const scaled = resizeLayer(group, 800, 800);
    expect(scaled.transform).toMatchObject({ x: 200, y: 300, width: 800, height: 800 });
    expect(scaled.layers![0]!.transform).toMatchObject({ x: 20, y: 40, width: 400, height: 100, rotation: 30 });
    expect(scaled.layers![0]!.style.fontSize).toBe(48);
    expect(() => resizeLayer(group, 800, 400)).toThrow('dimensions');
  });
  it('snaps to page/visible peer geometry within zoom-adjusted tolerance', () => {
    const moving = textLayer('moving', 4, 8), hidden = textLayer('hidden', 4, 8); hidden.hidden = true;
    const result = snapLayer(moving, { width: 1080, height: 1080 }, [hidden], 6);
    expect(result.transform.x).toBe(0); expect(result.transform.y).toBe(8);
    expect(result.guides).toEqual([{ axis: 'x', position: 0 }]);
    const peer = textLayer('peer', 215, 20);
    expect(snapLayer(moving, { width: 1080, height: 1080 }, [peer], 12).transform.y).toBe(0);
    const nearerPeer = textLayer('nearer-peer', 215, 14);
    expect(snapLayer(moving, { width: 1080, height: 1080 }, [nearerPeer], 12).transform.y).toBe(14);
  });
  it('deduplicates parent selections and fits tall or wide work without invalid zoom', () => {
    const design = content(), children = design.pages[0]!.layers;
    design.pages[0]!.layers = [{ id: 'group', type: 'group', transform: { x: 0, y: 0, width: 1000, height: 600, rotation: 0 }, style: {}, layers: children }];
    expect(selectedRoots(design, ['group', 'title', 'title']).map((item) => item.layer.id)).toEqual(['group']);
    expect(fitPage({ width: 1080, height: 1920 }, { width: 320, height: 600 })).toBeGreaterThan(0);
    expect(fitPage({ width: 100, height: 100 }, { width: 10000, height: 10000 })).toBe(4);
    expect(fitPage({ width: 1080, height: 1080 }, { width: 0, height: 0 })).toBe(0.01);
    expect(selectionBounds(children)).toEqual({ x: 10, y: 20, width: 790, height: 560 });
  });
});
