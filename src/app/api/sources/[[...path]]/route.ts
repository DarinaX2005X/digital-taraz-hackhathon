import { getSourceHandler } from '@/features/sources/server';
import { errorResponse } from '@/features/identity/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) { try { return await getSourceHandler()(request); } catch (error) { return errorResponse(error); } }
export const GET = handle;
export const POST = handle;
export const PUT = handle;
