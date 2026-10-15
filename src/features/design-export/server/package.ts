import JSZip from 'jszip';
import { z } from 'zod';
import { SourceRefSchema, FieldBindingSchema } from '@/contracts/artifacts';
import { TargetLocksSchema } from '@/features/artifacts/domain/content-state';
import { ArtifactContentSchema } from '@/features/artifacts/domain/content-models';
import { designContent, type DesignContent, type DesignLayer } from '@/features/designs/domain/model';
import { readOfficeArchive } from '@/features/sources/server/archive';
import { builtinFont, checkedAsset, digest } from './assets';
import { DesignExportError, type DesignAssetResolver, type DesignProvenance } from './types';

const LicenseSchema=z.strictObject({name:z.string().min(1).max(1000),embeddingAllowed:z.literal(true)});
const EntrySchema=z.strictObject({id:z.string().min(1).max(240),kind:z.enum(['image','font']),path:z.string().regex(/^(assets|fonts)\/[a-f0-9]{64}\.(png|jpg|webp|ttf|otf|woff)$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),mediaType:z.enum(['image/png','image/jpeg','image/webp','font/ttf','font/otf','font/woff','application/font-sfnt']),license:LicenseSchema,builtinWeight:z.union([z.literal(400),z.literal(500),z.literal(600),z.literal(700)]).optional()});
export const DesignPackageManifestSchema=z.strictObject({format:z.literal('tirlik-design'),schemaVersion:z.literal(1),title:z.string().trim().min(1).max(240),locale:z.enum(['ru','kk','en']),historicalDraftLabel:z.string().trim().min(1).max(300).regex(/^[^\p{Cc}]+$/u).optional(),document:z.literal('design.json'),documentHash:z.string().regex(/^[a-f0-9]{64}$/),assets:z.array(EntrySchema).max(2000)});
const DocumentSchema=z.strictObject({content:ArtifactContentSchema,provenance:z.strictObject({sourceRefs:z.array(SourceRefSchema).max(1000),bindings:z.array(FieldBindingSchema).max(10000),locks:TargetLocksSchema.optional()})});
export type DesignPackageAsset=z.infer<typeof EntrySchema>&{bytes:Uint8Array};
export type ParsedDesignPackage={manifest:z.infer<typeof DesignPackageManifestSchema>;content:DesignContent;provenance:DesignProvenance;assets:DesignPackageAsset[]};
const extension=(mediaType:string)=>({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','font/ttf':'ttf','font/otf':'otf','font/woff':'woff','application/font-sfnt':'ttf'} as Record<string,string>)[mediaType];
function allLayers(content:DesignContent){const layers:DesignLayer[]=[];function visit(items:DesignLayer[]){for(const layer of items){layers.push(layer);if(layer.layers)visit(layer.layers);}}for(const page of content.pages)visit(page.layers);return layers;}

/** Includes only the design and referenced visual assets, never source documents or private datasets. */
export async function createDesignPackage(input:{content:DesignContent;title:string;locale:'ru'|'kk'|'en';historicalDraftLabel?:string;provenance?:DesignProvenance;assets:DesignAssetResolver}):Promise<Buffer>{
  const content=designContent(input.content),layers=allLayers(content),ids=new Set([...content.pages.map((page)=>page.id),...layers.map((layer)=>layer.id)]);
  const provenance:DesignProvenance={sourceRefs:input.provenance?.sourceRefs??[],bindings:(input.provenance?.bindings??[]).filter((binding)=>ids.has(binding.targetElementId)),locks:Object.fromEntries(Object.entries(input.provenance?.locks??{}).filter(([id])=>ids.has(id)))};
  const zip=new JSZip(),entries:z.infer<typeof EntrySchema>[]=[],seen=new Set<string>();let expanded=0;
  for(const layer of layers){
    const kind=layer.type==='image'?'image':layer.type==='text'?'font':undefined;if(!kind)continue;
    const weight=typeof layer.style.fontWeight==='number'?layer.style.fontWeight:400,builtinWeight=weight>=700?700:weight>=600?600:weight>=500?500:400;
    const id=kind==='image'?layer.assetId!:layer.fontAssetId??`noto-${builtinWeight}`;
    if(!id||seen.has(`${kind}:${id}`))continue;seen.add(`${kind}:${id}`);
    let asset;
    try{asset=checkedAsset(await(kind==='image'?input.assets.image(id,'embed'):layer.fontAssetId?input.assets.font(id,'embed'):builtinFont(builtinWeight)),true,layer.id);}catch(error){if(error instanceof DesignExportError)throw error;throw new DesignExportError(kind==='font'?'missing-font':'missing-asset',layer.id);}
    const ext=extension(asset.mediaType);if(!ext)throw new DesignExportError(kind==='font'?'missing-font':'missing-asset',layer.id);
    expanded+=asset.bytes.byteLength;if(expanded>56*1024*1024)throw new DesignExportError('too-large');
    const file=`${kind==='image'?'assets':'fonts'}/${asset.sha256}.${ext}`;
    entries.push(EntrySchema.parse({id,kind,path:file,sha256:asset.sha256,mediaType:asset.mediaType,license:asset.license,...(kind==='font'&&!layer.fontAssetId?{builtinWeight}:{})}));
    zip.file(file,asset.bytes,{date:new Date('2000-01-01T00:00:00Z')});
  }
  const document=JSON.stringify(DocumentSchema.parse({content,provenance}));if(Buffer.byteLength(document)>16*1024*1024||expanded+Buffer.byteLength(document)>60*1024*1024)throw new DesignExportError('too-large');
  const manifest=DesignPackageManifestSchema.parse({format:'tirlik-design',schemaVersion:1,title:input.title,locale:input.locale,...(input.historicalDraftLabel?{historicalDraftLabel:input.historicalDraftLabel}:{}),document:'design.json',documentHash:digest(document),assets:entries});
  zip.file('design.json',document,{date:new Date('2000-01-01T00:00:00Z')});zip.file('manifest.json',JSON.stringify(manifest),{date:new Date('2000-01-01T00:00:00Z')});
  // STORE avoids an exporter-generated highly repetitive document tripping the import bomb ratio guard.
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});if(bytes.length>60*1024*1024)throw new DesignExportError('too-large');return bytes;
}

