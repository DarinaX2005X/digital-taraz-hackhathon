import { z } from 'zod';
import { UsdSchema } from '../../../contracts/runs';
import { RUN_LIMITS } from '../domain/limits';
import { RunError } from '../domain/errors';
import { usd, usdString } from '../domain/money';

export const PricingSnapshotSchema = z.strictObject({
  model: z.string().min(1).max(128), endpoint: z.string().min(1).max(128), provider: z.string().min(1).max(128),
  quantization: z.string().max(32).nullable(), kind: z.enum(['text', 'image']),
  inputUsd: UsdSchema, outputUsd: UsdSchema, requestUsd: UsdSchema, imageUsd: UsdSchema,
  contextTokens: z.number().int().positive().max(2_000_000), maxOutputTokens: z.number().int().positive().max(100_000),
  supportedParameters: z.array(z.string().min(1).max(100)).max(100),
  checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), modelExpiresAt: z.iso.datetime().nullable(),
  proof: z.enum(['unproven', 'passed']), proofRef: z.string().max(200).nullable(),
  canonicalModel: z.string().min(1).max(128).optional(), jsonMode: z.enum(['json_object', 'json_schema']).optional(), vision: z.boolean().optional(),
});
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;
export function validatePricing(raw: unknown, requested: { kind: 'text' | 'image'; maxOutputTokens: number; parameters: string[]; candidateProof?: boolean }, now = new Date()) {
  const parsed = PricingSnapshotSchema.safeParse(raw);
  if (!parsed.success) throw new RunError('price_unknown');
  const price = parsed.data;
  if ((price.proof !== 'passed' || !price.proofRef) && !requested.candidateProof) throw new RunError('model_unproven');
  if (price.kind !== requested.kind) throw new RunError('model_forbidden');
  if (price.modelExpiresAt && new Date(price.modelExpiresAt) <= now) throw new RunError('model_expired');
  const checked = new Date(price.checkedAt).getTime();
  if (checked > now.getTime() || now.getTime() - checked >= RUN_LIMITS.pricingTtlMs || new Date(price.expiresAt) <= now || new Date(price.expiresAt).getTime() > checked + RUN_LIMITS.pricingTtlMs) throw new RunError('price_expired');
  if (!Number.isInteger(requested.maxOutputTokens) || requested.maxOutputTokens < 1 || requested.maxOutputTokens > price.maxOutputTokens || requested.parameters.some((parameter) => !price.supportedParameters.includes(parameter))) throw new RunError('unsupported_parameters');
  // Reserve the full accepted context window; provider-specific tokenizers cannot under-reserve.
  const bound = usd(price.requestUsd).plus(usd(price.inputUsd).times(price.contextTokens)).plus(usd(price.outputUsd).times(requested.maxOutputTokens)).plus(requested.kind === 'image' ? usd(price.imageUsd) : 0);
  const reservedUsd = usdString(bound);
  if (requested.kind === 'image' && bound.gt(usd(RUN_LIMITS.imageUsd))) throw new RunError('run_budget');
  return { price, reservedUsd };
}
