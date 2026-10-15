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
  const { sourceId } = await params, { workspaceId } = await searchParams;
  if (!IdSchema.safeParse(sourceId).success || !IdSchema.safeParse(workspaceId).success) notFound();
  const load = async () => { try {
    const actor = await getIdentityHandlers().getActor(await headers());
    const initial = await createSourceService(getDatabasePool()).read({ kind: 'session', userId: actor.user.id, sessionId: actor.session.id }, workspaceId as string, sourceId);
    return { ownerId: actor.user.id, initial };
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(`/app/materials/sources/${sourceId}?workspaceId=${workspaceId}`)}`);
      if (['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) notFound();
    }
    throw error;
  } };
  const data = await load();
  return <SourceDetailPage ownerId={data.ownerId} initial={data.initial} />;
}
