import { getWorkRulesHandler } from '@/features/recurring-work/server';
import { getRunRuntime } from '@/features/runs/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = (request: Request) => {
  getRunRuntime();
  return getWorkRulesHandler()(request);
};
export { handle as GET, handle as POST };
