import type { Font } from 'fontkit';
import type { DesignLayer } from '@/features/designs/domain/model';
import { DesignExportError } from './types';

export type DesignTextLine={text:string;x:number;baseline:number;width:number};
export type DesignTextLayout={lines:DesignTextLine[];size:number;spacing:number;overflow:boolean;italic:boolean};
export function numericStyle(layer:DesignLayer,key:string,fallback:number,min:number,max:number):number {
  const value=layer.style[key];if(value===undefined)return fallback;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new DesignExportError('unsafe-style',layer.id,key);
  return value;
}
export function designColor(value:unknown,layerId:string,fallback='#202624'):string {
  if(value===undefined)return fallback;
  if(typeof value!=='string'||!/^#[\da-f]{3,4}$|^#[\da-f]{6}(?:[\da-f]{2})?$|^(?:transparent|white|black)$/i.test(value))throw new DesignExportError('unsafe-style',layerId,'color');
  return value;
}
export function layoutDesignText(layer:DesignLayer,font:Font):DesignTextLayout {
  const text=layer.text??'',size=numericStyle(layer,'fontSize',48,1,10000),spacing=numericStyle(layer,'letterSpacing',0,-1000,1000),lineHeight=numericStyle(layer,'lineHeight',1.2,.5,10),scale=size/font.unitsPerEm;
  for(const char of text)if(!/\s/u.test(char)&&!font.hasGlyphForCodePoint(char.codePointAt(0)!))throw new DesignExportError('missing-glyph',layer.id,`U+${char.codePointAt(0)!.toString(16).toUpperCase()}`);
  const measure=(value:string)=>font.layout(value).positions.reduce((sum,position)=>sum+position.xAdvance*scale,0)+Math.max(0,Array.from(value).length-1)*spacing;
  const width=layer.transform.width,lines:string[]=[];
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
    let current='',lineWidth=0;
    for(const {segment} of segmenter.segment(paragraph)){
      const segmentWidth=measure(segment)+(current?spacing:0);
      if(current&&lineWidth+segmentWidth>width){lines.push(current);current=segment;lineWidth=measure(segment);}else{current+=segment;lineWidth+=segmentWidth;}
    }
    lines.push(current);
  }
  const result=lines.map((value,index)=>{const lineWidth=measure(value),align=layer.style.textAlign??'left';return {text:value,width:lineWidth,x:align==='center'?(width-lineWidth)/2:align==='right'?width-lineWidth:0,baseline:font.ascent*scale+index*size*lineHeight};});
  return {lines:result,size,spacing,italic:layer.style.fontStyle==='italic',overflow:result.some((line)=>line.width>width+.01)||(result.at(-1)?.baseline??0)-font.descent*scale>layer.transform.height+.01};
}
