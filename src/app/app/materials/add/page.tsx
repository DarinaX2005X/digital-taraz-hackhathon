import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { createSourceService } from '@/features/sources/server/service';
import { SourceAddPage } from '@/features/sources/ui/add-page';
import { createProjectCore } from '@/features/workspace/server/project-core';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  for (const key of ['workspaceId', 'projectId', 'sourceId', 'run']) if (query[key] !== undefined && !IdSchema.safeParse(query[key]).success) notFound();
  const workspaceId = query.workspaceId as string | undefined, projectId = query.projectId as string | undefined, sourceId = query.sourceId as string | undefined, run = query.run as string | undefined;
  const returnTo = `/app/materials/add?${new URLSearchParams({ ...(workspaceId ? { workspaceId } : {}), ...(projectId ? { projectId } : {}), ...(sourceId ? { sourceId } : {}), ...(run ? { run } : {}) })}`;
  const load = async () => { try {
    const actor = await getIdentityHandlers().getActor(await headers());
    const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id }, pool = getDatabasePool();
    const project = projectId && workspaceId ? (await createProjectCore(pool).read(principal, workspaceId, projectId)).project : undefined;
    const previous = sourceId && workspaceId ? (await createSourceService(pool).read(principal, workspaceId, sourceId)).source : undefined;
    if (sourceId && (!previous || !project || previous.projectId !== project.id)) notFound();
    return { ownerId: actor.user.id, project, previous };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      if (['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) notFound();
    }
    throw error;
  } };
  const data = await load();
  return <SourceAddPage ownerId={data.ownerId} initialWorkspaceId={workspaceId} initialProject={data.project ? { id: data.project.id, label: data.project.title } : undefined} previous={data.previous} initialRunId={run} />;
}
