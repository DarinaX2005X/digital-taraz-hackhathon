import type { Metadata } from 'next';
import { ResetPasswordPage } from '@/features/identity/ui/recovery';
import { readIdentityNavigation, type IdentitySearchParams } from '@/server/identity-navigation';

export const metadata: Metadata = { referrer: 'no-referrer' };

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  return <ResetPasswordPage {...readIdentityNavigation(await searchParams)} />;
}
