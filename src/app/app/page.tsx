import { redirect } from 'next/navigation';
import { IdSchema } from '@/contracts/primitives';
import type { IdentitySearchParams } from '@/server/identity-navigation';

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  const { intent, workspace } = await searchParams;
  const query = new URLSearchParams();
  if (typeof intent === 'string' && /^[a-f0-9]{64}$/.test(intent)) query.set('intent', intent);
  if (typeof workspace === 'string' && IdSchema.safeParse(workspace).success) query.set('workspace', workspace);
  redirect(`/app/work${query.size ? `?${query}` : ''}`);
}
