import { getCalculationHandlers } from '@/features/sheets/server';

export const runtime = 'nodejs';
export async function POST(request: Request) { return getCalculationHandlers()(request, 'prepare'); }
