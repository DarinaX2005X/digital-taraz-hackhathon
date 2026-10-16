import 'server-only';
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { getIdentityHandlers } from './identity-runtime';

export async function readIdentityLocale() {
  const requestHeaders = await headers();
  if (!requestHeaders.has('cookie')) return undefined;
  try {
    return (await getIdentityHandlers().getActor(new Headers(requestHeaders))).user.locale;
  } catch {
    // Public pages remain available when a session expires or auth is unconfigured.
    return undefined;
  }
}

export async function handleIdentityRequest(request: Request, kind: 'auth' | 'identity'): Promise<Response> {
  try {
    return await getIdentityHandlers()[kind](request);
  } catch {
    return Response.json(ErrorEnvelopeSchema.parse({
      code: 'UNAVAILABLE', messageKey: 'common.errors.unavailable', retryable: true, requestId: randomUUID(),
    }), { status: 503, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
  }
}
