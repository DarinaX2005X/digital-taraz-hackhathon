import { OpaqueTokenSchema } from '@/features/identity/contracts';
import { authReturnTo } from '@/features/identity/domain/return-to';

export type IdentitySearchParams = Record<string, string | string[] | undefined>;

export function readIdentityNavigation(query: IdentitySearchParams) {
  const intent = query.intentToken;
  const intentToken = typeof intent === 'string' && /^[a-f0-9]{64}$/.test(intent) ? intent : undefined;
  const token = OpaqueTokenSchema.safeParse(query.token);
  return {
    returnTo: authReturnTo(query.returnTo, intentToken),
    intentToken,
    token: token.success ? token.data : undefined,
  };
}
