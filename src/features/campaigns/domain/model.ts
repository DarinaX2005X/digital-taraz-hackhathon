import type { FieldBinding, SourceRef } from '@/contracts/artifacts';
import type { Locale, Money, Quantity } from '@/contracts/primitives';
import { currencyMinorUnitScale } from '@/contracts/calculations';
import type { ArtifactContent, DesignLayer } from '@/features/artifacts/domain/content-models';
import { validateArtifactContent } from '@/features/artifacts/domain/semantic-validation';
import { layerBounds } from '@/features/designs/domain/geometry';

export type CampaignCondition = {
  id: string;
  kind: 'price' | 'date' | 'quantity' | 'text';
  value: Money | Quantity | string;
  sourceRef: SourceRef;
};

export type CampaignFormat = {
  id: string;
  width: number;
  height: number;
  unit: 'px' | 'mm';
  locale: Locale;
};

export type CampaignComposition = 'editorial-focus' | 'split-proof';

export type CampaignVariantDraft = {
  id: string;
  name: string;
  composition: CampaignComposition;
  content: Extract<ArtifactContent, { kind: 'design' }>;
  bindings: FieldBinding[];
  checks: CampaignDesignCheck[];
};

export type CampaignDesignCheck = {
  code: 'bounds' | 'text-capacity' | 'asset-present' | 'condition-bound';
  status: 'passed' | 'failed' | 'unknown';
  targetIds: string[];
  sourceRefs: SourceRef[];
};

const localeTags: Record<Locale, string> = { ru: 'ru-KZ', kk: 'kk-KZ', en: 'en-GB' };

export function conditionText(condition: CampaignCondition, locale: Locale): string {
  if (condition.kind === 'price' && typeof condition.value === 'object' && 'currency' in condition.value) {
    const scale = currencyMinorUnitScale(condition.value.currency);
    const minor = BigInt(condition.value.minorUnits), factor = 10n ** BigInt(scale), whole = minor / factor;
    if (minor <= BigInt(Number.MAX_SAFE_INTEGER)) {
      const major = Number(minor) / 10 ** scale;
      return new Intl.NumberFormat(localeTags[locale], { style: 'currency', currency: condition.value.currency, minimumFractionDigits: scale, maximumFractionDigits: scale }).format(major);
    }
    const fraction = scale ? `.${String(minor % factor).padStart(scale, '0')}` : '';
    return `${whole}${fraction} ${condition.value.currency}`;
  }
  if (condition.kind === 'quantity' && typeof condition.value === 'object' && 'decimal' in condition.value) return `${condition.value.decimal} ${condition.value.unit}`;
  if (condition.kind === 'date' && typeof condition.value === 'string') {
    const instant = new Date(`${condition.value}T12:00:00.000Z`);
    return Number.isFinite(instant.getTime()) ? new Intl.DateTimeFormat(localeTags[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(instant) : condition.value;
  }
  return typeof condition.value === 'string' ? condition.value : JSON.stringify(condition.value);
}

function descendants(layers: readonly DesignLayer[]): DesignLayer[] {
  return layers.flatMap((layer) => [layer, ...descendants(layer.layers ?? [])]);
}

function textFits(layer: DesignLayer) {
  if (layer.type !== 'text') return true;
  const size = typeof layer.style.fontSize === 'number' ? layer.style.fontSize : 16;
  const lineHeight = typeof layer.style.lineHeight === 'number' ? layer.style.lineHeight : 1.2;
  const charactersPerLine = Math.max(1, Math.floor(layer.transform.width / Math.max(1, size * 0.54)));
  const estimatedLines = (layer.text ?? '').split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil([...line].length / charactersPerLine)), 0);
  return estimatedLines * size * lineHeight <= layer.transform.height * 1.04;
}

export function checkCampaignDesign(content: CampaignVariantDraft['content'], bindings: readonly FieldBinding[], hasAsset: boolean): CampaignDesignCheck[] {
  const checks: CampaignDesignCheck[] = [];
  for (const page of content.pages) {
    const layers = descendants(page.layers);
    const outside = layers.filter((layer) => {
      const bounds = layerBounds(layer);
      return bounds.x < -0.01 || bounds.y < -0.01 || bounds.x + bounds.width > page.width + 0.01 || bounds.y + bounds.height > page.height + 0.01;
    });
    checks.push({ code: 'bounds', status: outside.length ? 'failed' : 'passed', targetIds: outside.map((item) => item.id), sourceRefs: [] });
    const overflowing = layers.filter((layer) => !textFits(layer));
    checks.push({ code: 'text-capacity', status: overflowing.length ? 'failed' : 'passed', targetIds: overflowing.map((item) => item.id), sourceRefs: [] });
    const images = layers.filter((layer) => layer.type === 'image');
    checks.push({ code: 'asset-present', status: hasAsset ? (images.length ? 'passed' : 'failed') : 'unknown', targetIds: images.map((item) => item.id), sourceRefs: [] });
  }
  const boundTargets = new Set(bindings.map((binding) => binding.targetElementId));
  const conditionLayers = content.pages.flatMap((page) => descendants(page.layers)).filter((layer) => layer.name?.startsWith('condition:'));
  const unbound = conditionLayers.filter((layer) => !boundTargets.has(layer.id));
  checks.push({ code: 'condition-bound', status: unbound.length ? 'failed' : 'passed', targetIds: unbound.map((item) => item.id), sourceRefs: bindings.map((item) => item.sourceRef) });
  validateArtifactContent(content);
  return checks;
}

