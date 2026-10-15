import { getDependencyHandlers } from '@/features/dependencies/server/http-index';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return getDependencyHandlers().handle(request); }
export async function POST(request: Request) { return getDependencyHandlers().handle(request); }
