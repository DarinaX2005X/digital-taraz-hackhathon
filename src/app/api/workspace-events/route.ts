import { getArtifactHandlers } from '@/features/artifacts/server/http-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return getArtifactHandlers().events(request); }
