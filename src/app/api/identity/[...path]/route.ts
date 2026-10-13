import { handleIdentityRequest } from '@/server/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleIdentityRequest(request, 'identity');
export const POST = (request: Request) => handleIdentityRequest(request, 'identity');
export const PATCH = (request: Request) => handleIdentityRequest(request, 'identity');
export const DELETE = (request: Request) => handleIdentityRequest(request, 'identity');
