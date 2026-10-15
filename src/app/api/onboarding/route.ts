import { getOnboardingHandler } from '@/features/onboarding/server/http-index';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => getOnboardingHandler()(request);
export const POST = (request: Request) => getOnboardingHandler()(request);
