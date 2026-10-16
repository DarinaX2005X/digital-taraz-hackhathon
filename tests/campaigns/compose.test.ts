import { describe, expect, it } from 'vitest';

import { composeCampaignVariants } from '@/features/campaigns/domain/compose-campaign';
import { proposeCampaignConditionChanges } from '@/features/campaigns/domain/change-proposal';
import { conditionText } from '@/features/campaigns/domain/model';

const ref = { sourceId: 'd98b9384-a9ee-41af-a1bf-29ea46cb3411', sourceVersionId: 'a9522b89-b41b-42b4-940a-c5880bd237c5', revision: 3 };
const formats = [
  { id: 'square-ru', width: 1080, height: 1080, unit: 'px' as const, locale: 'ru' as const },
  { id: 'story-kk', width: 1080, height: 1920, unit: 'px' as const, locale: 'kk' as const },
  { id: 'banner-en', width: 1600, height: 900, unit: 'px' as const, locale: 'en' as const },
];

describe('campaign composition', () => {
  it('builds materially distinct editable variants, pages, image layers and semantic condition bindings', () => {
    const variants = composeCampaignVariants({ brief: 'Create a useful launch kit from our own product photo.', formats, assetRefs: ['267c8a7a-c0d2-4424-b19a-681f5239ae70'], conditions: [
      { id: 'price', kind: 'price', value: { currency: 'KZT', minorUnits: '1299000' }, sourceRef: ref },
      { id: 'date', kind: 'date', value: '2026-11-01', sourceRef: ref },
    ] });
    expect(variants.map((item) => item.composition)).toEqual(['editorial-focus', 'split-proof']);
    expect(variants.every((item) => item.content.pages.length === 3)).toBe(true);
    expect(variants.every((item) => item.bindings.length === 6)).toBe(true);
    expect(variants.flatMap((item) => item.checks).filter((item) => item.code === 'condition-bound').every((item) => item.status === 'passed')).toBe(true);
    expect(variants[0]!.content.pages[0]!.layers.some((layer) => layer.type === 'image')).toBe(true);
    expect(variants[0]!.content).not.toEqual(variants[1]!.content);
  });

  it('returns a usable image-free kit and marks only asset confidence unknown', () => {
    const variants = composeCampaignVariants({ brief: 'Seasonal service reminder.', formats: [formats[0]!], assetRefs: [], conditions: [{ id: 'date', kind: 'date', value: '2026-12-15', sourceRef: ref }] });
    expect(variants).toHaveLength(2);
    expect(variants.every((item) => item.checks.find((check) => check.code === 'asset-present')?.status === 'unknown')).toBe(true);
    expect(variants.every((item) => item.content.pages[0]!.layers.some((layer) => layer.name === 'Image area') || item.composition === 'split-proof')).toBe(true);
  });

  it('formats money beyond JavaScript safe integers without losing minor units', () => {
    expect(conditionText({ id: 'large-price', kind: 'price', value: { currency: 'KZT', minorUnits: '900719925474099300' }, sourceRef: ref }, 'en')).toBe('9007199254740993.00 KZT');
  });

  it('proposes only condition text changes and preserves protected manual layers', () => {
    const [variant] = composeCampaignVariants({ brief: 'Offer', formats: [formats[0]!], assetRefs: [], conditions: [{ id: 'date', kind: 'date', value: '2026-11-01', sourceRef: ref }] });
    const condition = variant!.content.pages[0]!.layers.find((layer) => layer.name === 'condition:date')!;
    const changed = proposeCampaignConditionChanges({ content: variant!.content, conditions: [{ id: 'date', kind: 'date', value: '2026-12-20', sourceRef: ref }], manuallyOverriddenLayerIds: [condition.id] });
    expect(changed.changes).toEqual([]);
    expect(changed.protectedLayerIds).toEqual([condition.id]);
    const applicable = proposeCampaignConditionChanges({ content: variant!.content, conditions: [{ id: 'date', kind: 'date', value: '2026-12-20', sourceRef: ref }] });
    expect(applicable.changes).toHaveLength(1);
    expect(applicable.changes[0]).toMatchObject({ layerId: condition.id, conditionId: 'date' });
    expect(variant!.content.pages[0]!.layers.find((layer) => layer.id === condition.id)!.text).toContain('ноября');
  });
});

