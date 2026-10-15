'use client';
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sourceClient } from '@/features/sources/client/transport';
import styles from './materials.module.css';

export function SourceThumbnail({workspaceId,uploadId,ownerId,title,run}:{workspaceId:string;uploadId:string;ownerId:string;title:string;run:<T>(action:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal)=>Promise<T>}){
  const target=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[url,setUrl]=useState<string>();
  useEffect(()=>{
    if(!target.current)return;
    const observer=new IntersectionObserver((entries)=>{if(entries.some((entry)=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'120px'});
    observer.observe(target.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!visible)return;
    const controller=new AbortController();let objectUrl:string|undefined;
    void run((signal)=>sourceClient.thumbnail(workspaceId,uploadId,{userId:ownerId,signal}),controller.signal).then((blob)=>{if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(()=>undefined);
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[visible,workspaceId,uploadId,ownerId,run]);
  return <div ref={target} className={styles.thumbnail}>{url?<Image src={url} alt={title} fill unoptimized sizes="80px"/>:<ImageIcon size={24} aria-hidden="true"/>}</div>;
}
