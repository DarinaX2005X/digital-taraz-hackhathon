import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { MaterialsHub } from '@/features/materials/ui/hub-page';
import { createProjectCore } from '@/features/workspace/server/project-core';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const query = await searchParams;
  for(const key of ['workspaceId','projectId','sourceId','sourceVersionId']) if(query[key]!==undefined&&!IdSchema.safeParse(query[key]).success) notFound();
  const workspaceId=query.workspaceId as string|undefined,projectId=query.projectId as string|undefined,sourceId=query.sourceId as string|undefined,sourceVersionId=query.sourceVersionId as string|undefined;
  if(Boolean(sourceId)!==Boolean(sourceVersionId)||((sourceId||projectId)&&!workspaceId))notFound();
  const returnTo=`/app/materials?${new URLSearchParams({...workspaceId?{workspaceId}:{},...projectId?{projectId}:{},...sourceId&&sourceVersionId?{sourceId,sourceVersionId}:{}})}`;
  const load=async()=>{try{
    const actor=await getIdentityHandlers().getActor(await headers());
    const principal={kind:'session' as const,userId:actor.user.id,sessionId:actor.session.id};
    const project=projectId&&workspaceId?(await createProjectCore(getDatabasePool()).read(principal,workspaceId,projectId)).project:undefined;
    return {ownerId:actor.user.id,project};
  }catch(error){if(error instanceof IdentityError){if(error.code==='UNAUTHENTICATED')redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);if(['NOT_FOUND','FORBIDDEN'].includes(error.code))notFound();}throw error;}};
  const data=await load();
  return <MaterialsHub ownerId={data.ownerId} initialWorkspaceId={workspaceId} initialProject={data.project?{id:data.project.id,label:data.project.title}:undefined} initialSource={sourceId&&sourceVersionId?{sourceId,sourceVersionId}:undefined}/>;
}
