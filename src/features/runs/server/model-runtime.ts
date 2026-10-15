import type { Pool } from 'pg';
import { createBudgetLedger } from './budget';
import { createModelGateway } from './gateway';
import { readRegisteredPricing, type ModelRoute } from './model-policy';

export const CURRENT_MODEL_AUTHORIZATION = 'user-2026-10-14-autonomy-usd10';
export const CURRENT_TEXT_ROUTE: ModelRoute = Object.freeze({ model: 'xiaomi/mimo-v2.6-flash', endpoint: 'xiaomi/fp8', kind: 'text', quantization: 'fp8' });
export function applicationModelGateway(pool: Pool, proofRunId?: string) {
  return createModelGateway({
    ledger: createBudgetLedger(pool, { proofRunId }), apiKey: process.env.OPENROUTER_API_KEY ?? '',
    authorizationId: CURRENT_MODEL_AUTHORIZATION, pricing: () => readRegisteredPricing(pool, CURRENT_TEXT_ROUTE),
    safe429Retries: 0, proofRunId,
  });
}
