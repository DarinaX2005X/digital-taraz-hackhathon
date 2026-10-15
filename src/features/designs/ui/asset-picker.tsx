'use client';
import { useEffect, useState } from 'react';
import { sourceClient } from '@/features/sources/client/transport';
import type { SourceVisualAsset } from '@/contracts/sources';
import { Dialog } from '@/ui/dialog';
import { Button } from '@/ui/button';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { DesignMessages } from '../locales';
import styles from './design-editor.module.css';

export type PickedDesignAsset = SourceVisualAsset;
export function AssetPicker({kind,snapshot,t,onClose,onPick}:{kind:'image'|'font';snapshot:ArtifactSnapshot;t:DesignMessages;onClose():void;onPick(asset:PickedDesignAsset):void}) {
  const [items,setItems]=useState<PickedDesignAsset[]>([]),[cursor,setCursor]=useState<string|null>(null),[after,setAfter]=useState<string|undefined>(),[loading,setLoading]=useState(true),[error,setError]=useState(false);
  useEffect(()=>{const abort=new AbortController();
    void sourceClient.listAssets({workspaceId:snapshot.artifact.workspaceId,projectId:snapshot.artifact.projectId,kind,limit:30,after},{userId:snapshot.viewer.userId,signal:abort.signal}).then((page)=>{if(!abort.signal.aborted){setItems((current)=>after?[...current,...page.items]:page.items);setCursor(page.nextCursor);setLoading(false);setError(false);}}).catch(()=>{if(!abort.signal.aborted){setError(true);setLoading(false);}});
    return()=>abort.abort();
  },[kind,snapshot.artifact.workspaceId,snapshot.artifact.projectId,snapshot.viewer.userId,after]);
  return <Dialog open onOpenChange={(open)=>{if(!open)onClose();}} title={t.assets}>
    {loading&&<p role="status">{t.loading}</p>}{error&&<p role="alert">{t.assetError}</p>}
    {!loading&&!error&&!items.length&&<p>{t.assetEmpty}</p>}
    <ul className={styles.assetList}>{items.map((asset)=><li key={asset.id}><div><strong>{asset.name}</strong><span>{asset.width&&asset.height?`${asset.width} × ${asset.height}`:asset.mediaType}</span></div><Button onClick={()=>onPick(asset)}>{t.choose}</Button></li>)}</ul>
    {cursor&&<Button disabled={loading} onClick={()=>{setLoading(true);setAfter(cursor);}}>{t.next}</Button>}
    <a href={`/app/projects/${snapshot.artifact.projectId}`}>{t.sources}</a>
  </Dialog>;
}
