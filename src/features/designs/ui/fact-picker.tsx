'use client';
import { useEffect, useState } from 'react';
import { Dialog } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { materialClient } from '@/features/materials/client/transport';
import { valueText } from '@/features/materials/domain/display';
import type { DatasetPage, MaterialCollection, MaterialCell } from '@/contracts/materials';
import type { ArtifactSnapshot, SourceFreshness } from '@/features/artifacts/contracts';
import type { DesignMessages } from '../locales';
import styles from './design-editor.module.css';

export type DesignFact={cell:MaterialCell;freshness:SourceFreshness[]};
export function DesignFactPicker({snapshot,t,onClose,onChoose,kind}:{snapshot:ArtifactSnapshot;t:DesignMessages;onClose():void;onChoose(fact:DesignFact):Promise<void>;kind?:'brand-color'}){
  const {workspaceId,userId}=snapshot.viewer,projectId=snapshot.artifact.projectId;
  const [collections,setCollections]=useState<MaterialCollection[]>([]),[collectionId,setCollectionId]=useState(''),[collectionAfter,setCollectionAfter]=useState<string|null>(null);
  const [dataset,setDataset]=useState<{query:string;page:DatasetPage}>(),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{const abort=new AbortController();void materialClient.list({workspaceId,projectId,...(kind?{kind:'brand' as const}:{})},{userId,signal:abort.signal}).then((result)=>{if(!abort.signal.aborted){setCollections(result.collections);setCollectionAfter(result.nextCursor);}}).catch(()=>{if(!abort.signal.aborted)setError(true);});return()=>abort.abort();},[workspaceId,projectId,userId,kind]);
  useEffect(()=>{if(!collectionId)return;const abort=new AbortController();const timeout=setTimeout(()=>{void materialClient.query({workspaceId,collectionId,query},{userId,signal:abort.signal}).then((page)=>{if(!abort.signal.aborted)setDataset({query,page});}).catch(()=>{if(!abort.signal.aborted)setError(true);});},200);return()=>{clearTimeout(timeout);abort.abort();};},[workspaceId,userId,collectionId,query]);
  async function choose(cell:MaterialCell){setBusy(true);setError(false);try{const result=await materialClient.facts({workspaceId,refs:[cell.sourceRef]},{userId});const fact=result.facts[0];if(!fact?.canBind||fact.state!=='current'||!fact.pinned||fact.pinned.value.kind==='unknown')throw new Error('fact-stale');await onChoose({cell:fact.pinned,freshness:result.sourceFreshness});}catch{setError(true);}finally{setBusy(false);}}
  async function moreCollections(){if(!collectionAfter)return;setBusy(true);try{const result=await materialClient.list({workspaceId,projectId,after:collectionAfter,...(kind?{kind:'brand' as const}:{})},{userId});setCollections((items)=>[...items,...result.collections]);setCollectionAfter(result.nextCursor);}catch{setError(true);}finally{setBusy(false);}}
  async function moreRows(){if(!dataset?.page.nextCursor)return;setBusy(true);try{const page=await materialClient.query({workspaceId,collectionId,query,revision:dataset.page.revision,after:dataset.page.nextCursor},{userId});setDataset({query,page:{...page,records:[...dataset.page.records,...page.records]}});}catch{setError(true);}finally{setBusy(false);}}
  const current=dataset?.page.collection.id===collectionId&&dataset.query===query?dataset.page:undefined;
  return <Dialog open onOpenChange={(open)=>{if(!open)onClose();}} dismissible={!busy} title={t.binding}>
    <label className={styles.field}>{t.assets}<select value={collectionId} disabled={busy} onChange={(event)=>{setCollectionId(event.target.value);setQuery('');setError(false);}}><option value="">—</option>{collections.map((collection)=><option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label>
    {collectionAfter&&<Button disabled={busy} onClick={()=>void moreCollections()}>{t.next}</Button>}
    {collectionId&&<label className={styles.field}>{t.text}<input type="search" value={query} maxLength={120} disabled={busy} onChange={(event)=>{setQuery(event.target.value);setError(false);}}/></label>}
    {collectionId&&!current&&!error&&<p role="status">{t.loading}</p>}
    {current?.records.length===0&&<p>{t.assetEmpty}</p>}
    <ul className={styles.assetList}>{current?.records.flatMap((record)=>current.collection.mapping?.fields.map((field)=>{const cell=record.cells[field.id];if(!cell||(kind==='brand-color'&&(cell.value.kind!=='text'||!/^#[\da-f]{6}$/i.test(cell.value.text))))return null;const enabled=!record.missing&&cell.value.kind!=='unknown'&&cell.reviewState!=='needs-review'&&cell.origin!=='assumed';return <li key={`${record.recordId}:${field.id}`}><div><span>{record.label} · {field.label}</span><strong>{valueText(cell.value,'—')}</strong></div><Button disabled={busy||!enabled} onClick={()=>void choose(cell)}>{t.choose}</Button></li>;})??[])}</ul>
    {current?.nextCursor&&<Button disabled={busy} onClick={()=>void moreRows()}>{t.next}</Button>}
    {error&&<p role="alert">{t.actionError}</p>}
  </Dialog>;
}
