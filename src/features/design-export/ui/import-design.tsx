'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { FileUp } from 'lucide-react';
import { useLocale } from '@/i18n/provider';
import { Dialog } from '@/ui/dialog';
import { Button } from '@/ui/button';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import styles from '@/features/designs/ui/design-editor.module.css';

const copy={
  ru:{open:'Открыть .tirlik',title:'Импорт макета',file:'Редактируемый проект .tirlik',preview:'Проверить файл',import:'Импортировать',retry:'Повторить импорт',rights:'У меня есть право использовать вложенные изображения и шрифты.',preserve:'Сохранить связи с доступными источниками',detach:'Создать самостоятельную копию без связей с источниками',unavailable:'Часть исходных источников недоступна. Можно импортировать самостоятельную копию; текст и изображения сохранятся.',error:'Файл не удалось обработать. Проверьте формат, права на материалы и повторите.',uncertain:'Ответ на импорт не получен. Повторите запрос, чтобы узнать результат без создания второй копии.',pages:'Страниц',assets:'Изображений и шрифтов',locks:'Закреплённых элементов',sources:'Источников',warnings:'Замечания к содержимому',cancel:'Отмена'},
  en:{open:'Open .tirlik',title:'Import design',file:'Editable .tirlik project',preview:'Check file',import:'Import',retry:'Retry import',rights:'I have permission to use the included images and fonts.',preserve:'Keep links to accessible sources',detach:'Create an independent copy without source links',unavailable:'Some original sources are unavailable. You can import an independent copy; text and images will be kept.',error:'Could not process the file. Check its format and asset permissions, then retry.',uncertain:'The import response was not received. Retry the same request to recover the result without creating a second copy.',pages:'Pages',assets:'Images and fonts',locks:'Locked elements',sources:'Sources',warnings:'Content warnings',cancel:'Cancel'},
  kk:{open:'.tirlik ашу',title:'Макетті импорттау',file:'Өңделетін .tirlik жобасы',preview:'Файлды тексеру',import:'Импорттау',retry:'Импортты қайталау',rights:'Қоса берілген суреттер мен қаріптерді пайдалануға құқығым бар.',preserve:'Қолжетімді дереккөздермен байланысты сақтау',detach:'Дереккөздермен байланыссыз дербес көшірме жасау',unavailable:'Кейбір бастапқы дереккөздер қолжетімсіз. Дербес көшірмені импорттауға болады; мәтін мен суреттер сақталады.',error:'Файл өңделмеді. Пішімін және материалдарға құқықтарды тексеріп, қайталаңыз.',uncertain:'Импорт жауабы алынбады. Екінші көшірме жасамай нәтижені алу үшін сол сұрауды қайталаңыз.',pages:'Беттер',assets:'Суреттер мен қаріптер',locks:'Бекітілген элементтер',sources:'Дереккөздер',warnings:'Мазмұн ескертулері',cancel:'Болдырмау'},
};
const Preview=z.object({previewHash:z.string().length(64),title:z.string(),pageCount:z.number().int(),assets:z.array(z.object({name:z.string(),kind:z.enum(['image','font']),license:z.string()})),sourceCount:z.number().int(),canPreserveSources:z.boolean(),lockCount:z.number().int(),historicalDraftLabel:z.string().max(300).optional(),warnings:z.array(z.string())});
const Result=z.object({artifactId:z.uuid(),projectId:z.uuid(),revision:z.number().int(),detachedSources:z.number().int()});
export function ImportDesignButton({snapshot,beforeOpen,disabled}:{snapshot:ArtifactSnapshot;beforeOpen():Promise<boolean>;disabled?:boolean}){
  const {locale}=useLocale(),t=copy[locale],router=useRouter();const [open,setOpen]=useState(false),[dialogIdentity,setDialogIdentity]=useState(''),[file,setFile]=useState<File>(),[preview,setPreview]=useState<z.infer<typeof Preview>>(),[rights,setRights]=useState(false),[policy,setPolicy]=useState<'preserve'|'detach'>('preserve'),[busy,setBusy]=useState(false),[error,setError]=useState(false),[uncertain,setUncertain]=useState(false);const operationId=useRef(''),requestEpoch=useRef(0),activeRequest=useRef<AbortController|undefined>(undefined);
  const identityKey=`${snapshot.viewer.userId}:${snapshot.artifact.workspaceId}:${snapshot.artifact.projectId}:${snapshot.viewer.authzVersion}`,identityRef=useRef(identityKey);
  const locked=busy||uncertain;
  useEffect(()=>{identityRef.current=identityKey;requestEpoch.current+=1;activeRequest.current?.abort();activeRequest.current=undefined;},[identityKey]);
  useEffect(()=>()=>{requestEpoch.current+=1;activeRequest.current?.abort();},[]);
  function abandonRequest(){requestEpoch.current+=1;activeRequest.current?.abort();activeRequest.current=undefined;setBusy(false);}
  function changeOpen(next:boolean){if(!next)abandonRequest();setOpen(next);}
  async function beginOpen(){
    abandonRequest();identityRef.current=identityKey;const epoch=requestEpoch.current,identity=identityKey,saved=await beforeOpen();
    if(!saved||epoch!==requestEpoch.current||identity!==identityRef.current)return;
    operationId.current=crypto.randomUUID();setDialogIdentity(identity);setFile(undefined);setPreview(undefined);setRights(false);setPolicy('preserve');setError(false);setUncertain(false);setOpen(true);
  }
  async function request(action:'preview'|'import'){
    if(!file)return;abandonRequest();const epoch=requestEpoch.current,identity=identityRef.current,controller=new AbortController();activeRequest.current=controller;setBusy(true);setError(false);let deterministicFailure=false;const timeout=window.setTimeout(()=>controller.abort(),120000);
    try{
      const query=new URLSearchParams({workspaceId:snapshot.artifact.workspaceId,projectId:snapshot.artifact.projectId,expectedAuthzVersion:String(snapshot.viewer.authzVersion),action,sourcePolicy:policy,confirmRights:String(rights),...(preview?{previewHash:preview.previewHash}:{})});
      const response=await fetch(`/api/designs/import?${query}`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/vnd.tirlik.design+zip','X-Tirlik-User-Id':snapshot.viewer.userId,'Idempotency-Key':operationId.current},body:file,signal:controller.signal});
      if(!response.ok){deterministicFailure=response.status<500;throw new Error('import');}
      if(epoch!==requestEpoch.current||identity!==identityRef.current)return;
      if(action==='preview'){const value=Preview.parse(await response.json());if(epoch!==requestEpoch.current||identity!==identityRef.current)return;setPreview(value);setUncertain(false);if(!value.canPreserveSources)setPolicy('detach');}
      else {const value=Result.parse(await response.json());if(epoch!==requestEpoch.current||identity!==identityRef.current)return;setUncertain(false);setOpen(false);router.push(`/app/projects/${value.projectId}/artifacts/${value.artifactId}`);}
    }catch{if(epoch===requestEpoch.current&&identity===identityRef.current){setError(true);setUncertain(action==='import'&&!deterministicFailure);}}finally{window.clearTimeout(timeout);if(epoch===requestEpoch.current&&identity===identityRef.current){activeRequest.current=undefined;setBusy(false);}}
  }
  return <><Button icon={FileUp} disabled={disabled} onClick={()=>void beginOpen()}>{t.open}</Button>
    <Dialog open={open&&dialogIdentity===identityKey} onOpenChange={changeOpen} title={t.title} dismissible={!locked} footer={<><Button disabled={locked} onClick={()=>changeOpen(false)}>{t.cancel}</Button>{!preview?<Button variant="primary" disabled={!file} pending={busy} onClick={()=>void request('preview')}>{t.preview}</Button>:<Button variant="primary" disabled={!rights||policy==='preserve'&&!preview.canPreserveSources} pending={busy} onClick={()=>void request('import')}>{uncertain?t.retry:t.import}</Button>}</>}>
      <label className={styles.field}>{t.file}<input type="file" accept=".tirlik,application/vnd.tirlik.design+zip" disabled={locked} onChange={(event)=>{abandonRequest();const next=event.target.files?.[0];setFile(next&&next.size<=60*1024*1024?next:undefined);setError(!!next&&next.size>60*1024*1024);setUncertain(false);setPreview(undefined);operationId.current=crypto.randomUUID();}}/></label>
      {preview&&<><h3>{preview.title}</h3>{preview.historicalDraftLabel&&<p>{preview.historicalDraftLabel}</p>}<p>{t.pages}: {preview.pageCount} · {t.assets}: {preview.assets.length} · {t.locks}: {preview.lockCount} · {t.sources}: {preview.sourceCount}</p><ul>{preview.assets.map((asset)=><li key={asset.name}>{asset.name} — {asset.license}</li>)}</ul>{preview.sourceCount>0&&<>{!preview.canPreserveSources&&<p>{t.unavailable}</p>}<label className={styles.checkbox}><input type="radio" name="design-source-policy" checked={policy==='preserve'} disabled={locked||!preview.canPreserveSources} onChange={()=>setPolicy('preserve')}/>{t.preserve}</label><label className={styles.checkbox}><input type="radio" name="design-source-policy" checked={policy==='detach'} disabled={locked} onChange={()=>setPolicy('detach')}/>{t.detach}</label></>}{preview.warnings.length>0&&<p>{t.warnings}: {preview.warnings.length}</p>}<label className={styles.checkbox}><input type="checkbox" checked={rights} disabled={locked} onChange={(event)=>setRights(event.target.checked)}/>{t.rights}</label></>}
      {error&&<p role="alert">{uncertain?t.uncertain:t.error}</p>}
    </Dialog>
  </>;
}
