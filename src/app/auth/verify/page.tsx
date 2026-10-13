import type { Metadata } from 'next';
import { VerifyEmailPage } from '@/features/identity/ui';
import { readIdentityNavigation, type IdentitySearchParams } from '@/server/identity-navigation';

export const metadata: Metadata = { referrer: 'no-referrer' };

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  return <VerifyEmailPage {...readIdentityNavigation(await searchParams)} />;
}
