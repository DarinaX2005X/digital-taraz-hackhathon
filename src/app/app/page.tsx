import { redirect } from 'next/navigation';
import type { IdentitySearchParams } from '@/server/identity-navigation';

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  const { intent } = await searchParams;
  redirect(`/settings${typeof intent === 'string' && /^[a-f0-9]{64}$/.test(intent) ? `?intent=${intent}` : ''}`);
}
