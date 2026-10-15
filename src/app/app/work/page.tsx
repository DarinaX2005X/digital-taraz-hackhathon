import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import { getIdentityHandlers } from '@/features/identity/server';
import { IdentityError } from '@/features/identity/server/http';
import { WorkPage } from '@/features/workspace/ui/work-page';
import { authReturnTo } from '@/features/identity/domain/return-to';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  if (query.workspace !== undefined && !IdSchema.safeParse(query.workspace).success) notFound();
  const workspace = typeof query.workspace === 'string' ? query.workspace : undefined;
  const intent = typeof query.intent === 'string' && /^[a-f0-9]{64}$/.test(query.intent) ? query.intent : undefined;
  const returnTo = authReturnTo(`/app/work${workspace ? `?workspace=${workspace}` : ''}`, intent);
  let ownerId: string;
  try {
    const actor = await getIdentityHandlers().getActor(await headers());
    ownerId = actor.user.id;
  } catch (error) {
    if (error instanceof IdentityError && error.code === 'UNAUTHENTICATED') redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
    throw error;
  }
  return <WorkPage key={ownerId} ownerId={ownerId} initialWorkspaceId={workspace} intentToken={intent} />;
}
