import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { createProjectCore } from '@/features/workspace/server/project-core';
import { createProjectViews } from '@/features/workspace/server/project-views';
import { ProjectPage } from '@/features/workspace/ui/project-page';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const query = await searchParams;
  if (!IdSchema.safeParse(projectId).success) notFound();
  if (query.resume !== undefined && query.resume !== '1') notFound();
  const hasSource = query.sourceId !== undefined || query.sourceVersionId !== undefined;
  if (hasSource && (!IdSchema.safeParse(query.sourceId).success || !IdSchema.safeParse(query.sourceVersionId).success)) notFound();
  const selectedSource = hasSource ? { sourceId: query.sourceId as string, sourceVersionId: query.sourceVersionId as string } : undefined;
  const returnQuery = new URLSearchParams();
  if (query.resume === '1') returnQuery.set('resume', '1');
  if (selectedSource) { returnQuery.set('sourceId', selectedSource.sourceId); returnQuery.set('sourceVersionId', selectedSource.sourceVersionId); }
  const returnTo = `/app/projects/${projectId}${returnQuery.size ? `?${returnQuery}` : ''}`;
  let selectedArtifactId: string | null = null;
  let loaded: { ownerId: string; initial: Awaited<ReturnType<ReturnType<typeof createProjectCore>['readRoute']>> };
  try {
    const actor = await getIdentityHandlers().getActor(await headers());
    const initial = await createProjectCore(getDatabasePool()).readRoute({ kind: 'session', userId: actor.user.id, sessionId: actor.session.id }, projectId);
    if (query.resume === '1' && !selectedSource) selectedArtifactId = (await createProjectViews(getDatabasePool()).read({ kind: 'session', userId: actor.user.id, sessionId: actor.session.id }, initial.project.workspaceId, projectId)).selectedArtifactId;
    loaded = { ownerId: actor.user.id, initial };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound();
    }
    throw error;
  }
  if (selectedArtifactId) redirect(`/app/projects/${projectId}/artifacts/${selectedArtifactId}`);
  return <ProjectPage key={`${loaded.ownerId}:${projectId}`} {...loaded} selectedSource={selectedSource} />;
}
