import { SignInPage } from '@/features/identity/ui/credentials';
import { readIdentityNavigation, type IdentitySearchParams } from '@/server/identity-navigation';

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  return <SignInPage {...readIdentityNavigation(await searchParams)} />;
}
