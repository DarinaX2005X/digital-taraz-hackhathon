import { handleIdentityRequest } from '@/server/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleIdentityRequest(request, 'auth');
export const POST = (request: Request) => handleIdentityRequest(request, 'auth');
