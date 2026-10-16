import type { Metadata } from 'next';
import { InvitationTokenSchema } from '@/features/identity/contracts';
import { InvitePage } from '@/features/identity/ui/invitation';

export const metadata: Metadata = { referrer: 'no-referrer' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const token = InvitationTokenSchema.safeParse((await params).token);
  return <InvitePage token={token.success ? token.data : ''} />;
}
