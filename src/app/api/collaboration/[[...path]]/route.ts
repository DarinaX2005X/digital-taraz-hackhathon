import { getCollaborationHandler } from '@/features/collaboration/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = (request: Request) => getCollaborationHandler()(request);
export { handle as GET, handle as POST };
