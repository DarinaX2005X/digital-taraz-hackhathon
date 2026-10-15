import { getOperationsHandler } from '@/features/operations/server';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return getOperationsHandler()(request); }
export async function POST(request: Request) { return getOperationsHandler()(request); }

