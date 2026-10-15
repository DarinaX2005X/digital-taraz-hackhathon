import type { ArtifactContent, DesignLayer, DocumentNode } from '../../artifacts/domain/content-models';
import { IdentityError } from '../../identity/server/http';
import type { ExportOptions } from '../contracts';
import type { ExportAssets, ExportResourceRef } from './types';

const add = (resources: Map<string, ExportResourceRef>, resource: ExportResourceRef) => resources.set(`${resource.kind}:${resource.id}`, resource);

function documentResources(node: DocumentNode, options: ExportOptions, resources: Map<string, ExportResourceRef>) {
  if (node.type === 'image' && typeof node.attrs?.assetId === 'string') add(resources, { id: node.attrs.assetId, kind: 'image' });
  for (const mark of node.marks ?? []) {
    const family = mark.type === 'textStyle' && typeof mark.attrs?.fontFamily === 'string' ? mark.attrs.fontFamily : undefined;
    const fontId = family ? options.fontAssets[family] : undefined;
    if (fontId) add(resources, { id: fontId, kind: 'font' });
  }
  node.content?.forEach((child) => documentResources(child, options, resources));
}

function designResources(layers: DesignLayer[], resources: Map<string, ExportResourceRef>) {
  for (const layer of layers) {
    if (layer.assetId) add(resources, { id: layer.assetId, kind: 'design-image' });
    if (layer.fontAssetId) add(resources, { id: layer.fontAssetId, kind: 'design-font' });
    if (layer.layers) designResources(layer.layers, resources);
  }
}

export function resourcesForExport(content: ArtifactContent, options: ExportOptions): ExportResourceRef[] {
  const resources = new Map<string, ExportResourceRef>();
  if (content.kind === 'document') documentResources(content.document, options, resources);
  if (content.kind === 'design') content.pages.forEach((page) => designResources(page.layers, resources));
  return [...resources.values()].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

export async function authorizeExportResources(assets: ExportAssets, resources: readonly ExportResourceRef[]) {
  if (resources.length > 2_000) throw new IdentityError('PAYLOAD_TOO_LARGE', 'exports.errors.tooManyResources');
  for (const resource of resources) {
    if (assets.authorize) await assets.authorize(resource);
    else if (resource.kind === 'font') {
      if (!assets.font) throw new IdentityError('NOT_FOUND', 'exports.errors.resourceUnavailable');
      await assets.font(resource.id);
    } else if (resource.kind === 'design-image' || resource.kind === 'design-font') {
      if (!assets.design) throw new IdentityError('NOT_FOUND', 'exports.errors.resourceUnavailable');
      if (resource.kind === 'design-image') await assets.design.image(resource.id, 'embed');
      else await assets.design.font(resource.id, 'embed');
    } else await assets.image(resource.id);
  }
}
