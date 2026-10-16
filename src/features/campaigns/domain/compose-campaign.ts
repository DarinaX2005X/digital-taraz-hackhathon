import type { FieldBinding } from '@/contracts/artifacts';
import type { ArtifactContent, DesignLayer } from '@/features/artifacts/domain/content-models';

import { checkCampaignDesign, conditionText, type CampaignCondition, type CampaignFormat, type CampaignVariantDraft } from './model';

const copy = {
  ru: { headline: 'Предложение для вашего бизнеса', details: 'Условия', action: 'Узнать подробнее', variantA: 'Главное сообщение', variantB: 'Условия в фокусе' },
  kk: { headline: 'Бизнесіңізге арналған ұсыныс', details: 'Шарттар', action: 'Толығырақ білу', variantA: 'Негізгі хабарлама', variantB: 'Шарттарға назар' },
  en: { headline: 'An offer for your business', details: 'Terms', action: 'Learn more', variantA: 'Message first', variantB: 'Terms in focus' },
} as const;

function shortHash(value: string) {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function id(prefix: string, ...parts: string[]) {
  const readable = parts.join('-').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 72);
  return `${prefix}-${readable}-${shortHash(parts.join(':'))}`.slice(0, 128);
}

function layer(
  layerId: string,
  type: DesignLayer['type'],
  transform: DesignLayer['transform'],
  style: DesignLayer['style'],
  extra: Partial<DesignLayer> = {},
): DesignLayer {
  return { id: layerId, type, transform, style, ...extra };
}

