import type { Pool } from 'pg';
import type { SessionPrincipal } from '@/features/identity/server/access';
import { createSourceVisualAssetService } from '@/features/sources/server/visual-assets';
import type { DesignAssetResolver, DesignAsset } from './types';

/** Authenticated visual assets remain governed by the canonical source ACL and licensing checks. */
export function createDesignSourceAssetResolver(pool:Pool,principal:SessionPrincipal,workspaceId:string):DesignAssetResolver {
  const service=createSourceVisualAssetService(pool);
  async function resolve(id:string,purpose:'display'|'embed',kind:'image'|'font'):Promise<DesignAsset>{
    const asset=kind==='font'?await service.resolveFont(principal,{workspaceId,assetId:id,purpose}):await service.resolve(principal,{workspaceId,assetId:id,purpose});
    if(asset.kind!==kind)throw new Error('design-asset-kind');
    return {bytes:asset.bytes,mediaType:asset.mediaType,sha256:asset.sha256,license:{name:asset.license.label??asset.name,embeddingAllowed:asset.license.permission==='confirmed'&&asset.license.canEmbed},...(asset.font?{noSubsetting:asset.font.noSubsetting}:{})};
  }
  return {image:(id,purpose)=>resolve(id,purpose,'image'),font:(id,purpose)=>resolve(id,purpose,'font')};
}
