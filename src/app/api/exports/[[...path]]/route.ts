import { getExportHandler } from '@/features/exports/server';
import { errorResponse } from '@/features/identity/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) { try { return await getExportHandler()(request); } catch (error) { return errorResponse(error); } }
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