function excerpt(value: string, maximum: number) {
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maximum) return normalized;
  const candidate = normalized.slice(0, maximum - 1);
  const boundary = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, Math.max(boundary, maximum * 0.7)).trim()}…`;
}

function dimensions(format: CampaignFormat) {
  const width = format.width, height = format.height, short = Math.min(width, height), margin = short * 0.065;
  return { width, height, short, margin, usableWidth: width - margin * 2, usableHeight: height - margin * 2, landscape: width / height > 1.15 };
}

function typography(format: CampaignFormat) {
  const { short } = dimensions(format);
  return { eyebrow: short * 0.032, headline: short * 0.084, body: short * 0.038, condition: short * 0.048, action: short * 0.038 };
}

function editorialPage(format: CampaignFormat, brief: string, conditions: readonly CampaignCondition[], assetId: string | undefined) {
  const d = dimensions(format), type = typography(format), localeCopy = copy[format.locale], pageId = id('page-editorial', format.locale, format.id);
  const visualWidth = d.landscape ? d.width * 0.42 : d.usableWidth;
  const visualHeight = d.landscape ? d.usableHeight : d.height * 0.34;
  const visualX = d.landscape ? d.width - d.margin - visualWidth : d.margin;
  const visualY = d.landscape ? d.margin : d.height - d.margin - visualHeight;
  const contentWidth = d.landscape ? d.usableWidth - visualWidth - d.margin : d.usableWidth;
  const headlineY = d.margin + type.eyebrow * 1.9;
  const conditionY = headlineY + type.headline * 2.5 + type.body * 2.7;
  const layers: DesignLayer[] = [
    layer(id('accent', pageId), 'shape', { x: 0, y: 0, width: Math.max(d.margin * 0.42, 2), height: d.height, rotation: 0 }, { fill: '#D85D36', opacity: 1 }, { shape: 'rect', name: 'Accent' }),
    layer(id('eyebrow', pageId), 'text', { x: d.margin, y: d.margin, width: contentWidth, height: type.eyebrow * 1.6, rotation: 0 }, { fill: '#37655B', fontFamily: 'Noto Sans', fontSize: type.eyebrow, fontWeight: 700, lineHeight: 1.15, letterSpacing: 0.08, opacity: 1 }, { text: localeCopy.variantA, name: 'Section label' }),
    layer(id('headline', pageId), 'text', { x: d.margin, y: headlineY, width: contentWidth, height: type.headline * 2.35, rotation: 0 }, { fill: '#172522', fontFamily: 'Noto Sans', fontSize: type.headline, fontWeight: 700, lineHeight: 1.02, letterSpacing: -0.02, opacity: 1 }, { text: localeCopy.headline, name: 'Headline' }),
    layer(id('brief', pageId), 'text', { x: d.margin, y: headlineY + type.headline * 2.45, width: contentWidth, height: type.body * 2.5, rotation: 0 }, { fill: '#465B56', fontFamily: 'Noto Sans', fontSize: type.body, fontWeight: 400, lineHeight: 1.3, letterSpacing: 0, opacity: 1 }, { text: excerpt(brief, 220), name: 'Brief excerpt' }),
  ];
  conditions.slice(0, 3).forEach((condition, index) => layers.push(layer(
    id('condition', pageId, condition.id), 'text',
    { x: d.margin, y: conditionY + index * type.condition * 1.55, width: contentWidth, height: type.condition * 1.35, rotation: 0 },
    { fill: index === 0 ? '#D85D36' : '#172522', fontFamily: 'Noto Sans', fontSize: type.condition, fontWeight: index === 0 ? 700 : 600, lineHeight: 1.15, letterSpacing: 0, opacity: 1 },
    { text: conditionText(condition, format.locale), name: `condition:${condition.id}` },
  )));
  if (assetId) layers.push(layer(id('image', pageId), 'image', { x: visualX, y: visualY, width: visualWidth, height: visualHeight, rotation: 0 }, { opacity: 1, radius: d.short * 0.035 }, { assetId, crop: { x: 0, y: 0, width: 1, height: 1 }, name: 'Selected image' }));
  else layers.push(layer(id('empty-visual', pageId), 'shape', { x: visualX, y: visualY, width: visualWidth, height: visualHeight, rotation: 0 }, { fill: '#DCE8E3', stroke: '#BFD2CA', strokeWidth: Math.max(1, d.short * 0.002), radius: d.short * 0.035, opacity: 1 }, { shape: 'rect', name: 'Image area' }));
  layers.push(layer(id('action', pageId), 'text', { x: d.landscape ? visualX : d.margin, y: d.landscape ? d.height - d.margin - type.action * 1.4 : visualY - type.action * 1.65, width: visualWidth, height: type.action * 1.35, rotation: 0 }, { fill: '#172522', fontFamily: 'Noto Sans', fontSize: type.action, fontWeight: 700, textAlign: d.landscape ? 'right' : 'left', lineHeight: 1.1, letterSpacing: 0, opacity: 1 }, { text: localeCopy.action, name: 'Call to action' }));
  return { id: pageId, width: d.width, height: d.height, unit: format.unit, background: '#F6F1E7', layers } as const;
}

function splitPage(format: CampaignFormat, brief: string, conditions: readonly CampaignCondition[], assetId: string | undefined) {
  const d = dimensions(format), type = typography(format), localeCopy = copy[format.locale], pageId = id('page-split', format.locale, format.id);
  const horizontal = d.landscape;
  const panelX = horizontal ? d.width * 0.53 : d.margin;
  const panelY = horizontal ? d.margin : d.height * 0.55;
  const panelWidth = horizontal ? d.width - panelX - d.margin : d.usableWidth;
  const panelHeight = horizontal ? d.usableHeight : d.height - panelY - d.margin;
  const textWidth = horizontal ? d.width * 0.43 - d.margin : d.usableWidth;
  const focusCondition = conditions[0];
  const focusText = focusCondition ? conditionText(focusCondition, format.locale) : localeCopy.headline;
  const layers: DesignLayer[] = [
    layer(id('panel', pageId), 'shape', { x: panelX, y: panelY, width: panelWidth, height: panelHeight, rotation: 0 }, { fill: '#173C36', radius: d.short * 0.04, opacity: 1 }, { shape: 'rect', name: 'Terms panel' }),
    layer(id('eyebrow', pageId), 'text', { x: d.margin, y: d.margin, width: textWidth, height: type.eyebrow * 1.5, rotation: 0 }, { fill: '#D85D36', fontFamily: 'Noto Sans', fontSize: type.eyebrow, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0.08, opacity: 1 }, { text: localeCopy.variantB, name: 'Section label' }),
    layer(id('headline', pageId), 'text', { x: d.margin, y: d.margin + type.eyebrow * 1.8, width: textWidth, height: type.headline * 2.25, rotation: 0 }, { fill: '#172522', fontFamily: 'Noto Sans', fontSize: type.headline, fontWeight: 700, lineHeight: 1.03, letterSpacing: -0.02, opacity: 1 }, { text: focusText, name: focusCondition ? `condition:${focusCondition.id}` : 'Headline' }),
    layer(id('brief', pageId), 'text', { x: d.margin, y: d.margin + type.eyebrow * 1.8 + type.headline * 2.35, width: textWidth, height: type.body * 3.2, rotation: 0 }, { fill: '#465B56', fontFamily: 'Noto Sans', fontSize: type.body, fontWeight: 400, lineHeight: 1.3, letterSpacing: 0, opacity: 1 }, { text: excerpt(brief, 260), name: 'Brief excerpt' }),
    layer(id('terms-label', pageId), 'text', { x: panelX + d.margin * 0.55, y: panelY + d.margin * 0.55, width: panelWidth - d.margin * 1.1, height: type.eyebrow * 1.4, rotation: 0 }, { fill: '#A9C8BE', fontFamily: 'Noto Sans', fontSize: type.eyebrow, fontWeight: 600, lineHeight: 1.1, letterSpacing: 0.06, opacity: 1 }, { text: localeCopy.details, name: 'Terms label' }),
  ];
  conditions.slice(focusCondition ? 1 : 0, focusCondition ? 5 : 4).forEach((condition, index) => layers.push(layer(
    id('condition', pageId, condition.id), 'text',
    { x: panelX + d.margin * 0.55, y: panelY + d.margin * 0.55 + type.eyebrow * 1.8 + index * type.condition * 1.65, width: panelWidth - d.margin * 1.1, height: type.condition * 1.4, rotation: 0 },
    { fill: index === 0 ? '#F4A57B' : '#F7F3EA', fontFamily: 'Noto Sans', fontSize: type.condition, fontWeight: index === 0 ? 700 : 500, lineHeight: 1.15, letterSpacing: 0, opacity: 1 },
    { text: conditionText(condition, format.locale), name: `condition:${condition.id}` },
  )));
  const imageHeight = Math.max(type.body * 2.5, horizontal ? d.height * 0.2 : panelY - (d.margin + type.eyebrow * 1.8 + type.headline * 2.35 + type.body * 3.4) - d.margin);
  const imageY = horizontal ? d.height - d.margin - imageHeight : Math.max(d.margin + type.eyebrow * 1.8 + type.headline * 2.35 + type.body * 3.4, d.margin);
  if (assetId && imageHeight > 0) layers.push(layer(id('image', pageId), 'image', { x: d.margin, y: imageY, width: textWidth, height: imageHeight, rotation: 0 }, { opacity: 1, radius: d.short * 0.03 }, { assetId, crop: { x: 0, y: 0, width: 1, height: 1 }, name: 'Selected image' }));
  layers.push(layer(id('action', pageId), 'text', { x: panelX + d.margin * 0.55, y: panelY + panelHeight - d.margin * 0.55 - type.action * 1.3, width: panelWidth - d.margin * 1.1, height: type.action * 1.3, rotation: 0 }, { fill: '#F7F3EA', fontFamily: 'Noto Sans', fontSize: type.action, fontWeight: 700, textAlign: 'right', lineHeight: 1.1, letterSpacing: 0, opacity: 1 }, { text: localeCopy.action, name: 'Call to action' }));
  return { id: pageId, width: d.width, height: d.height, unit: format.unit, background: '#E8EFEA', layers } as const;
}

function bindingsFor(content: Extract<ArtifactContent, { kind: 'design' }>, conditions: readonly CampaignCondition[]): FieldBinding[] {
  const result: FieldBinding[] = [];
  const byId = new Map(conditions.map((condition) => [condition.id, condition]));
  for (const page of content.pages) for (const current of page.layers) {
    const conditionId = current.name?.startsWith('condition:') ? current.name.slice('condition:'.length) : undefined;
    const condition = conditionId ? byId.get(conditionId) : undefined;
    if (condition) result.push({ targetElementId: current.id, targetProperty: 'text', sourceRef: condition.sourceRef, transformId: `campaign-${condition.kind}`, updateMode: 'propose' });
  }
  return result;
}

export function composeCampaignVariants(input: {
  brief: string;
  conditions: readonly CampaignCondition[];
  formats: readonly CampaignFormat[];
  assetRefs: readonly string[];
}): CampaignVariantDraft[] {
  const variants = [
    { id: 'editorial', name: 'Editorial focus', composition: 'editorial-focus' as const, makePage: editorialPage },
    { id: 'split', name: 'Split proof', composition: 'split-proof' as const, makePage: splitPage },
  ];
  return variants.map((variant) => {
    const content: Extract<ArtifactContent, { kind: 'design' }> = { kind: 'design', schemaVersion: 1, pages: input.formats.map((format, index) => variant.makePage(format, input.brief, input.conditions, input.assetRefs[index % Math.max(1, input.assetRefs.length)])) };
    const bindings = bindingsFor(content, input.conditions);
    return { id: variant.id, name: variant.name, composition: variant.composition, content, bindings, checks: checkCampaignDesign(content, bindings, input.assetRefs.length > 0) };
  });
}

