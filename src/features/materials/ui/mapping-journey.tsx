'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, CheckboxField, InputField, SelectField } from '@/ui';
import { ImportMappingSchema, MaterialFieldSchema, type ImportMapping, type MaterialCollection, type MaterialField, type MaterialImport, type MaterialSourcePreview } from '@/contracts/materials';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { useIdentityNavigationGuard } from '@/features/identity/ui/navigation-guard';
import { materialClient } from '../client/transport';
import { MaterialError, useMaterialCopy } from './common';
import { ImportReview } from './import-review';
import { reconcileColumns } from '../domain/remapping';
import styles from './materials.module.css';

export function MappingJourney({ ownerId, workspaceId, source, existing, resumed, onBack }: { ownerId:string; workspaceId:string; source:{sourceId:string;sourceVersionId:string}; existing?:MaterialCollection; resumed?:MaterialImport; onBack:()=>void }) {
  const t = useMaterialCopy(), access = useWorkspaceAccess(ownerId), { run } = access;
  const [preview,setPreview] = useState<MaterialSourcePreview>(), [fields,setFields] = useState<MaterialField[]>([]), [title,setTitle] = useState(existing?.title ?? ''), [sheet,setSheet] = useState<string | null>(null), [headerRow,setHeaderRow] = useState(1);
  const [keyIds,setKeyIds] = useState<string[]>([]), [fingerprint,setFingerprint] = useState(false), [keyConfirmed,setKeyConfirmed] = useState(false), [trim,setTrim] = useState(true), [caseSensitive,setCaseSensitive] = useState(false), [mode,setMode] = useState<ImportMapping['importMode']>('upsert');
  const [omitted,setOmitted] = useState<string[]>([]);
  const [collection,setCollection] = useState(existing), [candidates,setCandidates] = useState<MaterialCollection[]>([]), [collectionId,setCollectionId] = useState(existing?.id ?? ''), [kind,setKind] = useState<MaterialCollection['kind']>('general');
  const [item,setItem] = useState(resumed), [error,setError] = useState<unknown>(), [busy,setBusy] = useState(false), [refresh,setRefresh] = useState(0);
  const operations = useRef(new Map<string,{body:string;key:string}>());
  const navigation = useIdentityNavigationGuard(!item && Boolean(preview));
  const selected = collection ?? candidates.find((entry) => entry.id === collectionId);
  const headers = headerRow > 0 ? preview?.chunk.fragments.find((entry) => entry.row === headerRow && (sheet === null || entry.sheet === sheet))?.values ?? [] : [];
  function setMapping(mapping:ImportMapping,data:MaterialSourcePreview) { const selectedSheet=mapping.sheet!==null&&data.manifest.sheets.includes(mapping.sheet)?mapping.sheet:data.manifest.sheets[0]??null;setSheet(selectedSheet); setHeaderRow(mapping.headerRow); setMode(mapping.importMode);setOmitted([]);infer(data,selectedSheet,mapping.headerRow,mapping); }
  function infer(data:MaterialSourcePreview, selectedSheet:string|null, row:number, previous=selected?.mapping) {
    const fragments = data.chunk.fragments.filter((entry) => selectedSheet === null || entry.sheet === selectedSheet), header = row > 0 ? fragments.find((entry) => entry.row === row)?.values ?? [] : [];
    if (previous) {
      const mapping = previous;
      setFields(reconcileColumns(mapping,row>0?header:null).fields);
      setFingerprint(mapping.recordKeySpec.kind === 'fingerprint');
      if (mapping.recordKeySpec.kind === 'fields') { setKeyIds(mapping.recordKeySpec.fieldIds); setTrim(mapping.recordKeySpec.trim); setCaseSensitive(mapping.recordKeySpec.caseSensitive); }
      setKeyConfirmed(false); return;
    }
    const count = Math.max(header.length,...fragments.slice(0,20).map((entry) => entry.values?.length ?? 1));
    setFields(Array.from({length:count},(_,column)=>MaterialFieldSchema.parse({id:`field_${column+1}`,label:header[column]?.trim() || `${t.value} ${column+1}`,column,header:header[column]??null,kind:'text'})));
    setKeyIds([]);setKeyConfirmed(false);
  }
  useEffect(()=>{
    if(access.phase!=='active')return;
    const controller=new AbortController();
    void run((signal)=>materialClient.source({workspaceId,...source},{userId:ownerId,signal}),controller.signal).then(async(data)=>{
      setPreview(data);setTitle((old)=>old||data.title);
      if(existing?.mapping){const mapping=existing.mapping,selectedSheet=mapping.sheet!==null&&data.manifest.sheets.includes(mapping.sheet)?mapping.sheet:data.manifest.sheets[0]??null;let sample=data;if(!data.chunk.fragments.some((entry)=>(selectedSheet===null||entry.sheet===selectedSheet)&&(mapping.headerRow===0||entry.row===mapping.headerRow))){try{sample=await run((signal)=>materialClient.source({workspaceId,...source,sheet:selectedSheet??undefined,row:mapping.headerRow},{userId:ownerId,signal}),controller.signal);setPreview(sample);}catch(failure){if(controller.signal.aborted)throw failure;setError(t.remapRequired);}}setMapping(mapping,sample);}else if(!resumed){const initialSheet=data.manifest.sheets[0]??null;const row=['csv','tsv','xlsx'].includes(data.manifest.format)&&data.chunk.fragments.some((entry)=>entry.values)?1:0;setSheet(initialSheet);setHeaderRow(row);infer(data,initialSheet,row);}
      const result=await run((signal)=>materialClient.list({workspaceId,projectId:data.projectId,limit:50},{userId:ownerId,signal}),controller.signal);setCandidates(result.collections);
    }).catch((failure)=>{if(!controller.signal.aborted)setError(failure);});
    return()=>controller.abort();
    // Initial inference is tied to the pinned file. Field edits never trigger another fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[workspaceId,source.sourceId,source.sourceVersionId,ownerId,access.phase,run,refresh]);
  function operation(name:string,body:unknown){const serialized=JSON.stringify(body);if(operations.current.get(name)?.body!==serialized)operations.current.set(name,{body:serialized,key:crypto.randomUUID()});return operations.current.get(name)!.key;}
  async function begin(){
    if(!preview||busy)return;setError(undefined);
    if(fields.some((field)=>field.column<0&&!omitted.includes(field.id))){setError(t.remapRequired);return;}
    const mapping=ImportMappingSchema.safeParse({fields:fields.filter((field)=>!omitted.includes(field.id)).map((field)=>({...field,header:headerRow>0?headers[field.column]??null:null})),sheet,headerRow,headers,importMode:mode,recordKeySpec:fingerprint?{kind:'fingerprint',confirmed:true}:{kind:'fields',fieldIds:keyIds,trim,caseSensitive,confirmed:true}});
    if(!mapping.success||!keyConfirmed||!title.trim()){setError(t.invalid);return;}setBusy(true);
    try{
      let target=selected;
      if(!target){const input={workspaceId,projectId:preview.projectId,title,kind,accessClass:preview.accessClass,expectedAuthzVersion:preview.viewer.authzVersion};target=(await run((signal)=>materialClient.create(input,operation('create',input),{userId:ownerId,signal}))).collection;setCollection(target);}
      const input={workspaceId,collectionId:target.id,sourceId:source.sourceId,sourceVersionId:source.sourceVersionId,mapping:mapping.data,expectedRevision:target.revision,expectedAuthzVersion:preview.viewer.authzVersion};
      const result=await run((signal)=>materialClient.begin(input,operation('begin',input),{userId:ownerId,signal}));setItem(result.import);setCollection(target);
    }catch(failure){setError(failure);}finally{setBusy(false);}
  }
  async function loadSample(nextSheet:string|null,nextRow:number){
    setBusy(true);setError(undefined);
    try{const data=await run((signal)=>materialClient.source({workspaceId,...source,sheet:nextSheet??undefined,row:nextRow},{userId:ownerId,signal}));setPreview(data);infer(data,nextSheet,nextRow);}catch(failure){setError(failure);}finally{setBusy(false);}
  }
  const update=(id:string,patch:Partial<MaterialField>)=>setFields((old)=>old.map((field)=>field.id===id?{...field,...patch}:field));
  if(access.phase!=='active')return <WorkspaceShell workspaceId={workspaceId}><WorkspaceAccessState access={access} returnTo={`/app/materials?workspaceId=${workspaceId}&sourceId=${source.sourceId}&sourceVersionId=${source.sourceVersionId}`} /></WorkspaceShell>;
  if(item&&selected)return <ImportReview ownerId={ownerId} workspaceId={workspaceId} collection={selected} initialImport={item} onBack={onBack} />;
  return <WorkspaceShell workspaceId={workspaceId} onClickCapture={navigation.onClickCapture}><main className={styles.main}>
    <Link className={styles.back} href={`/app/materials?workspaceId=${workspaceId}`}><ArrowLeft size={18} aria-hidden="true"/>{t.back}</Link>
    <div className={styles.heading}><div><h1>{t.mapping}</h1><p>{t.mappingHint}</p></div>{preview&&<Link href={`/app/projects/${preview.projectId}?workspace=${workspaceId}&sourceId=${source.sourceId}&sourceVersionId=${source.sourceVersionId}`} className="tl-button tl-button--quiet">{t.use}</Link>}</div>
    <MaterialError error={error}/>
    {!preview?<Button pending={!error} onClick={()=>setRefresh((value)=>value+1)}>{error?t.retry:t.loading}</Button>:<div className={styles.mapping}>
      <div className={styles.stack}>
        <div className={styles.panel}><h2>{preview.title}</h2><div className={styles.fieldRow}>
          {preview.manifest.sheets.length>0&&<SelectField label={t.sheet} value={sheet??''} disabled={busy} onChange={(event)=>{setSheet(event.target.value);void loadSample(event.target.value,headerRow);}}>{preview.manifest.sheets.map((name)=><option value={name} key={name}>{name}</option>)}</SelectField>}
          <InputField label={t.headerRow} hint={`${t.noHeader}: 0`} type="number" min={0} max={100000} value={headerRow} disabled={busy} onChange={(event)=>{setHeaderRow(Number(event.target.value));setKeyConfirmed(false);}} onBlur={()=>{void loadSample(sheet,headerRow);}}/>
        </div><div className={styles.scroll}><table className={styles.table}><caption>{t.sample}</caption><tbody>{preview.chunk.fragments.filter((entry)=>sheet===null||entry.sheet===sheet).slice(0,8).map((entry)=><tr key={entry.id}><th scope="row">{entry.row??entry.page??''}</th>{(entry.values??[entry.text??'']).map((value,index)=><td key={index}>{value}</td>)}</tr>)}</tbody></table></div></div>
        <div className={styles.panel}>{fields.map((field)=><div className={styles.field} key={field.id}><CheckboxField label={t.fieldIncluded} checked={!omitted.includes(field.id)} disabled={Boolean(selected?.mapping?.recordKeySpec.kind==='fields'&&selected.mapping.recordKeySpec.fieldIds.includes(field.id))} onChange={(event)=>{setOmitted((old)=>event.target.checked?old.filter((id)=>id!==field.id):[...old,field.id]);setKeyConfirmed(false);}}/><div className={styles.fieldRow}><InputField label={field.column>=0?`${t.label} ${field.column+1}`:t.label} value={field.label} maxLength={160} onChange={(event)=>update(field.id,{label:event.target.value})}/><SelectField label={t.type} value={field.kind} disabled={Boolean(selected?.mapping?.fields.some((item)=>item.id===field.id))} onChange={(event)=>update(field.id,{kind:event.target.value as MaterialField['kind']})}><option value="text">{t.text}</option><option value="decimal">{t.number}</option><option value="money">{t.money}</option><option value="quantity">{t.quantity}</option><option value="date">{t.dateType}</option></SelectField><SelectField label={t.original} error={field.column<0&&!omitted.includes(field.id)?t.remapRequired:undefined} value={field.column} onChange={(event)=>{update(field.id,{column:Number(event.target.value)});setKeyConfirmed(false);}}><option value={-1} disabled>{t.chooseColumn}</option>{Array.from({length:Math.max(headers.length,...preview.chunk.fragments.slice(0,20).map((entry)=>entry.values?.length??1))},(_,column)=><option key={column} value={column}>{headers[column]||`${t.value} ${column+1}`}</option>)}</SelectField></div>
          {['money','decimal','quantity'].includes(field.kind)&&<div className={styles.fieldRow}><SelectField label={t.decimal} value={field.decimalSeparator} onChange={(event)=>update(field.id,{decimalSeparator:event.target.value as '.'|','})}><option value=".">.</option><option value=",">,</option></SelectField><SelectField label={t.group} value={field.groupSeparator} onChange={(event)=>update(field.id,{groupSeparator:event.target.value as MaterialField['groupSeparator']})}><option value="none">{t.none}</option><option value="space">{t.space}</option><option value=".">.</option><option value=",">,</option></SelectField><SelectField label={t.negative} value={field.adjustmentReason??''} onChange={(event)=>update(field.id,{adjustmentReason:event.target.value?event.target.value as 'return'|'correction':undefined})}><option value="">{t.forbidden}</option><option value="return">{t.return}</option><option value="correction">{t.correction}</option></SelectField></div>}
          {field.kind==='money'&&<SelectField label={t.currency} value={field.currency} disabled={Boolean(selected?.mapping)} onChange={(event)=>update(field.id,{currency:event.target.value})}>{['KZT','USD','EUR','RUB','GBP','CNY','JPY','UZS','KGS'].map((value)=><option key={value}>{value}</option>)}</SelectField>}
          {field.kind==='quantity'&&<div className={styles.fieldRow}><InputField label={t.sourceUnit} value={field.sourceUnit} maxLength={40} onChange={(event)=>update(field.id,{sourceUnit:event.target.value})}/><InputField label={t.unit} value={field.unit} disabled={Boolean(selected?.mapping)} maxLength={40} onChange={(event)=>update(field.id,{unit:event.target.value})}/></div>}
          {field.kind==='date'&&<SelectField label={t.date} value={field.dateFormat} onChange={(event)=>update(field.id,{dateFormat:event.target.value as MaterialField['dateFormat']})}>{['YYYY-MM-DD','DD.MM.YYYY','DD/MM/YYYY','MM/DD/YYYY'].map((value)=><option key={value}>{value}</option>)}</SelectField>}
        </div>)}</div>
      </div>
      <aside className={`${styles.panel} ${styles.pinned}`}>
        {!existing&&<SelectField label={t.selecting} value={collectionId} disabled={Boolean(collection)||busy} onChange={(event)=>{setCollectionId(event.target.value);const target=candidates.find((item)=>item.id===event.target.value);if(target?.mapping){setMapping(target.mapping,preview);setTitle(target.title);}else infer(preview,sheet,headerRow,null);}}><option value="">{t.newCollection}</option>{candidates.map((entry)=><option key={entry.id} value={entry.id}>{entry.title}</option>)}</SelectField>}
        <InputField label={t.title} value={title} disabled={Boolean(selected)||busy} required maxLength={240} onChange={(event)=>setTitle(event.target.value)}/>
        {!selected&&<SelectField label={t.kind} value={kind} onChange={(event)=>setKind(event.target.value as MaterialCollection['kind'])}>{(['catalog','prices','history','brand','general'] as const).map((item)=><option key={item} value={item}>{item==='history'?t.historyKind:t[item]}</option>)}</SelectField>}
        <h2>{t.key}</h2><p className={styles.meta}>{t.keyHint}</p>
        <CheckboxField label={t.fingerprint} hint={t.fingerprintHint} checked={fingerprint} disabled={Boolean(selected?.mapping)} onChange={(event)=>{setFingerprint(event.target.checked);setKeyConfirmed(false);}}/>
        {!fingerprint&&<div className={styles.keyFields}>{fields.map((field)=><CheckboxField key={field.id} label={field.label} checked={keyIds.includes(field.id)} disabled={Boolean(selected?.mapping)} onChange={(event)=>{setKeyIds((old)=>event.target.checked?[...old,field.id]:old.filter((id)=>id!==field.id));setKeyConfirmed(false);}}/>)}<CheckboxField label={t.trim} checked={trim} disabled={Boolean(selected?.mapping)} onChange={(event)=>setTrim(event.target.checked)}/><CheckboxField label={t.caseSensitive} checked={caseSensitive} disabled={Boolean(selected?.mapping)} onChange={(event)=>setCaseSensitive(event.target.checked)}/></div>}
        <CheckboxField label={t.confirmKey} checked={keyConfirmed} onChange={(event)=>setKeyConfirmed(event.target.checked)}/>
        <SelectField label={t.mode} value={mode} onChange={(event)=>setMode(event.target.value as ImportMapping['importMode'])}><option value="upsert">{t.upsert}</option><option value="append">{t.append}</option><option value="replace-snapshot">{t.replace}</option></SelectField>
        <Button variant="primary" pending={busy} onClick={()=>{void begin();}}>{t.create}</Button>
      </aside>
    </div>}{navigation.confirmation}
  </main></WorkspaceShell>;
}




