import { getRunHandler } from '@/features/runs/server';
import { runErrorResponse } from '@/features/runs/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function handle(request: Request) {
  try { return await getRunHandler()(request); }
  catch (error) { return runErrorResponse(error); }
}
export { handle as GET, handle as POST };
