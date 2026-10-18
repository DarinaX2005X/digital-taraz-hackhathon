import type * as Fabric from 'fabric';
import type { DesignLayer, DesignPage } from '../domain/model';
import type { DesignAction } from '../domain/actions';
import { rotatePoint, snapLayer } from '../domain/geometry';
import { loadDesignCanvasFont } from './font-family';

export type CanvasModel = { page: DesignPage; selection: string[]; locked: Set<string>; editable: boolean; zoom: number };
type Options = { element: HTMLCanvasElement; workspaceId: string; userId: string; signal?: AbortSignal; onSelection(ids: string[]): void; onAction(action: DesignAction, typingKey?: string): void; onError(): void };
type ObjectWithId = Fabric.FabricObject & { designId?: string };
const numeric = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^(#[\da-f]{3,8}|transparent)$/i.test(value) ? value : fallback;

/** A disposable view of the canonical document. Fabric JSON and history are never persisted. */
export async function createDesignCanvas(options: Options) {
  const fabric = await import('fabric');
  options.signal?.throwIfAborted();
  const canvas = new fabric.Canvas(options.element, { preserveObjectStacking: true, selection: true, stopContextMenu: true, fireRightClick: false });
  let model: CanvasModel | undefined, disposed = false, rendering = false, renderId = 0;
  const abort = new AbortController();
  const images = new Map<string, Promise<HTMLImageElement>>();
  const fonts = new Map<string, Promise<void>>();
  const loadedFonts = new Set<FontFace>();
  async function bytes(id: string) {
    const response = await fetch(`/api/sources/assets/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(options.workspaceId)}`, {credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{'X-Tirlik-User-Id':options.userId}});
    if (!response.ok) throw new Error('asset-unavailable');
    return response.blob();
  }
  function image(id: string) {
    let pending = images.get(id);
    if (!pending) {
      pending = bytes(id).then((blob) => new Promise<HTMLImageElement>((resolve,reject) => {
        const url=URL.createObjectURL(blob), img=new Image();
        img.onload=()=>{URL.revokeObjectURL(url);resolve(img);}; img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('image-invalid'));}; img.src=url;
      })); images.set(id,pending);
    }
    return pending;
  }
  async function font(id: string | undefined, weight: number) {
    if (!id) return loadDesignCanvasFont(document.fonts, weight);
    let pending=fonts.get(id);
    if (!pending) { pending=bytes(id).then(async(blob)=>{const face=new FontFace(`Tirlik-${id}`,await blob.arrayBuffer());await face.load();if(!disposed){document.fonts.add(face);loadedFonts.add(face);}});fonts.set(id,pending); }
    await pending; return `Tirlik-${id}`;
  }
  async function object(layer: DesignLayer, locked: boolean): Promise<ObjectWithId> {
    const t=layer.transform,s=layer.style;
    const common={originX:'left' as const,originY:'top' as const,left:t.x,top:t.y,width:t.width,height:t.height,angle:t.rotation,opacity:numeric(s.opacity,1),visible:!layer.hidden,selectable:!locked&&!!model?.editable,evented:!locked,lockScalingFlip:true,strokeWidth:numeric(s.strokeWidth,0),stroke:color(s.stroke,'transparent'),fill:color(s.fill,'#202624'),cornerColor:'#086a70',borderColor:'#086a70',cornerSize:12,transparentCorners:false};
    let result:ObjectWithId;
    if(layer.type==='text') {
      if(!layer.fontAssetId&&s.fontFamily&&s.fontFamily!=='Noto Sans')throw new Error('font-unavailable');
      const family=await font(layer.fontAssetId,numeric(s.fontWeight,400));
      const textAlign=s.textAlign==='center'||s.textAlign==='right'||s.textAlign==='justify'?s.textAlign:'left';
      result=new fabric.Textbox(layer.text??'',{...common,fontFamily:family,fontSize:numeric(s.fontSize,48),fontWeight:numeric(s.fontWeight,400),fontStyle:s.fontStyle==='italic'?'italic':'normal',textAlign,lineHeight:numeric(s.lineHeight,1.2),charSpacing:numeric(s.letterSpacing,0)*1000/numeric(s.fontSize,48),splitByGrapheme:true,editable:!locked&&!!model?.editable});
    } else if(layer.type==='image') {
      const img=await image(layer.assetId!); const crop=layer.crop??{x:0,y:0,width:1,height:1};
      result=new fabric.FabricImage(img,{...common,width:img.naturalWidth*crop.width,height:img.naturalHeight*crop.height,cropX:img.naturalWidth*crop.x,cropY:img.naturalHeight*crop.y,scaleX:t.width/(img.naturalWidth*crop.width),scaleY:t.height/(img.naturalHeight*crop.height)});
    } else if(layer.type==='group') {
      const children=await Promise.all((layer.layers??[]).map((child)=>object(child,locked)));
      const group=new fabric.Group(children,{...common,layoutManager:new fabric.LayoutManager(new fabric.FixedLayout()),subTargetCheck:false});
      children.forEach((child,index)=>{const tr=layer.layers![index]!.transform,offset=rotatePoint({x:child.width*child.scaleX/2,y:child.height*child.scaleY/2},tr.rotation);child.set({left:tr.x+offset.x-t.width/2,top:tr.y+offset.y-t.height/2,angle:tr.rotation});child.setCoords();});
      group.set({...common}); result=group;
      group.setControlsVisibility({mt:false,mb:false,ml:false,mr:false});
    } else if(layer.shape==='ellipse') result=new fabric.Ellipse({...common,rx:t.width/2,ry:t.height/2});
    else if(layer.shape==='line') result=new fabric.Line([0,0,t.width,t.height],{...common,stroke:color(s.stroke,color(s.fill,'#202624')),strokeWidth:numeric(s.strokeWidth,2)||2});
    else result=new fabric.Rect({...common,rx:numeric(s.radius,0),ry:numeric(s.radius,0)});
    // Center origins keep geometric coordinates independent of stroke thickness.
    const offset=rotatePoint({x:result.width*result.scaleX/2,y:result.height*result.scaleY/2},t.rotation);
    result.set({originX:'center',originY:'center',left:t.x+offset.x,top:t.y+offset.y});
    if(result instanceof fabric.Textbox)result.setControlsVisibility({tl:false,tr:false,bl:false,br:false,mt:false,mb:false});
    (result as ObjectWithId).designId=layer.id;return result;
  }
  function selection() {
    if(rendering)return;
    const selected=canvas.getActiveObjects().map((item)=>(item as ObjectWithId).designId).filter((id):id is string=>!!id);
    const active=canvas.getActiveObject();
    if(active instanceof fabric.ActiveSelection) {active.set({lockScalingX:true,lockScalingY:true,lockRotation:true});active.setControlsVisibility({tl:false,tr:false,bl:false,br:false,mt:false,mb:false,ml:false,mr:false,mtr:false});}
    options.onSelection(selected);
  }
  canvas.on('selection:created',selection);canvas.on('selection:updated',selection);canvas.on('selection:cleared',selection);
  canvas.on('text:changed',({target})=>{if(!rendering&&target){const id=(target as ObjectWithId).designId;if(id)options.onAction({type:'update-layer',id,patch:{text:target.text}},id);}});
  canvas.on('text:editing:exited',()=>{if(model&&!rendering)void render(model);});
  canvas.on('object:moving',({target})=>{
    if(!model||target instanceof fabric.ActiveSelection)return;
    const layer=model.page.layers.find((item)=>item.id===(target as ObjectWithId).designId);if(!layer)return;
    const matrix=target.calcTransformMatrix(),point=fabric.util.transformPoint(new fabric.Point(-target.width/2,-target.height/2),matrix);
    const next={...layer,transform:{...layer.transform,x:point.x,y:point.y}};
    const snapped=snapLayer(next,model.page,model.page.layers,6/model.zoom);
    target.set({left:target.left+snapped.transform.x-point.x,top:target.top+snapped.transform.y-point.y});
  });
  canvas.on('object:modified',({target})=>{
    if(rendering||!target||!model)return;
    const objects=target instanceof fabric.ActiveSelection?target.getObjects():[target];
    const transforms=objects.flatMap((obj)=>{
      const id=(obj as ObjectWithId).designId;const layer=model!.page.layers.find((item)=>item.id===id);if(!id||!layer)return [];
      const matrix=obj.calcTransformMatrix(),decomposed=fabric.util.qrDecompose(matrix),point=fabric.util.transformPoint(new fabric.Point(-obj.width/2,-obj.height/2),matrix);
      return [{id,transform:{x:point.x,y:point.y,width:Math.max(.01,obj.width*Math.abs(decomposed.scaleX)),height:Math.max(.01,obj.height*Math.abs(decomposed.scaleY)),rotation:decomposed.angle}}];
    });
    if(transforms.length)options.onAction({type:'transform-layers',transforms});
  });
  async function render(next:CanvasModel) {
    model=next;const mine=++renderId;
    canvas.setDimensions({width:Math.max(1,next.page.width*next.zoom),height:Math.max(1,next.page.height*next.zoom)});canvas.setZoom(next.zoom);canvas.backgroundColor=next.page.background;
    const active=canvas.getActiveObject();
    if(active instanceof fabric.Textbox&&active.isEditing) {canvas.requestRenderAll();return;}
    try {
      const objects=await Promise.all(next.page.layers.map(async(layer)=>{
        try{return await object(layer,next.locked.has(layer.id));}
        catch(error){
          if(disposed)throw error;
          options.onError();
          const t=layer.transform,placeholder=new fabric.Rect({left:t.x,top:t.y,width:t.width,height:t.height,angle:t.rotation,originX:'left',originY:'top',fill:'transparent',stroke:'#a94030',strokeWidth:2,strokeDashArray:[8,4],selectable:false,evented:false}) as ObjectWithId;
          placeholder.designId=layer.id;return placeholder;
        }
      }));
      if(disposed||mine!==renderId)return;
      const editing=canvas.getActiveObject();if(editing instanceof fabric.Textbox&&editing.isEditing)return;
      rendering=true;canvas.discardActiveObject();canvas.remove(...canvas.getObjects());canvas.add(...objects);
      const selected=objects.filter((item)=>next.selection.includes(item.designId!));
      if(selected.length===1)canvas.setActiveObject(selected[0]!);
      else if(selected.length>1)canvas.setActiveObject(new fabric.ActiveSelection(selected,{canvas,lockScalingX:true,lockScalingY:true,lockRotation:true}));
      rendering=false;canvas.requestRenderAll();
    } catch { if(!disposed&&mine===renderId)options.onError(); }
  }
  return {render,finishText(){const active=canvas.getActiveObject();if(active instanceof fabric.Textbox&&active.isEditing)active.exitEditing();},dispose(){disposed=true;++renderId;abort.abort();void canvas.dispose();images.clear();fonts.clear();loadedFonts.forEach((face)=>document.fonts.delete(face));loadedFonts.clear();}};
}
export type DesignCanvas = Awaited<ReturnType<typeof createDesignCanvas>>;
