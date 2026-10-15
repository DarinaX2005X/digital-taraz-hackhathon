import type { Pool } from 'pg';
import { createBudgetLedger } from './budget';
import { createModelGateway } from './gateway';
import { readEnabledPricing, readRegisteredPricing, type ModelRoute } from './model-policy';
import { validatePricing } from './pricing';
import { RunError } from '../domain/errors';

export const CURRENT_MODEL_AUTHORIZATION = 'user-2026-10-14-autonomy-usd10';
export const CURRENT_TEXT_ROUTE: ModelRoute = Object.freeze({ model: 'xiaomi/mimo-v2.6-flash', endpoint: 'xiaomi/fp8', kind: 'text', quantization: 'fp8' });
export async function applicationModelQuote(pool: Pool, request: { maxOutputTokens: number; parameters: string[]; vision?: boolean }) {
  if (!process.env.OPENROUTER_API_KEY) throw new RunError('configuration');
  const pricing = await readEnabledPricing(pool, CURRENT_TEXT_ROUTE);
  const result = validatePricing(pricing, { kind: 'text', maxOutputTokens: request.maxOutputTokens, parameters: request.parameters });
  if (request.vision && !result.price.vision) throw new RunError('unsupported_parameters');
  return result;
}
export function applicationModelGateway(pool: Pool, proofRunId?: string) {
  return createModelGateway({
    ledger: createBudgetLedger(pool, { proofRunId }), apiKey: process.env.OPENROUTER_API_KEY ?? '',
    authorizationId: CURRENT_MODEL_AUTHORIZATION, pricing: () => readRegisteredPricing(pool, CURRENT_TEXT_ROUTE),
    safe429Retries: 0, proofRunId,
  });
}
