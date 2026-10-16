import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { ProjectChangesPage } from '@/features/change-review';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { createProjectCore } from '@/features/workspace/server/project-core';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!IdSchema.safeParse(projectId).success) notFound();
  let loaded: { userId: string; workspaceId: string; authzVersion: number; title: string; canEdit: boolean };
  try {
    const actor = await getIdentityHandlers().getActor(await headers());
    const initial = await createProjectCore(getDatabasePool()).readRoute({ kind: 'session', userId: actor.user.id, sessionId: actor.session.id }, projectId);
    loaded = { userId: actor.user.id, workspaceId: initial.project.workspaceId, authzVersion: initial.authzVersion, title: initial.project.title, canEdit: initial.canEdit === true && initial.project.status === 'active' };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(`/app/projects/${projectId}/changes`)}`);
      if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound();
    }
    throw error;
  }
  return <ProjectChangesPage viewer={{ userId: loaded.userId, workspaceId: loaded.workspaceId, authzVersion: loaded.authzVersion }} projectId={projectId} projectTitle={loaded.title} canEdit={loaded.canEdit} />;
}
