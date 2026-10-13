import { SignUpPage } from '@/features/identity/ui';
import { readIdentityNavigation, type IdentitySearchParams } from '@/server/identity-navigation';

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  return <SignUpPage {...readIdentityNavigation(await searchParams)} />;
}
