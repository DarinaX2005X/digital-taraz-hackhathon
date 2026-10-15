import { exportDemoDocument } from '@/features/demo/server/export';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return exportDemoDocument(request); }
