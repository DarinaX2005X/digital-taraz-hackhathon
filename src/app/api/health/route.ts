import { randomUUID } from 'node:crypto';
import { ErrorEnvelopeSchema } from '@/contracts/errors';
import { getDatabasePool } from '@/server/db/pool';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    await getDatabasePool().query('SELECT 1');
    return Response.json({ status: 'ok', service: 'tirlik', database: 'ready' }, { headers });
  } catch {
    return Response.json(ErrorEnvelopeSchema.parse({
      code: 'UNAVAILABLE', messageKey: 'errors.unavailable', retryable: true,
      requestId: randomUUID(), recovery: 'retry',
    }), { status: 503, headers });
  }
}
