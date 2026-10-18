'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Circle, Copy, Eye, EyeOff, Group, ImagePlus, Lock, Minus, Plus, Redo2, Save, Square, Trash2, Type, Undo2, Ungroup, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import { useLocale } from '@/i18n/provider';
import { Button, IconButton } from '@/ui/button';
import { Toolbar, ToolbarItem } from '@/ui/toolbar';
import type { SourceFreshness } from '@/features/artifacts/contracts';
import { valueText } from '@/features/materials/domain/display';
import { DesignFactPicker } from './fact-picker';
import { ImportDesignButton } from '@/features/design-export/ui/import-design';
import type { ArtifactSession, ArtifactSessionState } from '@/features/artifacts/client/session';
import { createDesignController } from '../client/controller';
import { createDesignCanvas, type DesignCanvas } from '../client/fabric-engine';
import type { DesignAction } from '../domain/actions';
import { isLayerLocked, layerLocations, newLayer, type DesignLayer } from '../domain/model';
import { designMessages } from '../locales';
import { AssetPicker, type PickedDesignAsset } from './asset-picker';
import { fieldBindingProperty } from '@/contracts/artifacts';
import { fitDesignPage } from './viewport-fit';
import styles from './design-editor.module.css';

function NumberField({label,value,onCommit,min,max,step=1,disabled}:{label:string;value:number;onCommit(value:number):void;min?:number;max?:number;step?:number;disabled?:boolean}) {
  const [draft,setDraft]=useState(String(value));const [previous,setPrevious]=useState(value);
  if(previous!==value){setPrevious(value);setDraft(String(Math.round(value*1000)/1000));}
  return <label className={styles.field}>{label}<input type="number" inputMode="decimal" value={draft} min={min} max={max} step={step} disabled={disabled} onChange={(event)=>setDraft(event.target.value)} onBlur={()=>{const next=Number(draft);if(draft.trim()&&Number.isFinite(next)&&(min===undefined||next>=min)&&(max===undefined||next<=max))onCommit(next);else setDraft(String(value));}} onKeyDown={(event)=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>;
}
const number=(layer:DesignLayer,key:string,fallback:number)=>typeof layer.style[key]==='number'?layer.style[key] as number:fallback;
export function DesignEditor({session,state:sessionState,onFlushReady}:{session:ArtifactSession;state:ArtifactSessionState;onFlushReady?:(flush:(()=>Promise<boolean>)|null)=>void}) {
  const {locale}=useLocale(),t=designMessages(locale);
  const [controller]=useState(()=>createDesignController(session));
  const current=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const [pageId,setPageId]=useState(current.content.pages[0]!.id),[selection,setSelection]=useState<string[]>([]),[zoom,setZoom]=useState(.5),[fitMode,setFitMode]=useState(true),[error,setError]=useState(false),[canvasError,setCanvasError]=useState(false),[engineReady,setEngineReady]=useState(0),[picker,setPicker]=useState<'image'|'replace-image'|'font'|'fact'|'brand-color'|undefined>(),[multiple,setMultiple]=useState(false),[historyBusy,setHistoryBusy]=useState(false);
  const canvasRef=useRef<HTMLCanvasElement>(null),viewportRef=useRef<HTMLDivElement>(null),engine=useRef<DesignCanvas|undefined>(undefined);
  const snapshot=sessionState.snapshot,workspaceId=snapshot?.artifact.workspaceId,userId=snapshot?.viewer.userId,authzVersion=snapshot?.viewer.authzVersion;
  const page=current.content.pages.find((item)=>item.id===pageId)??current.content.pages[0]!;
  const canvasZoom=Math.min(zoom,8192/Math.max(page.width,page.height),Math.sqrt(40_000_000/(page.width*page.height)));
  const locations=useMemo(()=>layerLocations(current.content),[current.content]);
  const selected=useMemo(()=>selection.map((id)=>locations.get(id)).filter((item)=>item?.pageId===page.id),[selection,locations,page.id]);
  const selectedIds=useMemo(()=>selected.map((item)=>item!.layer.id),[selected]),layer=selected.length===1?selected[0]!.layer:undefined;
  const layerBindings=useMemo(()=>layer&&snapshot?snapshot.artifact.bindings.filter((binding)=>binding.targetElementId===layer.id):[],[layer,snapshot]);
  const editable=!!snapshot?.permissions.edit&&!['archived','trashed'].includes(snapshot.artifact.status)&&sessionState.storageReady&&['ready','dirty','saving'].includes(current.phase);
  const locked=useMemo(()=>new Set([...locations.values()].filter((item)=>snapshot&&isLayerLocked(snapshot,item)).flatMap((item)=>[item.layer.id,...item.ancestors])),[locations,snapshot]);
  const selectionLocked=selectedIds.some((id)=>locked.has(id));
  const applyFit=useCallback(()=>{
    const viewport=viewportRef.current;
    if(!viewport||viewport.clientWidth<=0||viewport.clientHeight<=0)return;
    const next=fitDesignPage({viewportWidth:viewport.clientWidth,viewportHeight:viewport.clientHeight,pageWidth:page.width,pageHeight:page.height});
    setZoom((value)=>value===next?value:next);
  },[page.width,page.height]);
  const fit=useCallback(()=>{setFitMode(true);applyFit();},[applyFit]);
  const dispatch=useCallback(async(action:DesignAction,typingKey?:string,sourceFreshness?:SourceFreshness[])=>{
    setError(false);
    try {const result=await controller.action(action,t.editor,{typingKey,sourceFreshness});if(result){setSelection(result.selection);if(result.pageId){setPageId(result.pageId);setFitMode(true);}}}
    catch{setError(true);}
  },[controller,t.editor]);
  const callbacks=useRef({dispatch});
  useEffect(()=>{callbacks.current={dispatch};},[dispatch]);
  useEffect(()=>controller.mount(),[controller]);
  useEffect(()=>{
    if(!fitMode||sessionState.phase!=='ready')return;
    const viewport=viewportRef.current;
    if(!viewport)return;
    applyFit();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(applyFit);
    observer.observe(viewport);
    return()=>observer.disconnect();
  },[applyFit,fitMode,sessionState.phase]);
  const flush=useCallback(async()=>{engine.current?.finishText();return controller.flush();},[controller]);
  useEffect(()=>{onFlushReady?.(flush);return()=>onFlushReady?.(null);},[onFlushReady,flush]);
  useEffect(()=>{
    if(!canvasRef.current||!workspaceId||!userId)return;
    let cancelled=false,created:DesignCanvas|undefined;const abort=new AbortController();
    void createDesignCanvas({element:canvasRef.current,workspaceId,userId,signal:abort.signal,onSelection:setSelection,onAction:(action,key)=>{void callbacks.current.dispatch(action,key);},onError:()=>setCanvasError(true)}).then((value)=>{created=value;if(cancelled){value.dispose();return;}engine.current=value;setEngineReady((epoch)=>epoch+1);}).catch(()=>{if(!cancelled)setCanvasError(true);});
    return()=>{cancelled=true;abort.abort();created?.dispose();engine.current=undefined;};
  },[workspaceId,userId,authzVersion]);
  useEffect(()=>{if(engineReady)void engine.current?.render({page,selection:selectedIds,locked,editable,zoom:canvasZoom});},[page,selectedIds,locked,editable,canvasZoom,engineReady,error]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(['dirty','saving','failed'].includes(controller.getSnapshot().phase)){event.preventDefault();}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[controller]);
  async function history(kind:'undo'|'redo') {
    if(!await flush())return;setHistoryBusy(true);
    try {const group=session.getSnapshot().snapshot?.history.find((entry)=>entry.artifacts.length===1&&(kind==='undo'?entry.canUndo:entry.canRedo));if(!group)return;const checked=await session.prepareHistory(kind,group.commandGroupId);await session.run(checked.operation);}
    catch{setError(true);}finally{setHistoryBusy(false);}
  }
  function style(patch:DesignLayer['style']){void dispatch({type:'style',ids:selectedIds,style:patch});}
  function update(patch:Partial<Omit<DesignLayer,'id'|'type'|'layers'>>){if(layer)void dispatch({type:'update-layer',id:layer.id,patch});}
  function transform(key:keyof DesignLayer['transform'],value:number){if(!layer)return;const next={...layer.transform,[key]:value};if(layer.type==='group'&&(key==='width'||key==='height')){const scale=value/layer.transform[key];next.width=layer.transform.width*scale;next.height=layer.transform.height*scale;}update({transform:next});}
  function add(type:'text'|'shape',shape?:DesignLayer['shape']){void dispatch({type:'insert-layer',pageId:page.id,layer:newLayer(type,crypto.randomUUID(),{text:t.newText,shape})});}
  function pick(asset:PickedDesignAsset){if(picker==='font'&&layer)update({fontAssetId:asset.id,style:{...layer.style,fontWeight:400,fontStyle:'normal'}});else if(picker==='replace-image'&&layer)update({assetId:asset.id,crop:undefined});else{const ratio=asset.width&&asset.height?asset.width/asset.height:1;const width=Math.min(page.width*.7,480);void dispatch({type:'insert-layer',pageId:page.id,layer:newLayer('image',crypto.randomUUID(),{assetId:asset.id,width,height:width/ratio})});}setPicker(undefined);}
  const status=current.phase==='ready'?t.saved:current.phase==='saving'?t.saving:current.phase==='dirty'?t.dirty:current.phase==='failed'?t.failed:current.phase==='conflict'?t.conflict:current.phase==='recovery'?t.recovery:'';
  if(!snapshot||sessionState.phase!=='ready'||current.phase==='hidden')return null;
  const lockedLayer=!!layer&&locked.has(layer.id),canChange=editable&&!selectionLocked&&selectedIds.length>0;
  const historyAvailable=(kind:'undo'|'redo')=>snapshot.history.some((entry)=>entry.artifacts.length===1&&(kind==='undo'?entry.canUndo:entry.canRedo));
  return <section className={styles.editor} aria-label={t.editor}>
    <Toolbar label={t.tools} className={styles.toolbar}>
      <ToolbarItem render={<IconButton icon={Undo2} label={t.undo} disabled={!editable||historyBusy||!historyAvailable('undo')} onClick={()=>void history('undo')}/>}/>
      <ToolbarItem render={<IconButton icon={Redo2} label={t.redo} disabled={!editable||historyBusy||!historyAvailable('redo')} onClick={()=>void history('redo')}/>}/>
      <ToolbarItem render={<Button icon={Type} onClick={()=>add('text')} disabled={!editable}>{t.text}</Button>}/>
      <ToolbarItem render={<IconButton icon={Square} label={t.rect} onClick={()=>add('shape','rect')} disabled={!editable}/>}/>
      <ToolbarItem render={<IconButton icon={Circle} label={t.ellipse} onClick={()=>add('shape','ellipse')} disabled={!editable}/>}/>
      <ToolbarItem render={<IconButton icon={Minus} label={t.line} onClick={()=>add('shape','line')} disabled={!editable}/>}/>
      <ToolbarItem render={<IconButton icon={ImagePlus} label={t.addImage} onClick={()=>setPicker('image')} disabled={!editable}/>}/>
      <ImportDesignButton snapshot={snapshot} beforeOpen={flush} disabled={!editable}/>
      <ToolbarItem render={<IconButton icon={ZoomOut} label={t.zoomOut} onClick={()=>{setFitMode(false);setZoom((value)=>Math.max(.01,value/1.25));}}/>}/>
      <output className={styles.zoomValue}>{Math.round(canvasZoom*100)}%</output>
      <ToolbarItem render={<IconButton icon={ZoomIn} label={t.zoomIn} onClick={()=>{setFitMode(false);setZoom((value)=>Math.min(4,value*1.25));}}/>}/>
      <ToolbarItem render={<Button variant="quiet" onClick={fit}>{t.fit}</Button>}/><span className={styles.spacer}/><span className={styles.status} role="status">{!snapshot.permissions.edit?t.readOnly:status}{current.phase!=='ready'&&current.localSaved?` · ${t.local}`:''}</span>
      <ToolbarItem render={<IconButton icon={Save} label={t.save} disabled={!editable} onClick={()=>void flush()}/>}/>
    </Toolbar>
    {['failed','conflict','recovery'].includes(current.phase)&&<div className={styles.notice} role="alert">{status}{current.phase==='failed'&&<Button onClick={()=>void controller.retry()}>{t.retry}</Button>}</div>}
    {error&&<p className={styles.notice} role="alert">{t.actionError}</p>}
    <div className={styles.body}>
      <aside className={styles.sidebar} aria-label={t.layers}>
        <h3>{t.pages}</h3><ol className={styles.pages}>{current.content.pages.map((item,index)=><li key={item.id}><button className={styles.pageButton} aria-current={item.id===page.id} aria-label={`${t.page} ${index+1}`} onClick={()=>{engine.current?.finishText();setFitMode(true);setPageId(item.id);setSelection([]);}}>{index+1}</button></li>)}<li><IconButton icon={Plus} label={t.addPage} disabled={!editable||current.content.pages.length>=100} onClick={()=>void dispatch({type:'insert-page',page:{id:crypto.randomUUID(),width:page.width,height:page.height,unit:page.unit,background:page.background,layers:[]}})}/></li></ol>
        <h3>{t.layers}</h3><label className={styles.checkbox}><input type="checkbox" checked={multiple} onChange={(event)=>setMultiple(event.target.checked)}/>{t.selectMultiple}</label>
        <ul className={styles.layerList}>{[...locations.values()].filter((item)=>item.pageId===page.id).reverse().map((item)=>{const itemSelected=selectedIds.includes(item.layer.id);return <li className={styles.layerRow} key={item.layer.id} data-selected={itemSelected} data-hidden={item.layer.hidden} style={{paddingInlineStart:Math.max(0,item.ancestors.length-1)*10}}><button className={styles.layerSelect} aria-pressed={itemSelected} onClick={(event)=>{engine.current?.finishText();setSelection((ids)=>multiple||event.shiftKey?ids.includes(item.layer.id)?ids.filter((id)=>id!==item.layer.id):[...ids,item.layer.id]:[item.layer.id]);}}>{item.layer.type==='text'?<Type size={16}/>:item.layer.type==='image'?<ImagePlus size={16}/>:item.layer.type==='group'?<Group size={16}/>:<Square size={16}/>}<span>{item.layer.name||item.layer.text?.slice(0,40)||(item.layer.type==='shape'?t[item.layer.shape??'rect']:t[item.layer.type])}</span>{locked.has(item.layer.id)&&<Lock size={14}/>}</button></li>;})}</ul>
        {!page.layers.length&&<p className={styles.hint}>{t.empty}</p>}
      </aside>
      <div className={styles.stage}>
        {canvasError&&<p className={styles.notice} role="alert">{t.canvasError}</p>}
        {!engineReady&&!canvasError&&<p className={styles.notice} role="status">{t.loading}</p>}
        <div className={styles.viewport} ref={viewportRef} tabIndex={0} aria-label={t.editor} aria-describedby="design-keyboard-help" onKeyDown={(event)=>{
          if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement)return;
          if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();void history(event.shiftKey?'redo':'undo');return;}
          if(!canChange)return;
          const step=event.shiftKey?10:1,delta=({ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]} as Record<string,number[]>)[event.key];
          if(delta){event.preventDefault();void dispatch({type:'translate',ids:selectedIds,x:delta[0]!,y:delta[1]!});}
          if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();void dispatch({type:'remove',ids:selectedIds});}
        }}><div className={styles.canvasWrap}><canvas key={`${workspaceId}-${userId}-${authzVersion}`} ref={canvasRef}/></div></div>
        <div className={styles.canvasFooter}><span className={styles.spacer}/><span className={styles.selectedCount}>{page.width} × {page.height} {page.unit}</span></div>
      </div>
      <aside className={styles.inspector} aria-label={t.properties}>
        <h3>{t.properties}</h3>
        {!selected.length?<><p className={styles.hint}>{t.selectHint}</p><div><h3>{t.pageSize}</h3><div className={styles.grid}><NumberField label={t.width} value={page.width} min={1} max={100000} disabled={!editable} onCommit={(width)=>void dispatch({type:'update-page',id:page.id,patch:{width}})}/><NumberField label={t.height} value={page.height} min={1} max={100000} disabled={!editable} onCommit={(height)=>void dispatch({type:'update-page',id:page.id,patch:{height}})}/></div><label className={styles.field}>{t.unit}<select value={page.unit} disabled={!editable} onChange={(event)=>void dispatch({type:'update-page',id:page.id,patch:{unit:event.target.value as 'px'|'mm'}})}><option value="px">px</option><option value="mm">mm</option></select></label><label className={styles.field}>{t.background}<input type="color" value={/^#[\da-f]{6}$/i.test(page.background)?page.background:'#ffffff'} disabled={!editable} onChange={(event)=>void dispatch({type:'update-page',id:page.id,patch:{background:event.target.value}})}/></label><label className={styles.checkbox}><input type="checkbox" checked={page.background==='transparent'} disabled={!editable} onChange={(event)=>void dispatch({type:'update-page',id:page.id,patch:{background:event.target.checked?'transparent':'#ffffff'}})}/>{t.transparent}</label><div className={styles.actions}><IconButton icon={Copy} label={t.duplicate} disabled={!editable} onClick={()=>void dispatch({type:'duplicate-page',id:page.id})}/><IconButton icon={Trash2} label={t.remove} disabled={!editable||current.content.pages.length===1} onClick={()=>void dispatch({type:'remove-page',id:page.id})}/></div></div></>:<>
          <div className={styles.actions}>
            <IconButton icon={Copy} label={t.duplicate} disabled={!editable} onClick={()=>void dispatch({type:'duplicate',ids:selectedIds})}/><IconButton icon={Trash2} label={t.remove} disabled={!canChange} onClick={()=>void dispatch({type:'remove',ids:selectedIds})}/><IconButton icon={selectionLocked?Unlock:Lock} label={selectionLocked?t.unlock:t.lock} disabled={!editable} onClick={()=>void dispatch({type:'lock',ids:selectedIds,locked:!selectionLocked})}/><IconButton icon={layer?.hidden?Eye:EyeOff} label={layer?.hidden?t.show:t.hide} disabled={!canChange} onClick={()=>void dispatch({type:'visibility',ids:selectedIds,hidden:!layer?.hidden})}/><IconButton icon={Group} label={t.group} disabled={!canChange||selectedIds.length<2} onClick={()=>void dispatch({type:'group',ids:selectedIds})}/><IconButton icon={Ungroup} label={t.ungroup} disabled={!canChange||layer?.type!=='group'} onClick={()=>void dispatch({type:'ungroup',ids:selectedIds})}/>
          </div>
          {layer&&<div><label className={styles.field}>{t.name}<input value={layer.name??''} disabled={!canChange} maxLength={240} onChange={(event)=>update({name:event.target.value.trim()?event.target.value:undefined})}/></label><div className={styles.grid}>{(['x','y','width','height','rotation'] as const).map((key)=><NumberField key={key} label={key==='x'?'X':key==='y'?'Y':t[key]} value={layer.transform[key]} disabled={!canChange} min={key==='width'||key==='height' ? .01 : undefined} max={key==='width'||key==='height'?100000:undefined} onCommit={(value)=>transform(key,value)}/>)}</div><NumberField label={t.opacity} value={number(layer,'opacity',1)} min={0} max={1} step={.05} disabled={!canChange} onCommit={(opacity)=>style({opacity})}/></div>}
          {layer?.type==='text'&&<div className={styles.section}><label className={styles.field}>{t.text}<textarea value={layer.text??''} disabled={!canChange} onChange={(event)=>void dispatch({type:'update-layer',id:layer.id,patch:{text:event.target.value}},layer.id)}/></label><label className={styles.field}>{t.font}<select value={layer.fontAssetId?'custom':'noto'} disabled={!canChange} onChange={(event)=>{if(event.target.value==='custom')setPicker('font');else update({fontAssetId:undefined});}}><option value="noto">Noto Sans</option><option value="custom">{t.assets}</option></select></label>{layer.fontAssetId&&<Button disabled={!canChange} onClick={()=>setPicker('font')}>{t.font}</Button>}<div className={styles.grid}><NumberField label={t.fontSize} value={number(layer,'fontSize',48)} min={1} max={1000} disabled={!canChange} onCommit={(fontSize)=>style({fontSize})}/><label className={styles.field}>{t.weight}<select value={number(layer,'fontWeight',400)} disabled={!canChange||!!layer.fontAssetId} onChange={(event)=>style({fontWeight:Number(event.target.value)})}>{([400,500,600,700] as const).map((value,index)=><option key={value} value={value}>{[t.regular,t.medium,t.semibold,t.bold][index]}</option>)}</select></label><NumberField label={t.lineHeight} value={number(layer,'lineHeight',1.2)} min={.5} max={5} step={.1} disabled={!canChange} onCommit={(lineHeight)=>style({lineHeight})}/><NumberField label={t.letterSpacing} value={number(layer,'letterSpacing',0)} min={-20} max={100} step={.1} disabled={!canChange} onCommit={(letterSpacing)=>style({letterSpacing})}/></div><div className={styles.actions}>{(['left','center','right'] as const).map((align,index)=><IconButton key={align} icon={[AlignLeft,AlignCenter,AlignRight][index]!} label={align==='center'?t.centerX:t[align]} aria-pressed={layer.style.textAlign===align} disabled={!canChange} onClick={()=>style({textAlign:align})}/>)}</div></div>}
          {layer&&['shape','text'].includes(layer.type)&&<div className={styles.section}><label className={styles.field}>{t.fill}<input type="color" value={typeof layer.style.fill==='string'&&/^#[\da-f]{6}$/i.test(layer.style.fill)?layer.style.fill:'#202624'} disabled={!canChange} onChange={(event)=>style({fill:event.target.value})}/></label>{layer.type==='shape'&&<><label className={styles.field}>{t.stroke}<input type="color" value={typeof layer.style.stroke==='string'&&/^#[\da-f]{6}$/i.test(layer.style.stroke)?layer.style.stroke:'#202624'} disabled={!canChange} onChange={(event)=>style({stroke:event.target.value})}/></label><NumberField label={t.strokeWidth} value={number(layer,'strokeWidth',0)} min={0} max={1000} disabled={!canChange} onCommit={(strokeWidth)=>style({strokeWidth})}/></>}</div>}
          {layer?.type==='image'&&<div className={styles.section}><Button disabled={!canChange} onClick={()=>setPicker('replace-image')}>{t.image} · {t.choose}</Button><h3>{t.crop}</h3><p className={styles.hint}>{t.cropHint}</p><div className={styles.grid}>{(['x','y','width','height'] as const).map((key)=><NumberField key={key} label={key==='x'?'X':key==='y'?'Y':t[key]} value={layer.crop?.[key]??(key==='x'||key==='y'?0:1)} min={key==='x'||key==='y'?0:.001} max={1} step={.01} disabled={!canChange} onCommit={(value)=>{const crop={x:0,y:0,width:1,height:1,...layer.crop,[key]:value};crop.width=Math.min(crop.width,1-crop.x);crop.height=Math.min(crop.height,1-crop.y);if(crop.width>0&&crop.height>0)update({crop});}}/>)}</div><Button disabled={!canChange} onClick={()=>update({crop:undefined})}>{t.resetCrop}</Button></div>}
          <div className={styles.section}><div className={styles.actions}><IconButton icon={ArrowUpToLine} label={t.front} disabled={!canChange} onClick={()=>void dispatch({type:'order',ids:selectedIds,direction:'front'})}/><IconButton icon={ArrowDownToLine} label={t.back} disabled={!canChange} onClick={()=>void dispatch({type:'order',ids:selectedIds,direction:'back'})}/></div><label className={styles.field}>{t.textAlign}<select value="" disabled={!canChange} onChange={(event)=>{if(event.target.value)void dispatch({type:'align',ids:selectedIds,alignment:event.target.value as 'left',toPage:selectedIds.length===1});}}><option value="">—</option>{(['left','center-x','right','top','center-y','bottom'] as const).map((value)=><option key={value} value={value}>{value==='center-x'?t.centerX:value==='center-y'?t.centerY:t[value]}</option>)}</select></label>{selectedIds.length>=3&&<div className={styles.actions}><Button disabled={!canChange} onClick={()=>void dispatch({type:'distribute',ids:selectedIds,axis:'x'})}>{t.distributeX}</Button><Button disabled={!canChange} onClick={()=>void dispatch({type:'distribute',ids:selectedIds,axis:'y'})}>{t.distributeY}</Button></div>}</div>
          {layer&&['text','shape'].includes(layer.type)&&<Button disabled={!canChange} onClick={()=>setPicker('brand-color')}>{t.fill} · {t.assets}</Button>}
          {layer?.type==='text'&&<Button disabled={!canChange} onClick={()=>setPicker('fact')}>{t.binding}</Button>}
          {layerBindings.map((binding)=>{const property=fieldBindingProperty(binding);return <div className={styles.section} key={`${binding.targetElementId}:${property}`}><h3>{t.binding} · {property==='text'?t.text:property==='fill'?t.fill:t.bound}</h3>{property!=='fill'&&<p className={styles.hint}>{t.bound}</p>}<Button disabled={!editable||lockedLayer} onClick={()=>void dispatch({type:'unbind',id:binding.targetElementId,targetProperty:property})}>{t.unbind}</Button></div>;})}
        </>}
        <p id="design-keyboard-help" className={styles.hint}>{t.keyboard}</p>
      </aside>
    </div>
    {picker&&(picker==='image'||picker==='replace-image'||picker==='font')&&<AssetPicker kind={picker==='font'?'font':'image'} snapshot={snapshot} t={t} onClose={()=>setPicker(undefined)} onPick={pick}/>} 
    {(picker==='fact'||picker==='brand-color')&&layer&&<DesignFactPicker kind={picker==='brand-color'?'brand-color':undefined} snapshot={snapshot} t={t} onClose={()=>setPicker(undefined)} onChoose={async(fact)=>{await dispatch(picker==='brand-color'?{type:'bind-color',id:layer.id,sourceRef:fact.cell.sourceRef,value:valueText(fact.cell.value,'—')}:{type:'bind',id:layer.id,sourceRef:fact.cell.sourceRef,transformId:'display-text',value:valueText(fact.cell.value,'—')},undefined,fact.freshness);setPicker(undefined);}}/>}
  </section>;
}
