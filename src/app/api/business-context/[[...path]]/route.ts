import { getBusinessContextHandler } from '@/features/business-context/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = (request: Request) => getBusinessContextHandler()(request);
export { handle as GET, handle as POST };
