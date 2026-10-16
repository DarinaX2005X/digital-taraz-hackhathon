import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { TeamHub } from '@/features/collaboration/ui/team-hub';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  if (query.workspace !== undefined && !IdSchema.safeParse(query.workspace).success) notFound();
  const workspace = typeof query.workspace === 'string' ? query.workspace : undefined;
  let ownerId: string;
  try {
    const actor = await getIdentityHandlers().getActor(await headers());
    ownerId = actor.user.id;
  } catch (error) {
    if (error instanceof IdentityError && error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(`/app/team${workspace ? `?workspace=${workspace}` : ''}`)}`);
    throw error;
  }
  return <TeamHub ownerId={ownerId} initialWorkspaceId={workspace} />;
}
