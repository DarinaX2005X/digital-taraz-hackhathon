import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { createCollectionService } from '@/features/materials/server/collections';
import { createImportService } from '@/features/materials/server/imports';
import { MaterialCollectionPage } from '@/features/materials/ui/collection-page';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{collectionId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {collectionId}=await params,query=await searchParams;
  if(!IdSchema.safeParse(collectionId).success||!IdSchema.safeParse(query.workspaceId).success||(query.importId!==undefined&&!IdSchema.safeParse(query.importId).success))notFound();
  const workspaceId=query.workspaceId as string,importId=query.importId as string|undefined;
  const returnTo=`/app/materials/collections/${collectionId}?workspaceId=${workspaceId}${importId?`&importId=${importId}`:''}`;
  const load=async()=>{try{
    const actor=await getIdentityHandlers().getActor(await headers()),principal={kind:'session' as const,userId:actor.user.id,sessionId:actor.session.id},pool=getDatabasePool();
    const result=await createCollectionService(pool).read(principal,workspaceId,collectionId);
    if(importId&&!result.imports.some((item)=>item.id===importId)){const extra=await createImportService(pool).preview(principal,workspaceId,importId,{limit:1});if(extra.collection.id!==collectionId)notFound();result.imports=[extra.import,...result.imports.slice(0,19)];}
    return {ownerId:actor.user.id,result};
  }catch(error){if(error instanceof IdentityError){if(error.code==='UNAUTHENTICATED')redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);if(['NOT_FOUND','FORBIDDEN'].includes(error.code))notFound();}throw error;}};
  const data=await load();
  return <MaterialCollectionPage ownerId={data.ownerId} workspaceId={workspaceId} initial={data.result} initialImportId={importId}/>;
}
