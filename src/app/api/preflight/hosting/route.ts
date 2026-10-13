import { handleHostingDELETE, handleHostingGET, handleHostingPOST } from '@/server/preflight/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = handleHostingGET;
export const POST = handleHostingPOST;
export const DELETE = handleHostingDELETE;
