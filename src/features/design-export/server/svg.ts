import type { DesignLayer, DesignPage } from '@/features/designs/domain/model';
import type { DesignAssetCache } from './assets';
import { designColor, layoutDesignText, numericStyle } from './text-layout';
import { DesignExportError, historicalDraftLabel } from './types';

const number=(value:number)=>{if(!Number.isFinite(value))throw new DesignExportError('invalid-design');return String(Math.round(value*1e6)/1e6);};
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function pagePixels(page:DesignPage,scale:number){const unit=page.unit==='mm'?96/25.4:1;const width=Math.max(1,Math.round(page.width*unit*scale)),height=Math.max(1,Math.round(page.height*unit*scale));if(width>16384||height>16384||width*height>100_000_000)throw new DesignExportError('too-large',page.id);return {width,height};}
/** Constructs a closed SVG subset from typed primitives. No user SVG, CSS or external URLs are inserted. */
export async function designPageSvg(page:DesignPage,assets:DesignAssetCache,options:{scale:number;transparent:boolean;historicalDraftLabel?:string}):Promise<{svg:string;warnings:string[]}> {
  const dimensions=pagePixels(page,options.scale),warnings:string[]=[];let budget=0;
  function bounded(value:string){budget+=value.length;if(budget>80*1024*1024)throw new DesignExportError('too-large');return value;}
  async function layerSvg(layer:DesignLayer):Promise<string>{
    if(layer.hidden)return '';
    const t=layer.transform,opacity=numericStyle(layer,'opacity',1,0,1);let body='';
    const fill=designColor(layer.style.fill,layer.id),stroke=designColor(layer.style.stroke,layer.id,'transparent'),strokeWidth=numericStyle(layer,'strokeWidth',0,0,10000);
    if(layer.type==='group'){for(const child of layer.layers??[])body+=await layerSvg(child);}
    else if(layer.type==='image'){const image=await assets.image(layer);body=bounded(`<image width="${number(t.width)}" height="${number(t.height)}" preserveAspectRatio="none" href="data:image/png;base64,${image.png.toString('base64')}"/>`);}
    else if(layer.type==='text'){
      const loaded=await assets.font(layer),layout=layoutDesignText(layer,loaded.font),scale=layout.size/loaded.font.unitsPerEm;
      if(layout.overflow)warnings.push(`text-overflow:${layer.id}`);
      if(layer.style.textAlign==='justify')warnings.push(`justify-rendered-left:${layer.id}`);
      for(const line of layout.lines){
        let x=line.x;const run=loaded.font.layout(line.text);
        run.glyphs.forEach((glyph,index)=>{const position=run.positions[index]!,d=glyph.path.toSVG();if(!/^[MmLlHhVvCcSsQqTtAaZz0-9eE+., \-\r\n]*$/.test(d))throw new DesignExportError('missing-font',layer.id);
          body+=bounded(`<path d="${d}" transform="translate(${number(x+position.xOffset*scale)} ${number(line.baseline-position.yOffset*scale)})${layout.italic?' skewX(-12)':''} scale(${number(scale)} ${number(-scale)})" fill="${escape(fill)}"/>`);
          x+=position.xAdvance*scale+layout.spacing;
        });
      }
    }else{
      const appearance=`fill="${escape(fill)}" stroke="${escape(stroke)}" stroke-width="${number(strokeWidth)}"`;
      if(layer.shape==='ellipse')body=`<ellipse cx="${number(t.width/2)}" cy="${number(t.height/2)}" rx="${number(t.width/2)}" ry="${number(t.height/2)}" ${appearance}/>`;
      else if(layer.shape==='line')body=`<path d="M0 0L${number(t.width)} ${number(t.height)}" fill="none" stroke="${escape(stroke==='transparent'?fill:stroke)}" stroke-width="${number(strokeWidth||2)}"/>`;
      else{const radius=numericStyle(layer,'radius',0,0,100000);body=`<rect width="${number(t.width)}" height="${number(t.height)}" rx="${number(radius)}" ${appearance}/>`;}
    }
    return `<g transform="translate(${number(t.x)} ${number(t.y)}) rotate(${number(t.rotation)})" opacity="${number(opacity)}">${body}</g>`;
  }
  let body=options.transparent?'':`<rect width="${number(page.width)}" height="${number(page.height)}" fill="${escape(designColor(page.background,page.id,'transparent'))}"/>`;
  for(const layer of page.layers)body+=await layerSvg(layer);
  const draftLabel=historicalDraftLabel(options.historicalDraftLabel);
  if(draftLabel){
    const pixelsPerUnit=page.unit==='mm'?96/25.4:1,padding=Math.min(6/pixelsPerUnit,page.width*.04,page.height*.04),maxSize=Math.min(12/pixelsPerUnit,page.height*.08),layer:DesignLayer={id:'tirlik-historical-draft-label',type:'text',text:draftLabel,transform:{x:0,y:0,width:page.width,height:page.height,rotation:0},style:{fontFamily:'Noto Sans',fontSize:maxSize,fill:'#ffffff'}};
    const loaded=await assets.font(layer);
    for(const char of draftLabel)if(!/\s/u.test(char)&&!loaded.font.hasGlyphForCodePoint(char.codePointAt(0)!))throw new DesignExportError('missing-glyph',layer.id,`U+${char.codePointAt(0)!.toString(16).toUpperCase()}`);
    const run=loaded.font.layout(draftLabel),natural=run.positions.reduce((sum,position)=>sum+position.xAdvance,0)/loaded.font.unitsPerEm,maxWidth=Math.max(1,page.width-padding*2),fontSize=Math.min(maxSize,maxWidth/Math.max(natural,1)),scale=fontSize/loaded.font.unitsPerEm;
    const textWidth=natural*fontSize,bandHeight=Math.min(page.height,Math.max(fontSize*1.8,padding*2+fontSize)),bandY=Math.max(0,page.height-bandHeight),baseline=bandY+(bandHeight-fontSize)/2+loaded.font.ascent*scale,x=Math.max(padding,page.width-padding-textWidth);
    let paths='',cursor=x;
    run.glyphs.forEach((glyph,index)=>{const position=run.positions[index]!,d=glyph.path.toSVG();if(!/^[MmLlHhVvCcSsQqTtAaZz0-9eE+., \-\r\n]*$/.test(d))throw new DesignExportError('missing-font',layer.id);paths+=`<path d="${d}" transform="translate(${number(cursor+position.xOffset*scale)} ${number(baseline-position.yOffset*scale)}) scale(${number(scale)} ${number(-scale)})" fill="#ffffff"/>`;cursor+=position.xAdvance*scale;});
    body+=`<g aria-label="${escape(draftLabel)}"><rect x="0" y="${number(bandY)}" width="${number(page.width)}" height="${number(bandHeight)}" fill="#202624" opacity="0.72"/>${paths}</g>`;
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${number(page.width)} ${number(page.height)}">${body}</svg>`;
  if(svg.length>80*1024*1024)throw new DesignExportError('too-large');
  return {svg,warnings};
}
