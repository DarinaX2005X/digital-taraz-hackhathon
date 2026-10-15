'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { Button, CheckboxField, Combobox, Dialog, InputField, SelectField, Tabs, TextareaField, type OptionLoader } from '@/ui';
import { useIdentityNavigationGuard } from '@/features/identity/ui/navigation-guard';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { useLocale } from '@/i18n/provider';
import type { CollectionResult, DatasetFacet, DatasetPage, DatasetRecord, MaterialCell } from '@/contracts/materials';
import type { SourceSummary } from '@/contracts/sources';
import { materialClient } from '../client/transport';
import { MaterialError, useMaterialCopy, valueText } from './common';
import { MappingJourney } from './mapping-journey';
import { ImportReview } from './import-review';
import { materialFilterValue, moneyFilterScalar } from '../domain/display';
import styles from './materials.module.css';

type History = Awaited<ReturnType<typeof materialClient.history>>;
type Correction = Awaited<ReturnType<typeof materialClient.correctionPreview>>;
export function MaterialCollectionPage({ownerId,workspaceId,initial,initialImportId}:{ownerId:string;workspaceId:string;initial:CollectionResult;initialImportId?:string}){
  const t=useMaterialCopy(),{locale}=useLocale(),router=useRouter(),access=useWorkspaceAccess(ownerId),{run}=access;
  const[result,setResult]=useState(initial),[data,setData]=useState<DatasetPage>(),[facet,setFacet]=useState<DatasetFacet>(),[history,setHistory]=useState<History>(),[query,setQuery]=useState(''),[tab,setTab]=useState('records'),[after,setAfter]=useState<string>(),[revision,setRevision]=useState<number>(),[refresh,setRefresh]=useState(0);
  const[filterField,setFilterField]=useState(''),[filterOp,setFilterOp]=useState<'eq'|'contains'|'unknown'|'gt'|'lt'>('contains'),[filterValue,setFilterValue]=useState('');
  const[selectedFieldIds,setSelectedFieldIds]=useState<string[]>();
  const[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[source,setSource]=useState<{sourceId:string;sourceVersionId:string}>(),[importId,setImportId]=useState(initialImportId);
  const[selected,setSelected]=useState<{record:DatasetRecord;fieldId:string;cell:MaterialCell}>(),[raw,setRaw]=useState(''),[reason,setReason]=useState(''),[correction,setCorrection]=useState<Correction>(),[undoId,setUndoId]=useState<string>();
  const sources=useRef(new Map<string,SourceSummary>()),keys=useRef(new Map<string,{body:string;key:string}>());
  const navigation=useIdentityNavigationGuard(Boolean(selected&&(raw!==selected.cell.rawValue||reason)));
  const collection=result.collection,allFields=data?.collection.mapping?.fields??collection.mapping?.fields??[],fields=allFields.filter((field)=>!selectedFieldIds||selectedFieldIds.includes(field.id));
  const filterDefinition=allFields.find((field)=>field.id===filterField);
  const scalar=filterDefinition?.kind==='money'?moneyFilterScalar(filterValue,filterDefinition.currency):filterValue;
  const filters=useMemo(()=>filterField?[{fieldId:filterField,op:filterOp,...(filterOp==='unknown'?{}:{value:scalar??''})}]:[],[filterField,filterOp,scalar]);
  const dateTime=useMemo(()=>new Intl.DateTimeFormat(locale==='kk'?'kk-KZ':locale==='ru'?'ru-KZ':'en-KZ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Qyzylorda'}),[locale]);
  function key(name:string,body:unknown){const serialized=JSON.stringify(body);if(keys.current.get(name)?.body!==serialized)keys.current.set(name,{body:serialized,key:crypto.randomUUID()});return keys.current.get(name)!.key;}
  const loadSources=useCallback<OptionLoader>(async(query,signal)=>{const value=await run((signal)=>materialClient.sources({workspaceId,projectId:collection.projectId,query,limit:30},{userId:ownerId,signal}),signal);for(const item of value.sources)sources.current.set(item.id,item);return value.sources.filter((item)=>item.status==='ready'&&item.currentVersionId).map((item)=>({id:item.id,label:item.title}));},[workspaceId,collection.projectId,run,ownerId]);
  useEffect(()=>{
    if(access.phase!=='active'||source||importId)return;
    const controller=new AbortController(),timer=setTimeout(()=>{setLoading(true);setError(undefined);void (async()=>{const next=await run((signal)=>materialClient.read(workspaceId,collection.id,{userId:ownerId,signal}),controller.signal);setResult(next);if(tab==='history')setHistory(await run((signal)=>materialClient.history(workspaceId,collection.id,undefined,{userId:ownerId,signal}),controller.signal));})().catch((failure)=>{if(!controller.signal.aborted)setError(failure);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[access.phase,source,importId,workspaceId,collection.id,ownerId,run,tab,refresh]);
  useEffect(()=>{
    if(access.phase!=='active'||source||importId||tab!=='records')return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{if(filterField&&filterOp!=='unknown'&&scalar===null){setError(t.invalid);return;}setLoading(true);setError(undefined);void (async()=>{
      const request={workspaceId,collectionId:collection.id,revision,query,after,fieldIds:selectedFieldIds,filters};
      setData(await run((signal)=>materialClient.query(request,{userId:ownerId,signal}),controller.signal));
    })().catch((failure)=>{if(!controller.signal.aborted)setError(failure);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[access.phase,source,importId,tab,workspaceId,collection.id,revision,query,after,selectedFieldIds,filters,filterField,filterOp,scalar,ownerId,run,t.invalid]);
  useEffect(()=>{
    if(access.phase!=='active'||source||importId||tab!=='records'||!filterField)return;
    const controller=new AbortController(),timer=setTimeout(()=>{void run((signal)=>materialClient.facet({workspaceId,collectionId:collection.id,revision,fieldId:filterField,limit:20},{userId:ownerId,signal}),controller.signal).then(setFacet).catch((failure)=>{if(!controller.signal.aborted)setError(failure);});},250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[access.phase,source,importId,tab,workspaceId,collection.id,revision,filterField,refresh,ownerId,run]);
  const mutation=()=>({workspaceId,expectedAuthzVersion:result.viewer.authzVersion,expectedRevision:collection.revision});
  async function previewCorrection(){if(!selected||!reason.trim()||busy)return;setBusy(true);setError(undefined);try{const body={...mutation(),changes:[{recordId:selected.record.recordId,fieldId:selected.fieldId,rawValue:raw,reason}]};setCorrection(await run((signal)=>materialClient.correctionPreview(collection.id,body,{userId:ownerId,signal})));}catch(failure){setError(failure);}finally{setBusy(false);}}
  async function saveCorrection(){if(!selected||!correction||busy)return;setBusy(true);setError(undefined);try{const body={...mutation(),changes:[{recordId:selected.record.recordId,fieldId:selected.fieldId,rawValue:raw,reason}],previewHash:correction.previewHash};await run((signal)=>materialClient.correct(collection.id,body,key('correct',body),{userId:ownerId,signal}));setSelected(undefined);setCorrection(undefined);setRaw('');setReason('');setRefresh((old)=>old+1);}catch(failure){setError(failure);}finally{setBusy(false);}}
  async function undo(){if(!undoId||busy)return;setBusy(true);setError(undefined);try{const body={...mutation(),resolutionId:undoId,reason:t.undoReason};await run((signal)=>materialClient.undo(collection.id,body,key('undo',body),{userId:ownerId,signal}));setUndoId(undefined);setRefresh((old)=>old+1);}catch(failure){setError(failure);}finally{setBusy(false);}}
  async function makeSheet(){if(busy||!data)return;setBusy(true);setError(undefined);try{const body={workspaceId,collectionId:collection.id,revision:data.revision,expectedAuthzVersion:result.viewer.authzVersion,query,filters,fieldIds:fields.map((field)=>field.id),title:collection.title};const created=await run((signal)=>materialClient.materialize(body,key('sheet',body),{userId:ownerId,signal}));router.push(`/app/projects/${created.artifact.projectId}/artifacts/${created.artifact.id}?workspace=${workspaceId}`);}catch(failure){setError(failure);}finally{setBusy(false);}}
  const returnTo=`/app/materials/collections/${collection.id}?workspaceId=${workspaceId}`;
  if(access.phase!=='active')return <WorkspaceShell workspaceId={workspaceId}><WorkspaceAccessState access={access} returnTo={returnTo}/></WorkspaceShell>;
  if(source)return <MappingJourney ownerId={ownerId} workspaceId={workspaceId} source={source} existing={collection} onBack={()=>{setSource(undefined);setRefresh((old)=>old+1);}}/>;
  const activeImport=result.imports?.find((item)=>item.id===importId);
  if(activeImport)return <ImportReview ownerId={ownerId} workspaceId={workspaceId} collection={collection} initialImport={activeImport} onBack={()=>{setImportId(undefined);setRefresh((old)=>old+1);}}/>;
  return <WorkspaceShell workspaceId={workspaceId} onClickCapture={navigation.onClickCapture}><main className={styles.main}>
    <Link className={styles.back} href={`/app/materials?workspaceId=${workspaceId}&projectId=${collection.projectId}`}><ArrowLeft size={18} aria-hidden="true"/>{t.back}</Link>
    <div className={styles.heading}><div><h1>{collection.title}</h1><p>{t.total}: {collection.recordCount} / {t.revision}: {collection.revision}</p><p>{t.linkedHint}</p></div><div className={styles.actions}><Link className="tl-button tl-button--quiet" href={`/app/projects/${collection.projectId}?workspace=${workspaceId}&collectionId=${collection.id}`}>{t.use}</Link>{result.canEdit&&data&&data.total>0&&<Button variant="primary" icon={FileSpreadsheet} disabled={data.total*fields.length>1000} pending={busy} onClick={()=>{void makeSheet();}}>{t.makeSheet}</Button>}</div></div>
    {data&&data.total*fields.length>1000&&<p className={styles.notice}>{t.sheetLimit}</p>}
    {!result.canEdit&&<p className={styles.notice}>{t.readonly}</p>}
    {result.canEdit&&<div className={styles.filters}><Combobox label={t.chooseSource} value={null} loadOptions={loadSources} onChange={(value)=>{const item=value?sources.current.get(value.id):undefined;if(item?.currentVersionId)setSource({sourceId:item.id,sourceVersionId:item.currentVersionId});}}/><div className={styles.actions}><Link className="tl-button tl-button--secondary" href={`/app/materials/add?workspaceId=${workspaceId}&projectId=${collection.projectId}${result.imports?.[0]?`&sourceId=${result.imports[0].sourceRef.sourceId}`:''}`}>{t.reimport}</Link></div></div>}
    {result.imports?.filter((item)=>item.status==='preparing'||item.status==='preview').map((item)=><div className={styles.notice} key={item.id}><div className={styles.actions}><span>{t.continueImport}: {item.counts.total}</span><Button onClick={()=>setImportId(item.id)}>{t.continueImport}</Button></div></div>)}
    <MaterialError error={error}/>
    <Tabs label={collection.title} value={tab} onChange={(value)=>{setTab(value);setSelected(undefined);}} items={[
      {id:'records',label:t.records,content:<div className={styles.stack}>
        <details className={styles.panel}><summary>{t.fieldIncluded}</summary><div className={styles.keyFields}>{allFields.map((field)=><CheckboxField key={field.id} label={field.label} checked={fields.some((visible)=>visible.id===field.id)} disabled={fields.length===1&&fields[0]?.id===field.id} onChange={(event)=>{setSelectedFieldIds(event.target.checked?[...fields.map((visible)=>visible.id),field.id]:fields.filter((visible)=>visible.id!==field.id).map((visible)=>visible.id));setAfter(undefined);}}/>)}</div></details>
        <div className={styles.filters}><InputField label={t.search} type="search" maxLength={120} value={query} onChange={(event)=>{setQuery(event.target.value);setAfter(undefined);}}/><SelectField label={t.label} value={filterField} onChange={(event)=>{setFilterField(event.target.value);setFilterValue('');setFacet(undefined);setFilterOp(allFields.find((field)=>field.id===event.target.value)?.kind==='text'?'contains':'eq');setAfter(undefined);}}><option value="">{t.all}</option>{fields.map((field)=><option key={field.id} value={field.id}>{field.label}</option>)}</SelectField>{filterField&&<SelectField label={t.value} value={filterOp} onChange={(event)=>{setFilterOp(event.target.value as typeof filterOp);setAfter(undefined);}}>{filterDefinition?.kind==='text'&&<option value="contains">{t.search}</option>}<option value="eq">=</option><option value="gt">&gt;</option><option value="lt">&lt;</option><option value="unknown">{t.unknown}</option></SelectField>}{filterField&&filterOp!=='unknown'&&<><InputField label={t.value} list={`material-facets-${collection.id}`} value={filterValue} maxLength={1000} onChange={(event)=>{setFilterValue(event.target.value);setAfter(undefined);}}/><datalist id={`material-facets-${collection.id}`}>{facet?.values.flatMap((item)=>{const value=item.value&&materialFilterValue(item.value);return value===null||value===undefined?[]:[<option key={item.key} value={value}>{item.count}</option>];})}</datalist></>}</div>
        {facet&&<p className={styles.meta}>{t.coverage}: {facet.coverage.included}/{facet.coverage.total}. {t.excluded}: {facet.coverage.excluded}.</p>}
        {revision!==undefined&&<div className={styles.notice}><div className={styles.actions}><span>{t.revision}: {revision}</span><Button onClick={()=>{setRevision(undefined);setAfter(undefined);}}>{t.latest}</Button></div></div>}
        {data?.records.length?<div className={styles.scroll}><table className={styles.table}><thead><tr><th>{t.records}</th>{fields.map((field)=><th key={field.id}>{field.label}</th>)}</tr></thead><tbody>{data.records.map((record)=><tr key={record.recordId}><th scope="row">{record.label}</th>{fields.map((field)=>{const cell=record.cells[field.id];return <td key={field.id}>{cell?<button type="button" className={styles.fact} onClick={()=>{setSelected({record,fieldId:field.id,cell});setRaw(cell.rawValue);setReason('');setCorrection(undefined);}}><span>{valueText(cell.value,t.unknown)}</span>{cell.reviewState==='needs-review'&&<p className={styles.meta}>{t.reviewNeeded}</p>}</button>:t.unknown}</td>;})}</tr>)}</tbody></table></div>:!loading&&<p className={styles.empty}>{collection.recordCount?t.noResults:t.noRecords}</p>}
        <div className={styles.footer}><span className={styles.meta}>{t.total}: {data?.total??0}</span><div className={styles.actions}>{after&&<Button onClick={()=>setAfter(undefined)}>{t.reset}</Button>}{data?.nextCursor&&<Button disabled={busy} onClick={()=>setAfter(data.nextCursor!)}>{t.more}</Button>}</div></div>
      </div>},
      {id:'history',label:t.history,content:<ul className={styles.list}>{history?.resolutions.map((entry)=><li className={styles.listItem} key={entry.id}><div><h2>{entry.kind==='import'?t.import:entry.kind==='correction'?t.correctionKind:t.undoKind} / {t.revision} {entry.revision}</h2><p>{entry.reason}</p><time className={styles.meta} dateTime={entry.createdAt}>{dateTime.format(new Date(entry.createdAt))}</time></div><div className={styles.actions}><Button onClick={()=>{setRevision(entry.revision);setAfter(undefined);setTab('records');}}>{t.open}</Button>{entry.canUndo&&<Button onClick={()=>setUndoId(entry.id)}>{t.undo}</Button>}</div></li>)}{history?.nextBeforeRevision&&<li className={styles.listItem}><Button pending={busy} onClick={()=>{setBusy(true);void run((signal)=>materialClient.history(workspaceId,collection.id,history.nextBeforeRevision!,{userId:ownerId,signal})).then((next)=>setHistory({...next,resolutions:[...history.resolutions,...next.resolutions]})).catch(setError).finally(()=>setBusy(false));}}>{t.more}</Button></li>}</ul>},
    ]}/>
    <div className={styles.footer}><span role="status">{busy||loading?t.loading:''}</span><Button icon={RefreshCw} disabled={busy||loading} onClick={()=>setRefresh((old)=>old+1)}>{t.reload}</Button></div>
    <Dialog open={Boolean(selected)} onOpenChange={(open)=>{if(!open&&!busy){setSelected(undefined);setCorrection(undefined);}}} title={selected?`${selected.record.label}: ${fields.find((field)=>field.id===selected.fieldId)?.label??''}`:t.value} footer={<Button disabled={busy} onClick={()=>{setSelected(undefined);setCorrection(undefined);}}>{t.close}</Button>}>
      {selected&&<div className={styles.stack}><dl className={styles.counts}><div><dt>{t.value}</dt><dd>{valueText(selected.cell.value,t.unknown)}</dd></div><div><dt>{t.original}</dt><dd>{selected.cell.sourceRawValue??selected.cell.rawValue}</dd></div><div><dt>{t.row}</dt><dd>{selected.cell.lineage.row??selected.cell.lineage.page??selected.cell.lineage.fragmentId}</dd></div></dl><Link href={`/app/materials/sources/${selected.cell.sourceRef.sourceId}?workspaceId=${workspaceId}&sourceVersionId=${selected.cell.sourceRef.sourceVersionId}`}>{t.useFact}</Link>
        {result.canEdit&&revision===undefined&&<><InputField label={t.value} value={raw} maxLength={16000} onChange={(event)=>{setRaw(event.target.value);setCorrection(undefined);}}/><TextareaField label={t.reason} value={reason} maxLength={1000} onChange={(event)=>{setReason(event.target.value);setCorrection(undefined);}}/>{correction?<div className={styles.notice}><p>{t.before}: {valueText(correction.changes[0]!.before.value,t.unknown)}</p><p>{t.after}: {valueText(correction.changes[0]!.after.value,t.unknown)}</p><Button variant="primary" pending={busy} onClick={()=>{void saveCorrection();}}>{t.saveCorrection}</Button></div>:<Button disabled={!reason.trim()} pending={busy} onClick={()=>{void previewCorrection();}}>{t.preview}</Button>}<MaterialError error={error}/></>}
      </div>}
    </Dialog>
    <Dialog open={Boolean(undoId)} onOpenChange={(open)=>{if(!open&&!busy)setUndoId(undefined);}} title={t.undo} description={t.linkedHint} footer={<><Button disabled={busy} onClick={()=>setUndoId(undefined)}>{t.close}</Button><Button variant="primary" pending={busy} onClick={()=>{void undo();}}>{t.undo}</Button></>}>{null}</Dialog>
    {navigation.confirmation}
  </main></WorkspaceShell>;
}



