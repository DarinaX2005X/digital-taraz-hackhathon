import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { createSourceService } from '@/features/sources/server/service';
import { SourceDetailPage } from '@/features/sources/ui/detail-page';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export default async function Page({ params, searchParams }: { params: Promise<{ sourceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sourceId } = await params, { workspaceId, uploadId, sourceVersionId, from, run } = await searchParams;
  if (!IdSchema.safeParse(sourceId).success || !IdSchema.safeParse(workspaceId).success) notFound();
  if ((uploadId !== undefined && !IdSchema.safeParse(uploadId).success) || (sourceVersionId !== undefined && !IdSchema.safeParse(sourceVersionId).success)) notFound();
  if (from !== undefined && from !== 'library' && from !== 'project') notFound();
  if (run !== undefined && !IdSchema.safeParse(run).success) notFound();
  const returnTo = `/app/materials/sources/${sourceId}?${new URLSearchParams({ workspaceId: workspaceId as string, ...(from ? { from: from as string } : {}), ...(run ? { run: run as string } : {}), ...(uploadId ? { uploadId: uploadId as string } : {}), ...(sourceVersionId ? { sourceVersionId: sourceVersionId as string } : {}) })}`;
  const load = async () => { try {
    const actor = await getIdentityHandlers().getActor(await headers());
    const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id }, sources = createSourceService(getDatabasePool());
    const pinned = sourceVersionId ? await sources.readVersion(principal, workspaceId as string, sourceId, sourceVersionId as string) : undefined;
    if (pinned && uploadId && pinned.uploadId !== uploadId) notFound();
    const initial = await sources.read(principal, workspaceId as string, sourceId, (uploadId as string | undefined) ?? pinned?.uploadId);
    const selected = uploadId ? initial.uploads.find((upload) => upload.id === uploadId) : sourceVersionId ? initial.uploads.find((upload) => upload.versionId === sourceVersionId) : initial.uploads[0];
    if (!selected || (sourceVersionId && selected.versionId !== sourceVersionId)) notFound();
    return { ownerId: actor.user.id, initial, selectedUploadId: selected.id };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      if (['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) notFound();
    }
    throw error;
  } };
  const data = await load();
  return <SourceDetailPage ownerId={data.ownerId} initial={data.initial} initialUploadId={data.selectedUploadId} returnContext={from === 'library' ? 'library' : 'project'} initialRunId={typeof run === 'string' ? run : undefined} />;
}
