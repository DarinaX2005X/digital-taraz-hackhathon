import type { Pool, PoolClient } from 'pg';
import { RunError } from '../domain/errors';
import { hash, type RunRow } from './data';
import { PricingSnapshotSchema, type PricingSnapshot } from './pricing';

export const MODEL_POLICY_REVISION = 2;
export interface ModelRoute { model: string; endpoint: string; kind: 'text' | 'image'; quantization: string | null }
export const APPROVED_MODEL_ROUTES: readonly ModelRoute[] = Object.freeze([
  { model: 'xiaomi/mimo-v2.5', endpoint: 'xiaomi/fp8', kind: 'text', quantization: 'fp8' },
  { model: 'xiaomi/mimo-v2.6-flash', endpoint: 'xiaomi/fp8', kind: 'text', quantization: 'fp8' },
  { model: 'bytedance-seed/seedream-4.5', endpoint: 'seed', kind: 'image', quantization: null },
]);
export const MODEL_PROOF_CAPABILITY = 'runtime.model-proof';
export interface ModelEndpointRow {
  model: string; endpoint: string; kind: 'text' | 'image'; state: 'candidate' | 'enabled' | 'disabled' | 'quarantined';
  policy_revision: number; pricing_snapshot: unknown; pricing_hash: string; proof_state: 'unproven' | 'passed'; proof_ref: string | null;
}
export function assertModelRoute(price: ModelRoute & { provider?: string }, allowed: readonly ModelRoute[] = APPROVED_MODEL_ROUTES) {
  const forbidden = /(?:^|[\s/_.:-])(?:openai|anthropic|claude|gpt(?:\d)?|o[134])(?:$|[\s/_.:-])/i;
  if ([price.model, price.endpoint, price.provider ?? ''].some((value) => forbidden.test(value))
    || !allowed.some((route) => route.model === price.model && route.endpoint === price.endpoint && route.kind === price.kind && route.quantization === price.quantization)) throw new RunError('model_forbidden');
}
export function isCandidateProof(run: RunRow, proofRunId?: string) {
  return proofRunId === run.id && run.capability_id === MODEL_PROOF_CAPABILITY && run.capability_version === 1;
}
export async function authorizeModelEndpoint(tx: PoolClient, price: PricingSnapshot, run: RunRow, options: { allowedRoutes?: readonly ModelRoute[]; proofRunId?: string } = {}) {
  assertModelRoute(price, options.allowedRoutes);
  const row = (await tx.query<ModelEndpointRow>('SELECT * FROM agent_model_endpoints WHERE model=$1 AND endpoint=$2 AND kind=$3 FOR SHARE', [price.model, price.endpoint, price.kind])).rows[0];
  if (!row || row.policy_revision !== MODEL_POLICY_REVISION) throw new RunError('model_forbidden');
  if (row.state === 'quarantined') throw new RunError('price_exceeded');
  const candidate = isCandidateProof(run, options.proofRunId);
  if (row.state !== 'enabled' && !(candidate && row.state === 'candidate')) throw new RunError('model_unproven');
  if (!candidate && (row.proof_state !== 'passed' || !row.proof_ref)) throw new RunError('model_unproven');
  const parsed = PricingSnapshotSchema.safeParse(row.pricing_snapshot);
  if (!parsed.success || hash(parsed.data) !== row.pricing_hash || hash(price) !== row.pricing_hash
    || parsed.data.proof !== row.proof_state || parsed.data.proofRef !== row.proof_ref) throw new RunError('price_unknown');
  return { candidate };
}
export async function readRegisteredPricing(pool: Pool, route: ModelRoute, allowedRoutes?: readonly ModelRoute[]): Promise<PricingSnapshot> {
  assertModelRoute(route, allowedRoutes);
  const row = (await pool.query<ModelEndpointRow>('SELECT * FROM agent_model_endpoints WHERE model=$1 AND endpoint=$2 AND kind=$3', [route.model, route.endpoint, route.kind])).rows[0];
  if (!row) throw new RunError('model_unproven');
  if (row.state === 'quarantined') throw new RunError('price_exceeded');
  const price = PricingSnapshotSchema.safeParse(row.pricing_snapshot);
  if (!price.success || hash(price.data) !== row.pricing_hash) throw new RunError('price_unknown');
  return price.data;
}
