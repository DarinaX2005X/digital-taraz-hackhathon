import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { create, type Font } from 'fontkit';
import type { DesignLayer } from '@/features/designs/domain/model';
import { DesignExportError, type DesignAsset, type DesignAssetResolver } from './types';

export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export type LoadedFont = { asset: DesignAsset; font: Font; key: string };
export type LoadedImage = { asset: DesignAsset; png: Buffer; width: number; height: number };
const builtins = new Map<number, Promise<DesignAsset>>();
export function builtinFont(weight: number): Promise<DesignAsset> {
  const normalized = weight >= 700 ? 700 : weight >= 600 ? 600 : weight >= 500 ? 500 : 400;
  let result = builtins.get(normalized);
  if (!result) {
    result = readFile(path.join(process.cwd(), 'public', 'fonts', 'noto-sans', `NotoSans-${({400:'Regular',500:'Medium',600:'SemiBold',700:'Bold'} as Record<number,string>)[normalized]}.ttf`)).then((bytes) => ({bytes,sha256:digest(bytes),mediaType:'font/ttf',license:{name:'SIL Open Font License 1.1 — Noto Sans',embeddingAllowed:true}}));
    builtins.set(normalized,result);
  }
  return result;
}
export function checkedAsset(asset: DesignAsset, embed: boolean, layerId: string): DesignAsset {
  if (!asset.bytes.byteLength || asset.bytes.byteLength > 16 * 1024 * 1024) throw new DesignExportError('too-large',layerId);
  if (digest(asset.bytes) !== asset.sha256) throw new DesignExportError('hash-mismatch',layerId);
  if (embed && !asset.license.embeddingAllowed) throw new DesignExportError('embedding-denied',layerId,asset.license.name);
  return asset;
}
/** Asset IDs are resolved by the caller's authenticated source service, never by a filesystem path or URL. */
export function createDesignAssetCache(resolver: DesignAssetResolver, purpose: 'display' | 'embed', fontPurpose: 'display' | 'embed' = purpose) {
  const fonts = new Map<string, Promise<LoadedFont>>(), images = new Map<string, Promise<LoadedImage>>();
  let totalBytes = 0;
  function count(asset:DesignAsset){totalBytes+=asset.bytes.byteLength;if(totalBytes>60*1024*1024)throw new DesignExportError('too-large');}
  return {
    async font(layer: DesignLayer): Promise<LoadedFont> {
      const weight=typeof layer.style.fontWeight==='number'?layer.style.fontWeight:400,key=layer.fontAssetId??`noto-${weight}`;
      let result=fonts.get(key);
      if(!result){
        result=(async()=>{
          if(!layer.fontAssetId&&layer.style.fontFamily&&layer.style.fontFamily!=='Noto Sans')throw new DesignExportError('missing-font',layer.id,String(layer.style.fontFamily));
          let asset:DesignAsset;
          try{asset=checkedAsset(await(layer.fontAssetId?resolver.font(layer.fontAssetId,fontPurpose):builtinFont(weight)),fontPurpose==='embed',layer.id);}catch(error){if(error instanceof DesignExportError)throw error;throw new DesignExportError('missing-font',layer.id);}
          count(asset);
          let parsed:ReturnType<typeof create>;try{parsed=create(Buffer.from(asset.bytes));}catch{throw new DesignExportError('missing-font',layer.id);}
          if(!('layout' in parsed))throw new DesignExportError('missing-font',layer.id,'font-collection');
          return {asset,font:parsed,key};
        })();fonts.set(key,result);
      }
      return result;
    },
    async image(layer:DesignLayer):Promise<LoadedImage>{
      if(!layer.assetId)throw new DesignExportError('missing-asset',layer.id);
      const crop=layer.crop??{x:0,y:0,width:1,height:1},key=`${layer.assetId}:${JSON.stringify(crop)}`;
      let result=images.get(key);
      if(!result){result=(async()=>{
        let asset:DesignAsset;try{asset=checkedAsset(await resolver.image(layer.assetId!,purpose),purpose==='embed',layer.id);}catch(error){if(error instanceof DesignExportError)throw error;throw new DesignExportError('missing-asset',layer.id);}
        if(!['image/png','image/jpeg','image/webp'].includes(asset.mediaType))throw new DesignExportError('missing-asset',layer.id,'unsupported-image');count(asset);
        try{
          const pipeline=sharp(Buffer.from(asset.bytes),{limitInputPixels:40_000_000,animated:false,failOn:'error'}).rotate();
          // Normalize EXIF orientation before applying normalized crop coordinates.
          const normalized=await pipeline.png().toBuffer({resolveWithObject:true}),width=normalized.info.width,height=normalized.info.height;
          const left=Math.min(width-1,Math.floor(crop.x*width)),top=Math.min(height-1,Math.floor(crop.y*height));
          const cropWidth=Math.max(1,Math.min(width-left,Math.round(crop.width*width))),cropHeight=Math.max(1,Math.min(height-top,Math.round(crop.height*height)));
          const png=await sharp(normalized.data).extract({left,top,width:cropWidth,height:cropHeight}).png().toBuffer();
          return {asset,png,width:cropWidth,height:cropHeight};
        }catch{throw new DesignExportError('missing-asset',layer.id,'invalid-image');}
      })();images.set(key,result);}return result;
    },
  };
}
export type DesignAssetCache=ReturnType<typeof createDesignAssetCache>;
