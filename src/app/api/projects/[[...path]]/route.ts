import { getWorkspaceHandler } from '@/features/workspace/server/http-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return getWorkspaceHandler()(request); }
export async function POST(request: Request) { return getWorkspaceHandler()(request); }
