import sharp from 'sharp';
import { designContent } from '@/features/designs/domain/model';
import { createDesignAssetCache } from './assets';
import { designPageSvg } from './svg';
import { designPdf } from './pdf';
import { createDesignPackage } from './package';
import { DesignExportError, historicalDraftLabel, type DesignExportFile, type DesignExportInput } from './types';
export type { DesignAsset, DesignAssetResolver, DesignExportInput, DesignExportFile, DesignProvenance } from './types';
export { DesignExportError } from './types';

export async function renderDesignFiles(input:DesignExportInput):Promise<{files:DesignExportFile[]}> {
  let content;try{content=designContent(input.content);}catch{throw new DesignExportError('invalid-design');}
  const draftLabel=historicalDraftLabel(input.historicalDraftLabel);
  const pageIds=input.options?.pageIds??content.pages.map((page)=>page.id);
  if(!pageIds.length||new Set(pageIds).size!==pageIds.length||pageIds.some((id)=>!content.pages.some((page)=>page.id===id)))throw new DesignExportError('invalid-design');
  const pages=pageIds.map((id)=>content.pages.find((page)=>page.id===id)!);
  let textLength=0;function count(layers:typeof pages[number]['layers']){for(const layer of layers){textLength+=(layer.text??'').length;if(layer.layers)count(layer.layers);}}pages.forEach((page)=>count(page.layers));if(textLength>200000)throw new DesignExportError('too-large');
  const scale=input.options?.scale??1;if(!Number.isFinite(scale)||scale<.1||scale>4)throw new DesignExportError('invalid-design');
  const title=input.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().slice(0,160)||'Design',files:DesignExportFile[]=[];
  if(input.format==='tirlik'){
    const bytes=await createDesignPackage({content:{...content,pages},title,locale:input.locale,assets:input.assets,provenance:input.provenance,historicalDraftLabel:draftLabel});return {files:[{name:`${title}.tirlik`,bytes,mediaType:'application/vnd.tirlik.design+zip',extension:'tirlik',warnings:[]}]};
  }
  const assets=createDesignAssetCache(input.assets,'display',input.format==='pdf'?'embed':'display');
  if(input.format==='pdf'){const pdf=await designPdf(pages,assets,title,draftLabel);return {files:[{name:`${title}.pdf`,bytes:pdf.bytes,mediaType:'application/pdf',extension:'pdf',warnings:pdf.warnings}]};}
  let total=0;
  for(let index=0;index<pages.length;index++){
    const page=pages[index]!,rendered=await designPageSvg(page,assets,{scale,transparent:input.format==='png'&&!!input.options?.transparent,historicalDraftLabel:draftLabel});
    let pipeline=sharp(Buffer.from(rendered.svg),{limitInputPixels:100_000_000});
    pipeline=input.format==='jpeg'?pipeline.flatten({background:'#ffffff'}).jpeg({quality:95,chromaSubsampling:'4:4:4'}):pipeline.png();
    const bytes=await pipeline.toBuffer();total+=bytes.length;if(total>100*1024*1024)throw new DesignExportError('too-large');
    const extension=input.format==='jpeg'?'jpg':'png';files.push({name:`${title}${pages.length>1?`-${index+1}`:''}.${extension}`,bytes,mediaType:`image/${input.format}`,extension,warnings:rendered.warnings});
  }
  return {files};
}
