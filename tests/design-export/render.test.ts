import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderDesignFiles } from '@/features/design-export/server/render';
import { builtinFont, digest, createDesignAssetCache } from '@/features/design-export/server/assets';
import { designPageSvg } from '@/features/design-export/server/svg';
import type { DesignAssetResolver } from '@/features/design-export/server/types';
import type { DesignContent } from '@/features/designs/domain/model';

const imageId='90ad0867-3fb5-4003-b5ab-598b9658f6c1';
const content=():DesignContent=>({kind:'design',schemaVersion:1,pages:[{id:'page',width:320,height:240,unit:'px',background:'transparent',layers:[{id:'headline',type:'text',text:'Қазақша: Ә Ғ Қ Ң Ө Ұ Ү Һ І · Цена 1 250 ₸',transform:{x:12,y:12,width:290,height:75,rotation:0},style:{fontFamily:'Noto Sans',fontSize:18,fill:'#153e42'}},{id:'photo',type:'image',assetId:imageId,crop:{x:.5,y:0,width:.5,height:1},transform:{x:40,y:110,width:100,height:80,rotation:15},style:{opacity:.8}}]}]});
async function assets(embed=true):Promise<DesignAssetResolver>{const bytes=await sharp({create:{width:40,height:20,channels:4,background:'#efca56'}}).png().toBuffer();return {image:async()=>({bytes,sha256:digest(bytes),mediaType:'image/png',license:{name:'Test image',embeddingAllowed:embed}}),font:async()=>{throw new Error('missing');}};}
describe('design product exports without a browser',()=>{
  it('emits exact PNG dimensions with alpha and opaque JPEG dimensions',async()=>{
    const input={content:content(),title:'Ұсыныс',locale:'kk' as const,assets:await assets()};
    const png=await renderDesignFiles({...input,format:'png',options:{scale:2,transparent:true}}),jpeg=await renderDesignFiles({...input,format:'jpeg'});
    const pngMeta=await sharp(png.files[0]!.bytes).metadata(),jpgMeta=await sharp(jpeg.files[0]!.bytes).metadata();
    expect(pngMeta).toMatchObject({format:'png',width:640,height:480,hasAlpha:true});expect(jpgMeta).toMatchObject({format:'jpeg',width:320,height:240,hasAlpha:false});
    const sample=await sharp(png.files[0]!.bytes).extract({left:639,top:479,width:1,height:1}).raw().toBuffer();expect(sample[3]).toBe(0);
  });
  it('preserves page order and searchable RU/KK text with embedded fonts in a multipage PDF',async()=>{
    const value=content();value.pages.push({...structuredClone(value.pages[0]!),id:'second',width:210,height:297,unit:'mm',layers:[{id:'other',type:'text',text:'Вторая страница · Екінші бет',transform:{x:10,y:10,width:180,height:50,rotation:0},style:{fontFamily:'Noto Sans',fontSize:12,fill:'#000000'}}]});
    const result=await renderDesignFiles({content:value,title:'PDF',locale:'ru',assets:await assets(),format:'pdf'}),loading=getDocument({data:new Uint8Array(result.files[0]!.bytes),useSystemFonts:false,disableFontFace:true});
    const pdf=await loading.promise;try{expect(pdf.numPages).toBe(2);const page=await pdf.getPage(1),text=await page.getTextContent();const value=text.items.filter((item)=>'str'in item).map((item)=>item.str).join('');expect(value).toContain('Қазақша');expect(value).toContain('Ә Ғ Қ Ң Ө Ұ Ү Һ І');expect(value).toContain('1 250');expect((await pdf.getPage(2)).view[2]).toBeCloseTo(595.276,2);expect(Buffer.from(result.files[0]!.bytes).toString('latin1')).toContain('/FontFile2');}finally{await loading.destroy();}
  });
  it('marks a historical draft inside unchanged image and PDF page bounds',async()=>{
    const draft='Тарихи нобай · v7',input={content:content(),title:'Draft',locale:'kk' as const,assets:await assets(),historicalDraftLabel:draft};
    const png=await renderDesignFiles({...input,format:'png',options:{transparent:true}}),metadata=await sharp(png.files[0]!.bytes).metadata(),footer=await sharp(png.files[0]!.bytes).extract({left:0,top:239,width:1,height:1}).raw().toBuffer();
    expect(metadata).toMatchObject({width:320,height:240});expect(footer[3]).toBeGreaterThan(0);
    const pdfResult=await renderDesignFiles({...input,format:'pdf'}),loading=getDocument({data:new Uint8Array(pdfResult.files[0]!.bytes),useSystemFonts:false,disableFontFace:true}),pdf=await loading.promise;
    try{const text=await (await pdf.getPage(1)).getTextContent();expect(text.items.filter((item)=>'str'in item).map((item)=>item.str).join('')).toContain(draft);}finally{await loading.destroy();}
  });
  it('rejects PDF font subsetting when the embedded font license forbids it',async()=>{
    const value=content(),fontId='88e5e438-f13a-45a4-8d45-cef8b74f7997';value.pages[0]!.layers[0]!.fontAssetId=fontId;const resolver=await assets(),font=await builtinFont(400);
    await expect(renderDesignFiles({content:value,title:'PDF',locale:'ru',format:'pdf',assets:{...resolver,font:async()=>({...font,noSubsetting:true})}})).rejects.toMatchObject({code:'embedding-denied',layerId:'headline',detail:'font-no-subsetting'});
  });
  it('encodes top-left transforms, nested opacity and closed paths without external resource loading',async()=>{
    const value=content(),page=value.pages[0]!;page.layers=[{id:'group',type:'group',transform:{x:20,y:30,width:100,height:100,rotation:30},style:{opacity:.5},layers:[{id:'shape',type:'shape',shape:'rect',transform:{x:5,y:6,width:40,height:30,rotation:15},style:{fill:'#123456'}}]}];
    const result=await designPageSvg(page,createDesignAssetCache(await assets(),'display'),{scale:1,transparent:true});
    expect(result.svg).toContain('translate(20 30) rotate(30)');expect(result.svg).toContain('opacity="0.5"');expect(result.svg).toContain('translate(5 6) rotate(15)');expect(result.svg).not.toMatch(/<text|https?:\/\/(?!www\.w3\.org)/);
  });
  it('fails named missing assets and unsafe styles instead of generating blank output',async()=>{
    const value=content();await expect(renderDesignFiles({content:value,title:'x',locale:'ru',assets:{image:async()=>{throw new Error('denied');},font:async()=>{throw new Error('denied');}},format:'png'})).rejects.toMatchObject({code:'missing-asset',layerId:'photo'});
    value.pages[0]!.layers[0]!.style.fill='url(file:///etc/passwd)';await expect(renderDesignFiles({content:value,title:'x',locale:'ru',assets:await assets(),format:'png'})).rejects.toMatchObject({code:'invalid-design'});
  });
  it('bounds selected pages and output pixels and reports text overflow without truncating text',async()=>{
    const value=content();value.pages[0]!.layers[0]!.transform.height=1;const result=await renderDesignFiles({content:value,title:'x',locale:'ru',assets:await assets(),format:'png'});expect(result.files[0]!.warnings).toContain('text-overflow:headline');
    value.pages[0]!.width=100000;await expect(renderDesignFiles({content:value,title:'x',locale:'ru',assets:await assets(),format:'png'})).rejects.toMatchObject({code:'too-large'});
    await expect(renderDesignFiles({content:content(),title:'x',locale:'ru',assets:await assets(),format:'png',options:{pageIds:['foreign']}})).rejects.toMatchObject({code:'invalid-design'});
  });
});
