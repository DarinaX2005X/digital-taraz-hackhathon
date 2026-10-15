import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';
import { createDesignPackage, parseDesignPackage, remapPackageAssets } from '@/features/design-export/server/package';
import { digest } from '@/features/design-export/server/assets';
import type { DesignContent } from '@/features/designs/domain/model';

const assetId='90ad0867-3fb5-4003-b5ab-598b9658f6c1',newAssetId='f2a55e17-514e-4c04-b8a8-c93553158ccb';
const content:DesignContent={kind:'design',schemaVersion:1,pages:[{id:'page',width:400,height:300,unit:'px',background:'#ffffff',layers:[{id:'text',name:'Қазақша мәтін',type:'text',text:'Қазақша · English · Русский',transform:{x:20,y:20,width:350,height:80,rotation:0},style:{fontFamily:'Noto Sans',fontSize:20,fill:'#123456'}},{id:'image',type:'image',assetId,crop:{x:.1,y:.2,width:.8,height:.6},transform:{x:30,y:140,width:100,height:80,rotation:22},style:{opacity:.8}}]}]};
async function input(embeddingAllowed=true){const bytes=await sharp({create:{width:10,height:10,channels:4,background:'#ffffff'}}).png().toBuffer();return {content,title:'Portable',locale:'kk' as const,assets:{image:async()=>({bytes,sha256:digest(bytes),mediaType:'image/png',license:{name:'Own image',embeddingAllowed}}),font:async()=>{throw new Error('unexpected');}}};}
describe('portable Tirlik design archive boundaries',()=>{
  it('roundtrips editable IDs, crop, style, language, locked layers and source provenance',async()=>{
    const sourceRef={sourceId:'7c48e4e5-0264-477a-881b-a453cc78c7fb',sourceVersionId:'087b67b3-07e1-475d-ad5a-ad1e3d74efb3',revision:1};
    const provenance={sourceRefs:[sourceRef],bindings:[{targetElementId:'text',sourceRef,transformId:'text',updateMode:'propose' as const}],locks:{image:{actorId:'6d19d182-564b-4e56-9564-eab4e874a07d',reason:'Logo',at:'2026-10-15T00:00:00.000Z'}}};
    const bytes=await createDesignPackage({...await input(),provenance}),parsed=await parseDesignPackage(bytes);
    expect(parsed.content).toEqual(content);expect(parsed.provenance).toEqual(provenance);expect(parsed.assets).toHaveLength(2);expect(parsed.assets.some((asset)=>asset.builtinWeight===400)).toBe(true);
    const remapped=remapPackageAssets(parsed.content,new Map([[assetId,newAssetId]]));expect(remapped.pages[0]!.layers[1]!.assetId).toBe(newAssetId);expect(remapped.pages[0]!.layers[1]!.crop).toEqual(content.pages[0]!.layers[1]!.crop);
  });
  it('retains the localized historical-draft label as bounded manifest metadata',async()=>{
    const bytes=await createDesignPackage({...await input(),historicalDraftLabel:'Тарихи нобай · v7'}),parsed=await parseDesignPackage(bytes);
    expect(parsed.manifest.historicalDraftLabel).toBe('Тарихи нобай · v7');
  });
  it('rejects embedding without declared rights',async()=>{await expect(createDesignPackage(await input(false))).rejects.toMatchObject({code:'embedding-denied',layerId:'image'});});
  it('rejects tampered hashes, undeclared files and source-target mismatch',async()=>{
    const bytes=await createDesignPackage(await input()),zip=await JSZip.loadAsync(bytes);zip.file('design.json','{}');await expect(parseDesignPackage(await zip.generateAsync({type:'uint8array'}))).rejects.toMatchObject({code:'hash-mismatch'});
    const extra=await JSZip.loadAsync(bytes);extra.file('private-source.txt','not a design asset');await expect(parseDesignPackage(await extra.generateAsync({type:'uint8array'}))).rejects.toMatchObject({code:'invalid-package'});
  });
  it('rejects path traversal and excessive archive expansion before reading content',async()=>{
    const zip=new JSZip();zip.file('../outside.txt','bad');await expect(parseDesignPackage(await zip.generateAsync({type:'uint8array'}))).rejects.toMatchObject({code:'invalid-package'});
    const bomb=new JSZip();bomb.file('design.json','x'.repeat(2*1024*1024));await expect(parseDesignPackage(await bomb.generateAsync({type:'uint8array',compression:'DEFLATE'}))).rejects.toMatchObject({code:'invalid-package'});
  });
});
