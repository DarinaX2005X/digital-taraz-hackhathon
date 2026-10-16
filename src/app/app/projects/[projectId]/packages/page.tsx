import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getArtifactService } from '@/features/artifacts/server';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { ProjectPackagesPage } from '@/features/project-packages';
import { getProjectPackageService } from '@/features/project-packages/server';
import { createProjectCore } from '@/features/workspace/server/project-core';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!IdSchema.safeParse(projectId).success) notFound();
  let loaded: { userId: string; workspaceId: string; authzVersion: number; title: string; canEdit: boolean; artifacts: Awaited<ReturnType<ReturnType<typeof getArtifactService>['list']>>['artifacts']; packages: Awaited<ReturnType<ReturnType<typeof getProjectPackageService>['list']>>['packages'] };
  try {
    const actor = await getIdentityHandlers().getActor(await headers()), principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
    const initial = await createProjectCore(getDatabasePool()).readRoute(principal, projectId), workspaceId = initial.project.workspaceId;
    const [artifacts, packages] = await Promise.all([getArtifactService().list(principal, { workspaceId, projectId, limit: 50 }), getProjectPackageService().list(principal, { workspaceId, projectId })]);
    loaded = { userId: actor.user.id, workspaceId, authzVersion: Math.max(initial.authzVersion, artifacts.viewer.authzVersion, packages.authzVersion), title: initial.project.title, canEdit: initial.canEdit === true && initial.project.status === 'active', artifacts: artifacts.artifacts, packages: packages.packages };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(`/app/projects/${projectId}/packages`)}`);
      if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound();
    }
    throw error;
  }
  return <ProjectPackagesPage viewer={{ userId: loaded.userId, workspaceId: loaded.workspaceId, authzVersion: loaded.authzVersion }} projectId={projectId} projectTitle={loaded.title} canEdit={loaded.canEdit} artifacts={loaded.artifacts} initialPackages={loaded.packages} />;
}
