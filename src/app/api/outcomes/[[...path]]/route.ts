import { getOutcomesHandler } from '@/features/recurring-work/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = (request: Request) => getOutcomesHandler()(request);
export { handle as GET, handle as POST };
