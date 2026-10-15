import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getArtifactService } from '@/features/artifacts/server';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { createProjectCore } from '@/features/workspace/server/project-core';
import { ArtifactWorkspacePage } from '@/features/workspace/ui/artifact-page';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ projectId: string; artifactId: string }> }) {
  const { projectId, artifactId } = await params;
  if (!IdSchema.safeParse(projectId).success || !IdSchema.safeParse(artifactId).success) notFound();
  const returnTo = `/app/projects/${projectId}/artifacts/${artifactId}`;
  let loaded: { initial: Awaited<ReturnType<ReturnType<typeof getArtifactService>['readRoute']>>; projectTitle: string };
  try {
    const actor = await getIdentityHandlers().getActor(await headers());
    const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
    const initial = await getArtifactService().readRoute(principal, { projectId, artifactId });
    const { project } = await createProjectCore(getDatabasePool()).read(principal, initial.viewer.workspaceId, projectId);
    loaded = { initial, projectTitle: project.title };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound();
    }
    throw error;
  }
  return <ArtifactWorkspacePage key={`${loaded.initial.viewer.userId}:${artifactId}`} {...loaded} />;
}
