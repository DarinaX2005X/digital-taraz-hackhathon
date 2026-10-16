import { getProjectPackageHandler } from '@/features/project-packages/server/http-index';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return getProjectPackageHandler()(request); }
export async function POST(request: Request) { return getProjectPackageHandler()(request); }
