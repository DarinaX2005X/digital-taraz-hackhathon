import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import type { DesignLayer, DesignPage } from '@/features/designs/domain/model';
import type { DesignAssetCache } from './assets';
import { designColor, layoutDesignText, numericStyle } from './text-layout';
import { designPageSvg } from './svg';
import { DesignExportError } from './types';

function translucentGroup(layers:DesignLayer[]):boolean{return layers.some((layer)=>!layer.hidden&&layer.type==='group'&&(numericStyle(layer,'opacity',1,0,1)<1||translucentGroup(layer.layers??[])));}
export async function designPdf(pages:DesignPage[],assets:DesignAssetCache,title:string,historicalDraftLabel?:string):Promise<{bytes:Buffer;warnings:string[]}> {
  const doc=new PDFDocument({autoFirstPage:false,compress:true,info:{Title:title,Creator:'Tirlik'},pdfVersion:'1.7'}),chunks:Buffer[]=[],warnings:string[]=[];let size=0;
  const finished=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>100*1024*1024){doc.destroy(new DesignExportError('too-large'));return;}chunks.push(chunk);});doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));});
  const fonts=new Set<string>();
  async function layerPdf(layer:DesignLayer,parentsOpacity=1,textOnly=false):Promise<void>{
    if(layer.hidden)return;
    const t=layer.transform,opacity=parentsOpacity*numericStyle(layer,'opacity',1,0,1);
    doc.save().translate(t.x,t.y).rotate(t.rotation).opacity(textOnly?0:opacity);
    if(layer.type==='group'){for(const child of layer.layers??[])await layerPdf(child,opacity,textOnly);}
    else if(layer.type==='text'){
      const loaded=await assets.font(layer);if(loaded.asset.noSubsetting)throw new DesignExportError('embedding-denied',layer.id,'font-no-subsetting');
      const layout=layoutDesignText(layer,loaded.font);if(layout.overflow)warnings.push(`text-overflow:${layer.id}`);
      if(!fonts.has(loaded.key)){doc.registerFont(loaded.key,Buffer.from(loaded.asset.bytes));fonts.add(loaded.key);}
      doc.font(loaded.key).fontSize(layout.size).fillColor(designColor(layer.style.fill,layer.id));
      for(const line of layout.lines)doc.text(line.text,line.x,line.baseline,{lineBreak:false,baseline:'alphabetic',characterSpacing:layout.spacing,oblique:layout.italic?12:false});
    }else if(!textOnly&&layer.type==='image'){const image=await assets.image(layer);doc.image(image.png,0,0,{width:t.width,height:t.height});}
    else if(!textOnly&&layer.type==='shape'){
      const fill=designColor(layer.style.fill,layer.id),stroke=designColor(layer.style.stroke,layer.id,'transparent'),strokeWidth=numericStyle(layer,'strokeWidth',0,0,10000);
      if(layer.shape==='line'){doc.moveTo(0,0).lineTo(t.width,t.height).lineWidth(strokeWidth||2).stroke(stroke==='transparent'?fill:stroke);}
      else{
        if(layer.shape==='ellipse')doc.ellipse(t.width/2,t.height/2,t.width/2,t.height/2);else{const radius=numericStyle(layer,'radius',0,0,100000);if(radius)doc.roundedRect(0,0,t.width,t.height,Math.min(radius,t.width/2,t.height/2));else doc.rect(0,0,t.width,t.height);}
        doc.lineWidth(strokeWidth);
        if(fill!=='transparent'&&stroke!=='transparent'&&strokeWidth)doc.fillAndStroke(fill,stroke);else if(fill!=='transparent')doc.fill(fill);else if(stroke!=='transparent'&&strokeWidth)doc.stroke(stroke);else doc.addContent('n');
      }
    }
    doc.restore();
  }
  try{
    for(const page of pages){
      const factor=page.unit==='mm'?72/25.4:72/96;
      if(page.width*factor>14400||page.height*factor>14400)throw new DesignExportError('too-large',page.id);
      doc.addPage({size:[page.width*factor,page.height*factor],margin:0});doc.save().scale(factor).rect(0,0,page.width,page.height).clip();
      if(translucentGroup(page.layers)){
        const rendered=await designPageSvg(page,assets,{scale:2,transparent:false});const png=await sharp(Buffer.from(rendered.svg),{limitInputPixels:100_000_000}).png().toBuffer();
        doc.image(png,0,0,{width:page.width,height:page.height});warnings.push(...rendered.warnings,`page-rasterized-for-group-opacity:${page.id}`);
        // Keep searchable Unicode text over the faithful flattened transparency composition.
        for(const layer of page.layers)await layerPdf(layer,1,true);
      }else{
        const background=designColor(page.background,page.id,'transparent');if(background!=='transparent')doc.rect(0,0,page.width,page.height).fill(background);
        for(const layer of page.layers)await layerPdf(layer);
      }
      if(historicalDraftLabel){
        const pixelsPerUnit=page.unit==='mm'?96/25.4:1,padding=Math.min(6/pixelsPerUnit,page.width*.04,page.height*.04),maxSize=Math.min(12/pixelsPerUnit,page.height*.08),marker:DesignLayer={id:'tirlik-historical-draft-label',type:'text',text:historicalDraftLabel,transform:{x:0,y:0,width:page.width,height:page.height,rotation:0},style:{fontFamily:'Noto Sans',fontSize:maxSize,fill:'#ffffff'}},loaded=await assets.font(marker),run=loaded.font.layout(historicalDraftLabel),natural=run.positions.reduce((sum,position)=>sum+position.xAdvance,0)/loaded.font.unitsPerEm,maxWidth=Math.max(1,page.width-padding*2),fontSize=Math.min(maxSize,maxWidth/Math.max(natural,1)),bandHeight=Math.min(page.height,Math.max(fontSize*1.8,padding*2+fontSize)),bandY=Math.max(0,page.height-bandHeight);
        doc.save().fillOpacity(.72).rect(0,bandY,page.width,bandHeight).fill('#202624').restore();
        await layerPdf({...marker,transform:{x:padding,y:bandY+(bandHeight-fontSize*1.2)/2,width:maxWidth,height:bandHeight,rotation:0},style:{...marker.style,fontSize,textAlign:'right'}});
      }
      doc.restore();
    }
    doc.end();return {bytes:await finished,warnings:[...new Set(warnings)]};
  }catch(error){doc.destroy(error instanceof Error?error:new Error('pdf-failed'));await finished.catch(()=>undefined);throw error;}
}
