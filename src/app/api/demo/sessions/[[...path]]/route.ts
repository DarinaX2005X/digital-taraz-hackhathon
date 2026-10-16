import { handleDemoRequest } from '@/features/demo/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export { handleDemoRequest as GET, handleDemoRequest as POST };
