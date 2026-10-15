'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button, CheckboxField, Dialog, InputField, SelectField } from '@/ui';
import type { ImportPreview, ImportRow, MaterialCollection, MaterialImport } from '@/contracts/materials';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { materialClient } from '../client/transport';
import { MaterialError, useMaterialCopy, valueText } from './common';
import styles from './materials.module.css';

export function ImportReview({ownerId,workspaceId,collection,initialImport,onBack}:{ownerId:string;workspaceId:string;collection:MaterialCollection;initialImport:MaterialImport;onBack:()=>void}){
  const t=useMaterialCopy(),access=useWorkspaceAccess(ownerId),{run}=access;
  const[item,setItem]=useState(initialImport),[page,setPage]=useState<ImportPreview>(),[change,setChange]=useState(''),[after,setAfter]=useState<string>(),[refresh,setRefresh]=useState(0);
  const[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[partial,setPartial]=useState(false),[complete,setComplete]=useState(false),[auto,setAuto]=useState(true);
  const[selected,setSelected]=useState<number[]>([]),[bulk,setBulk]=useState<'confirm'|'exclude'>();
  const keys=useRef(new Map<string,{body:string;key:string}>());
  const authz=page?.viewer.authzVersion??access.account.viewer?.workspaces.find((entry)=>entry.workspaceId===workspaceId)?.authzVersion;
  const mutation=()=>({workspaceId,expectedAuthzVersion:authz,expectedRevision:item.expectedRevision,expectedReviewRevision:item.reviewRevision});
  useEffect(()=>{
    if(access.phase!=='active')return;
    const controller=new AbortController();
    void run((signal)=>materialClient.preview(workspaceId,item.id,{after,change:change||undefined},{userId:ownerId,signal}),controller.signal).then((result)=>{setPage(result);setItem(result.import);setSelected([]);}).catch((failure)=>{if(!controller.signal.aborted)setError(failure);});
    return()=>controller.abort();
  },[access.phase,run,ownerId,workspaceId,item.id,after,change,refresh]);
  useEffect(()=>{
    if(access.phase!=='active'||item.status!=='preparing'||!auto||!authz||!page?.canEdit)return;
    const controller=new AbortController();
    void run((signal)=>materialClient.importAction(item.id,'advance',{workspaceId,expectedAuthzVersion:authz,expectedRevision:item.expectedRevision},crypto.randomUUID(),{userId:ownerId,signal}),controller.signal).then((result)=>{setItem(result.import);if(result.import.status!=='preparing')setRefresh((old)=>old+1);}).catch((failure)=>{if(!controller.signal.aborted){setError(failure);setAuto(false);}});
    return()=>controller.abort();
  },[access.phase,item.id,item.status,item.nextChunk,item.expectedRevision,auto,authz,run,workspaceId,ownerId,page?.canEdit]);
  async function action(name:'apply'|'cancel'|'resolve'|'undo-decision',extra:object={}){
    if(busy||!authz||!page?.canEdit)return;setBusy(true);setError(undefined);
    const body={...(name==='cancel'?{workspaceId,expectedAuthzVersion:authz,expectedRevision:item.expectedRevision}:mutation()),...extra},serialized=JSON.stringify(body);
    if(keys.current.get(name)?.body!==serialized)keys.current.set(name,{body:serialized,key:crypto.randomUUID()});
    try{const result=await run((signal)=>materialClient.importAction(item.id,name,body,keys.current.get(name)!.key,{userId:ownerId,signal}));setItem(result.import);setAfter(undefined);setSelected([]);setBulk(undefined);setRefresh((old)=>old+1);}catch(failure){setError(failure);}finally{setBusy(false);}
  }
  if(access.phase!=='active')return <WorkspaceShell workspaceId={workspaceId}><WorkspaceAccessState access={access} returnTo={`/app/materials/collections/${collection.id}?workspaceId=${workspaceId}&importId=${item.id}`}/></WorkspaceShell>;
  return <WorkspaceShell workspaceId={workspaceId}><main className={styles.main}>
    <Link className={styles.back} href={`/app/materials/collections/${collection.id}?workspaceId=${workspaceId}`}><ArrowLeft size={18} aria-hidden="true"/>{collection.title}</Link>
    <div className={styles.heading}><div><h1>{item.status==='applied'?t.saved:t.review}</h1><p>{t.unknownHint}</p></div></div>
    <MaterialError error={error}/>
    {item.status==='applied'?<div className={styles.panel}><CheckCircle2 size={32} aria-hidden="true"/><h2>{t.saved}</h2><p>{t.linkedHint}</p><Link className="tl-button tl-button--primary" href={`/app/materials/collections/${collection.id}?workspaceId=${workspaceId}`}>{t.open}</Link></div>:item.status==='cancelled'||item.status==='failed'?<div className={styles.panel}><p>{item.status==='failed'?t.failedImport:t.cancel}</p><Button onClick={onBack}>{t.back}</Button></div>:<div className={styles.stack}>
      <div className={styles.panel}><dl className={styles.counts}>{(['added','changed','unchanged','missing','ambiguous','excluded','unknownCells','total'] as const).map((kind)=><div key={kind}><dt>{t[kind]}</dt><dd>{item.counts[kind]}</dd></div>)}</dl>
        {!page?.canEdit?<p>{t.readonly}</p>:item.status==='preparing'?<div className={styles.actions}><span role="status">{t.preparing}: {item.nextChunk} / {item.chunkCount}</span>{!auto&&<Button onClick={()=>{setError(undefined);setAuto(true);}}>{t.resume}</Button>}<Button pending={busy} onClick={()=>{setAuto(false);void action('cancel');}}>{t.cancel}</Button></div>:<>
          <CheckboxField label={t.partial} checked={partial} disabled={busy||item.mapping.importMode==='replace-snapshot'} onChange={(event)=>setPartial(event.target.checked)}/>
          {item.mapping.importMode==='replace-snapshot'&&<CheckboxField label={t.complete} checked={complete} disabled={busy} onChange={(event)=>setComplete(event.target.checked)}/>}
          <div className={styles.actions}><Button variant="primary" pending={busy} onClick={()=>{void action('apply',{allowPartial:partial,confirmCompleteSnapshot:complete});}}>{t.apply}</Button><Button disabled={busy} onClick={()=>{void action('cancel');}}>{t.cancel}</Button>{item.reviewRevision>0&&<Button disabled={busy} onClick={()=>{void action('undo-decision');}}>{t.undo}</Button>}<Button onClick={()=>setRefresh((old)=>old+1)} disabled={busy}>{t.reload}</Button></div>
        </>}
      </div>
      {item.status==='preview'&&<><SelectField label={t.review} value={change} onChange={(event)=>{setChange(event.target.value);setAfter(undefined);}}><option value="">{t.all}</option>{(['added','changed','unchanged','missing','ambiguous']as const).map((kind)=><option value={kind} key={kind}>{t[kind]}</option>)}</SelectField>
        {page?.canEdit&&<div className={styles.actions}><CheckboxField label={t.selectedRows} checked={Boolean(page.rows.filter((row)=>row.change!=='missing').length)&&page.rows.filter((row)=>row.change!=='missing').every((row)=>selected.includes(row.ordinal))} onChange={(event)=>setSelected(event.target.checked?page.rows.filter((row)=>row.change!=='missing').map((row)=>row.ordinal):[])}/><Button disabled={!selected.length||busy} onClick={()=>setBulk('confirm')}>{t.confirm} ({selected.length})</Button><Button disabled={!selected.length||busy} onClick={()=>setBulk('exclude')}>{t.exclude} ({selected.length})</Button></div>}
        {page?.rows.map((row)=><div key={`${row.ordinal}:${item.reviewRevision}`}>{page.canEdit&&row.change!=='missing'&&<CheckboxField label={`${t.row}: ${row.label||row.ordinal+1}`} checked={selected.includes(row.ordinal)} onChange={(event)=>setSelected((old)=>event.target.checked?[...old,row.ordinal]:old.filter((ordinal)=>ordinal!==row.ordinal))}/>}<ReviewRow row={row} item={item} busy={busy||!page.canEdit} save={(changes)=>action('resolve',{changes:[changes]})}/></div>)}
        <div className={styles.footer}><span className={styles.meta}>{t.selectedRows}</span><div className={styles.actions}>{after&&<Button onClick={()=>setAfter(undefined)}>{t.reset}</Button>}{page?.nextCursor&&<Button onClick={()=>setAfter(page.nextCursor!)}>{t.more}</Button>}</div></div>
      </>}
    </div>}
    <Dialog open={Boolean(bulk)} onOpenChange={(open)=>{if(!open&&!busy)setBulk(undefined);}} title={bulk==='exclude'?t.exclude:t.confirm} description={t.review} footer={<><Button disabled={busy} onClick={()=>setBulk(undefined)}>{t.close}</Button><Button variant="primary" pending={busy} onClick={()=>{const rows=page?.rows.filter((row)=>selected.includes(row.ordinal))??[];void action('resolve',{changes:rows.map((row)=>bulk==='exclude'?{ordinal:row.ordinal,exclude:true}:{ordinal:row.ordinal,values:Object.fromEntries(Object.entries(row.cells).map(([id,cell])=>[id,cell.rawValue]))})});}}>{t.resolve}</Button></>}><div className={styles.stack}><p>{t.total}: {selected.length}</p><ul>{page?.rows.filter((row)=>selected.includes(row.ordinal)).map((row)=><li key={row.ordinal}>{row.label||`${t.row} ${row.ordinal+1}`}</li>)}</ul><MaterialError error={error}/></div></Dialog>
  </main></WorkspaceShell>;
}
function ReviewRow({row,item,busy,save}:{row:ImportRow;item:MaterialImport;busy:boolean;save:(change:{ordinal:number;values?:Record<string,string>;exclude?:boolean;keyOverride?:string|null})=>Promise<void>}){
  const t=useMaterialCopy(),[editing,setEditing]=useState(false),[values,setValues]=useState<Record<string,string>>(Object.fromEntries(Object.entries(row.cells).map(([id,cell])=>[id,cell.rawValue]))),[override,setOverride]=useState('');
  return <section className={styles.reviewRow}><div className={styles.actions}><h3>{row.label||`${t.row} ${row.ordinal+1}`}</h3><span>{t[row.change]}{row.excluded?` / ${t.excluded}`:''}</span></div>
    <div className={styles.scroll}><table className={styles.table}><thead><tr><th>{t.label}</th><th>{t.before}</th><th>{t.after}</th></tr></thead><tbody>{item.mapping.fields.map((field)=>{const cell=row.cells[field.id],before=row.before?.[field.id];return <tr key={field.id}><th scope="row">{field.label}</th><td>{before?valueText(before.value,t.unknown):''}</td><td>{cell&&<div className={styles.cell}><span>{valueText(cell.value,t.unknown)}</span>{cell.reviewState==='needs-review'&&<strong>{t.reviewNeeded}</strong>}<span className={styles.meta}>{t.original}: {cell.sourceRawValue??cell.rawValue}</span>{editing&&<InputField label={`${t.value}: ${field.label}`} value={values[field.id]??''} maxLength={16000} onChange={(event)=>setValues((old)=>({...old,[field.id]:event.target.value}))}/>}</div>}</td></tr>;})}</tbody></table></div>
    {row.change!=='missing'&&<div className={styles.actions}><Button disabled={busy} onClick={()=>setEditing(!editing)}>{editing?t.close:t.correct}</Button><Button disabled={busy} onClick={()=>{void save({ordinal:row.ordinal,exclude:!row.excluded});}}>{row.excluded?t.include:t.exclude}</Button></div>}
    {editing&&row.change!=='missing'&&<div className={styles.panel}><InputField label={t.override} value={override} maxLength={1000} onChange={(event)=>setOverride(event.target.value)}/><div className={styles.actions}><Button pending={busy} onClick={()=>{void save({ordinal:row.ordinal,values,...(override.trim()?{keyOverride:override.trim()}: {})});}}>{t.resolve}</Button><Button disabled={busy} onClick={()=>{void save({ordinal:row.ordinal,keyOverride:null});}}>{t.clearOverride}</Button></div></div>}
  </section>;
}



