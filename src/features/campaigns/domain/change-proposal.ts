import type { SourceRef } from '@/contracts/artifacts';
import type { DesignContent, DesignLayer } from '@/features/designs/domain/model';

import { conditionText, type CampaignCondition } from './model';

export type CampaignLayerChange = {
  layerId: string;
  pageId: string;
  before: string;
  after: string;
  conditionId: string;
  sourceRef: SourceRef;
};

function visit(layers: readonly DesignLayer[], pageId: string, output: { layer: DesignLayer; pageId: string }[]) {
  for (const layer of layers) {
    output.push({ layer, pageId });
    visit(layer.layers ?? [], pageId, output);
  }
}

/**
 * Recomputes only semantic condition text. Geometry, crop, user copy and all
 * unrelated layers stay byte-for-byte unchanged until the caller applies the
 * returned proposal through the checked artifact journal.
 */
export function proposeCampaignConditionChanges(input: {
  content: DesignContent;
  conditions: readonly CampaignCondition[];
  manuallyOverriddenLayerIds?: readonly string[];
  lockedLayerIds?: readonly string[];
}) {
  const protectedIds = new Set([...(input.manuallyOverriddenLayerIds ?? []), ...(input.lockedLayerIds ?? [])]);
  const conditionById = new Map(input.conditions.map((condition) => [condition.id, condition]));
  const locations: { layer: DesignLayer; pageId: string }[] = [];
  for (const page of input.content.pages) visit(page.layers, page.id, locations);
  const changes: CampaignLayerChange[] = [], protectedLayerIds: string[] = [];
  for (const { layer, pageId } of locations) {
    if (layer.type !== 'text' || !layer.name?.startsWith('condition:')) continue;
    const conditionId = layer.name.slice('condition:'.length), condition = conditionById.get(conditionId);
    if (!condition) continue;
    const page = input.content.pages.find((candidate) => candidate.id === pageId)!;
    const after = conditionText(condition, page.id.includes('-kk-') ? 'kk' : page.id.includes('-en-') ? 'en' : 'ru');
    if (after === (layer.text ?? '')) continue;
    if (protectedIds.has(layer.id)) { protectedLayerIds.push(layer.id); continue; }
    changes.push({ layerId: layer.id, pageId, before: layer.text ?? '', after, conditionId, sourceRef: condition.sourceRef });
  }
  return { changes, protectedLayerIds };
}

