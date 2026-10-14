import { getArtifactHandlers } from '@/features/artifacts/server/http-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return getArtifactHandlers().artifacts(request); }
export async function POST(request: Request) { return getArtifactHandlers().artifacts(request); }
