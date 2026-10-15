import { authHref } from '@/features/identity/ui/navigation';
import { workEntryHref } from '@/features/workspace/domain/work-entry';

export function publicWorkDestination(signedIn: boolean, intentToken: string) {
  return signedIn ? workEntryHref(undefined, intentToken) : authHref('/sign-up', { returnTo: '/app/work', intentToken });
}