/** Bounded archive inspection precedes all asset writes or artifact mutation. */
export async function parseDesignPackage(bytes:Uint8Array):Promise<ParsedDesignPackage>{
  if(!bytes.byteLength||bytes.byteLength>60*1024*1024)throw new DesignExportError('too-large');
  try{
    const files=await readOfficeArchive(Buffer.from(bytes)),manifestBytes=files.get('manifest.json'),documentBytes=files.get('design.json');
    if(!manifestBytes||!documentBytes||manifestBytes.length>2*1024*1024)throw new DesignExportError('invalid-package');
    const decoder=new TextDecoder('utf-8',{fatal:true});
    const manifest=DesignPackageManifestSchema.parse(JSON.parse(decoder.decode(manifestBytes)));
    if(digest(documentBytes)!==manifest.documentHash)throw new DesignExportError('hash-mismatch');
    const document=DocumentSchema.parse(JSON.parse(decoder.decode(documentBytes))),content=designContent(document.content),layers=allLayers(content),ids=new Set([...content.pages.map((page)=>page.id),...layers.map((layer)=>layer.id)]);
    const allowed=new Set(['manifest.json','design.json']),seen=new Set<string>(),assets:DesignPackageAsset[]=[];
    for(const entry of manifest.assets){
      if(seen.has(`${entry.kind}:${entry.id}`)||entry.path.split('/')[1]!==`${entry.sha256}.${extension(entry.mediaType)}`||!entry.path.startsWith(entry.kind==='font'?'fonts/':'assets/'))throw new DesignExportError('invalid-package');
      if(entry.builtinWeight!==undefined&&(entry.kind!=='font'||entry.id!==`noto-${entry.builtinWeight}`))throw new DesignExportError('invalid-package');
      if(entry.builtinWeight===undefined&&!z.uuid().safeParse(entry.id).success)throw new DesignExportError('invalid-package');
      if(entry.kind==='image'&&!entry.mediaType.startsWith('image/')||entry.kind==='font'&&entry.mediaType.startsWith('image/'))throw new DesignExportError('invalid-package');
      seen.add(`${entry.kind}:${entry.id}`);allowed.add(entry.path);const file=files.get(entry.path);
      if(!file||digest(file)!==entry.sha256)throw new DesignExportError('hash-mismatch');
      if(entry.builtinWeight!==undefined&&(await builtinFont(entry.builtinWeight)).sha256!==entry.sha256)throw new DesignExportError('missing-font',undefined,entry.id);
      assets.push({...entry,bytes:file});
    }
    for(const name of files.keys())if(!name.endsWith('/')&&!allowed.has(name))throw new DesignExportError('invalid-package');
    for(const layer of layers){
      if(layer.type==='image'&&!seen.has(`image:${layer.assetId}`))throw new DesignExportError('missing-asset',layer.id);
      if(layer.type==='text'){
        const weight=typeof layer.style.fontWeight==='number'?layer.style.fontWeight:400,id=layer.fontAssetId??`noto-${weight>=700?700:weight>=600?600:weight>=500?500:400}`;
        if(!seen.has(`font:${id}`))throw new DesignExportError('missing-font',layer.id);
      }
    }
    if(document.provenance.bindings.some((binding)=>!ids.has(binding.targetElementId))||Object.keys(document.provenance.locks??{}).some((id)=>!ids.has(id)))throw new DesignExportError('invalid-package');
    return {manifest,content,provenance:document.provenance,assets};
  }catch(error){if(error instanceof DesignExportError)throw error;throw new DesignExportError('invalid-package');}
}

export function remapPackageAssets(content:DesignContent,ids:ReadonlyMap<string,string>):DesignContent {
  const next=structuredClone(content);for(const layer of allLayers(next)){if(layer.assetId){const id=ids.get(layer.assetId);if(!id)throw new DesignExportError('missing-asset',layer.id);layer.assetId=id;}if(layer.fontAssetId){const id=ids.get(layer.fontAssetId);if(!id)throw new DesignExportError('missing-font',layer.id);layer.fontAssetId=id;}}
  return designContent(next);
}
