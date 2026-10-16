import { randomInt, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { identityTransaction } from '../../identity/server/access';
import { RunError } from '../domain/errors';
import { hash, hashKey } from './data';
import { CURRENT_MODEL_AUTHORIZATION, CURRENT_TEXT_ROUTE } from './model-runtime';
import { assertModelRoute, MODEL_POLICY_REVISION, MODEL_PROOF_CAPABILITY, type ModelEndpointRow } from './model-policy';
import { PricingSnapshotSchema, validatePricing, type PricingSnapshot } from './pricing';
import { UsdSchema } from '../../../contracts/runs';
import { modelProofRegistration } from './model-proof';
import { createRunRegistry } from './registry';
import { createRunService } from './service';
import { lockBudget } from './budget';
import { exceedsUsd, usd, usdString } from '../domain/money';

const authorityRef = 'user-autonomy-2026-10-14-shared-maximum-usd10';
const amount = z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d+(?:\.\d+)?$/));
const authorizationLimitUsd = () => {
  const parsed = UsdSchema.safeParse(process.env.TIRLIK_MODEL_AUTHORIZATION_LIMIT_USD ?? '10');
  if (!parsed.success || usd(parsed.data).lte(0)) throw new RunError('configuration');
  return parsed.data;
};
async function metadata(route: string) {
  const response = await fetch(`https://openrouter.ai/api/v1/${route}`, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new RunError('price_unknown');
  const content = await response.text();
  if (content.length > 12_000_000) throw new RunError('price_unknown');
  return JSON.parse(content) as unknown;
}
export async function inspectProofPricing(options: { allowUnready?: boolean } = {}): Promise<PricingSnapshot> {
  const modelSchema = z.object({ id: z.string(), canonical_slug: z.string(), expiration_date: z.string().nullable().optional(), architecture: z.object({ input_modalities: z.array(z.string()) }) });
  const models = z.object({ data: z.array(modelSchema.passthrough()) }).parse(await metadata('models'));
  const model = models.data.find((item) => item.id === CURRENT_TEXT_ROUTE.model);
  if (!model || !model.architecture.input_modalities.includes('image')) throw new RunError('model_forbidden');
  const endpointSchema = z.object({ tag: z.string(), provider_name: z.string(), quantization: z.string().nullable(), status: z.number(), context_length: z.number().int().positive(), max_completion_tokens: z.number().int().positive(), supported_parameters: z.array(z.string()), supports_tool_choice: z.object({ required: z.boolean() }), pricing: z.object({ prompt: amount, completion: amount, request: amount.optional(), image: amount.optional() }).passthrough() });
  const endpoints = z.object({ data: z.object({ endpoints: z.array(endpointSchema) }) }).parse(await metadata(`models/${CURRENT_TEXT_ROUTE.model}/endpoints`));
  const endpoint = endpoints.data.endpoints.find((item) => item.tag === CURRENT_TEXT_ROUTE.endpoint);
  if (!endpoint || endpoint.status !== 0 || endpoint.quantization !== CURRENT_TEXT_ROUTE.quantization || !endpoint.supports_tool_choice.required) throw new RunError('model_forbidden');
  if (!endpoint.supported_parameters.includes('structured_outputs')) throw new RunError('unsupported_parameters');
  // Text vision is priced by input tokens. Reject any additional image fee.
  if (endpoint.pricing.image && Number(endpoint.pricing.image) !== 0) throw new RunError('price_unknown');
  const now = Date.now();
  const price = PricingSnapshotSchema.parse({ ...CURRENT_TEXT_ROUTE, provider: endpoint.provider_name, inputUsd: endpoint.pricing.prompt, outputUsd: endpoint.pricing.completion, requestUsd: endpoint.pricing.request ?? '0', imageUsd: '0', contextTokens: endpoint.context_length, maxOutputTokens: Math.min(100_000, endpoint.max_completion_tokens), supportedParameters: endpoint.supported_parameters, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), modelExpiresAt: model.expiration_date ? new Date(model.expiration_date).toISOString() : null, proof: 'unproven', proofRef: null, canonicalModel: model.canonical_slug, vision: true, jsonMode: 'json_schema' });
  if (!options.allowUnready) validatePricing(price, { kind: 'text', maxOutputTokens: 500, parameters: ['tools', 'tool_choice', 'response_format', 'max_tokens'], candidateProof: true });
  return price;
}
export async function registerProofCandidate(pool: Pool, price: PricingSnapshot) {
  PricingSnapshotSchema.parse(price);
  assertModelRoute(price, [CURRENT_TEXT_ROUTE]);
  if (price.proof !== 'unproven' || price.proofRef !== null) throw new RunError('model_unproven');
  validatePricing(price, { kind: 'text', maxOutputTokens: 500, parameters: ['max_tokens', 'tools', 'tool_choice', 'response_format'], candidateProof: true });
  return identityTransaction(pool, async (tx) => {
    await lockBudget(tx);
    const current = (await tx.query<ModelEndpointRow>('SELECT * FROM agent_model_endpoints WHERE model=$1 AND endpoint=$2 AND kind=$3 FOR UPDATE', [price.model, price.endpoint, price.kind])).rows[0];
    if (current && current.state !== 'candidate') throw new RunError('conflict');
    const usage = await tx.query("SELECT id FROM agent_run_usage WHERE model=$1 AND endpoint=$2 LIMIT 1", [price.model, price.endpoint]);
    if (usage.rowCount) throw new RunError('conflict');
    await tx.query(`INSERT INTO agent_model_endpoints(model,endpoint,kind,state,policy_revision,pricing_snapshot,pricing_hash,proof_state,proof_ref) VALUES($1,$2,$3,'candidate',$4,$5,$6,'unproven',NULL)
      ON CONFLICT(model,endpoint,kind) DO UPDATE SET pricing_snapshot=EXCLUDED.pricing_snapshot,pricing_hash=EXCLUDED.pricing_hash,updated_at=now()`, [price.model, price.endpoint, price.kind, MODEL_POLICY_REVISION, price, hash(price)]);
    return { state: 'candidate', model: price.model, endpoint: price.endpoint, maximumPerCallUsd: validatePricing(price, { kind: 'text', maxOutputTokens: 500, parameters: [], candidateProof: true }).reservedUsd };
  });
}
export async function refreshProvenPricing(pool: Pool, fresh: PricingSnapshot) {
  PricingSnapshotSchema.parse(fresh);
  assertModelRoute(fresh, [CURRENT_TEXT_ROUTE]);
  if (fresh.proof !== 'unproven' || fresh.proofRef !== null) throw new RunError('model_unproven');
  validatePricing(fresh, { kind: 'text', maxOutputTokens: 500, parameters: ['max_tokens', 'tools', 'tool_choice', 'response_format'], candidateProof: true });
  return identityTransaction(pool, async (tx) => {
    await lockBudget(tx);
    const row = (await tx.query<ModelEndpointRow>('SELECT * FROM agent_model_endpoints WHERE model=$1 AND endpoint=$2 AND kind=$3 FOR UPDATE', [fresh.model, fresh.endpoint, fresh.kind])).rows[0];
    if (!row || row.state !== 'enabled' || row.proof_state !== 'passed' || !row.proof_ref || row.policy_revision !== MODEL_POLICY_REVISION) throw new RunError('model_unproven');
    const previous = PricingSnapshotSchema.parse(row.pricing_snapshot);
    if (hash(previous) !== row.pricing_hash || previous.proof !== row.proof_state || previous.proofRef !== row.proof_ref) throw new RunError('price_unknown');
    // A refreshed quote cannot silently substitute the model or capability that passed proof.
    if (!previous.canonicalModel || fresh.canonicalModel !== previous.canonicalModel || fresh.quantization !== previous.quantization
      || fresh.provider !== previous.provider || fresh.jsonMode !== previous.jsonMode || fresh.jsonMode !== 'json_schema'
      || previous.vision !== true || fresh.vision !== true || !fresh.supportedParameters.includes('structured_outputs')) throw new RunError('model_unproven');
    const price = PricingSnapshotSchema.parse({ ...fresh, proof: 'passed', proofRef: row.proof_ref });
    await tx.query('UPDATE agent_model_endpoints SET pricing_snapshot=$4,pricing_hash=$5,updated_at=now() WHERE model=$1 AND endpoint=$2 AND kind=$3', [price.model, price.endpoint, price.kind, price, hash(price)]);
    return { state: 'enabled', model: price.model, endpoint: price.endpoint, proofRunId: row.proof_ref, expiresAt: price.expiresAt, maximumPerCallUsd: validatePricing(price, { kind: 'text', maxOutputTokens: 500, parameters: [] }).reservedUsd };
  });
}
export async function activateProofAuthorization(pool: Pool) {
  if (!process.env.OPENROUTER_API_KEY) throw new RunError('configuration');
  const fingerprint = hashKey(process.env.OPENROUTER_API_KEY);
  const desiredLimitUsd = authorizationLimitUsd();
  return identityTransaction(pool, async (tx) => {
    await lockBudget(tx);
    await tx.query("INSERT INTO agent_budget_authorizations(id,provider,state,limit_usd,key_fingerprint,authority_ref,activated_at) VALUES($1,'openrouter','active',$2,$3,$4,now()) ON CONFLICT(id) DO NOTHING", [CURRENT_MODEL_AUTHORIZATION, desiredLimitUsd, fingerprint, authorityRef]);
    const row = (await tx.query<{ state: string; limit_usd: string; key_fingerprint: string; authority_ref: string; reserved_usd: string; spent_usd: string }>('SELECT * FROM agent_budget_authorizations WHERE id=$1 FOR UPDATE', [CURRENT_MODEL_AUTHORIZATION])).rows[0];
    if (!row || row.state !== 'active' || row.key_fingerprint !== fingerprint || row.authority_ref !== authorityRef) throw new RunError('conflict');
    const currentLimit = usd(row.limit_usd), desiredLimit = usd(desiredLimitUsd);
    if (currentLimit.lt(desiredLimit)) throw new RunError('conflict');
    if (currentLimit.gt(desiredLimit)) {
      if (!usd(row.reserved_usd).isZero() || usd(row.spent_usd).gt(desiredLimit)) throw new RunError('conflict');
      const updated = (await tx.query<{ state: string; limit_usd: string; key_fingerprint: string; authority_ref: string; reserved_usd: string; spent_usd: string }>('UPDATE agent_budget_authorizations SET limit_usd=$2 WHERE id=$1 RETURNING *', [CURRENT_MODEL_AUTHORIZATION, desiredLimitUsd])).rows[0]!;
      return { authorizationId: CURRENT_MODEL_AUTHORIZATION, limitUsd: updated.limit_usd, reservedUsd: updated.reserved_usd, spentUsd: updated.spent_usd };
    }
    return { authorizationId: CURRENT_MODEL_AUTHORIZATION, limitUsd: row.limit_usd, reservedUsd: row.reserved_usd, spentUsd: row.spent_usd };
  });
}
export async function modelProofReadiness(pool: Pool, inspectedPrice?: PricingSnapshot) {
  const desiredLimitUsd = authorizationLimitUsd();
  const price = inspectedPrice ?? await inspectProofPricing({ allowUnready: true });
  let quote: ReturnType<typeof validatePricing> | null = null;
  let currentPricingFailure: string | null = null;
  try { quote = validatePricing(price, { kind: 'text', maxOutputTokens: 500, parameters: ['max_tokens', 'tools', 'tool_choice', 'response_format'], candidateProof: true }); }
  catch (error) {
    if (!(error instanceof RunError)) throw error;
    currentPricingFailure = error.failure;
  }
  const [grant, endpoint, proofRuns, unresolved] = await Promise.all([
    pool.query<{ state: string; limit_usd: string; reserved_usd: string; spent_usd: string; key_fingerprint: string }>('SELECT state,limit_usd,reserved_usd,spent_usd,key_fingerprint FROM agent_budget_authorizations WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION]),
    pool.query<ModelEndpointRow>('SELECT * FROM agent_model_endpoints WHERE model=$1 AND endpoint=$2 AND kind=$3', [price.model, price.endpoint, price.kind]),
    pool.query<{ count: number }>('SELECT count(*)::integer AS count FROM agent_runs WHERE capability_id=$1', [MODEL_PROOF_CAPABILITY]),
    pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM agent_run_usage WHERE state IN ('reserved','dispatched','ambiguous')", []),
  ]);
  const authorization = grant.rows[0], registered = endpoint.rows[0];
  const keyPresent = Boolean(process.env.OPENROUTER_API_KEY);
  const keyMatches = Boolean(keyPresent && authorization && authorization.key_fingerprint === hashKey(process.env.OPENROUTER_API_KEY!));
  const registeredPrice = registered ? PricingSnapshotSchema.safeParse(registered.pricing_snapshot) : null;
  let registeredQuoteValid = false;
  if (registeredPrice?.success) {
    try {
      validatePricing(registeredPrice.data, { kind: 'text', maxOutputTokens: 500, parameters: ['max_tokens', 'tools', 'tool_choice', 'response_format'], candidateProof: true });
      registeredQuoteValid = true;
    } catch { registeredQuoteValid = false; }
  }
  const endpointIdentityMatches = Boolean(registered && registeredPrice?.success
    && registered.policy_revision === MODEL_POLICY_REVISION && registered.pricing_hash === hash(registeredPrice.data)
    && ['model', 'endpoint', 'provider', 'quantization', 'kind', 'canonicalModel', 'vision', 'jsonMode']
      .every((field) => registeredPrice.data[field as keyof PricingSnapshot] === price[field as keyof PricingSnapshot]));
  const pricingCurrent = Boolean(registeredPrice?.success
    && ['inputUsd', 'outputUsd', 'requestUsd', 'imageUsd', 'contextTokens', 'maxOutputTokens', 'modelExpiresAt']
      .every((field) => registeredPrice.data[field as keyof PricingSnapshot] === price[field as keyof PricingSnapshot])
    && [...registeredPrice.data.supportedParameters].sort().join('\u0000') === [...price.supportedParameters].sort().join('\u0000'));
  const candidateRegistered = currentPricingFailure === null && endpointIdentityMatches && registeredQuoteValid && pricingCurrent && registered?.state === 'candidate'
    && registered.proof_state === 'unproven' && registered.proof_ref === null;
  const endpointProven = currentPricingFailure !== 'model_expired' && endpointIdentityMatches && registered?.state === 'enabled' && registered.proof_state === 'passed' && Boolean(registered.proof_ref);
  const paidProofRequired = !endpointProven;
  const requiredReservationUsd = quote ? usdString(usd(quote.reservedUsd).times(paidProofRequired ? 2 : 1)) : null;
  const authorizationActive = Boolean(authorization?.state === 'active' && usd(authorization.limit_usd).equals(usd(desiredLimitUsd)) && keyMatches);
  const authorizationHeadroom = Boolean(authorizationActive && requiredReservationUsd
    && !exceedsUsd(authorization!.limit_usd, authorization!.reserved_usd, authorization!.spent_usd, requiredReservationUsd));
  const commonChecks = {
    keyPresent,
    currentPricingFresh: currentPricingFailure === null,
    authorizationActive,
    authorizationHeadroom,
    noRuntimeUnresolvedUsage: (unresolved.rows[0]?.count ?? 0) === 0,
  };
  const proofChecks = { candidateRegistered, noPriorProofRun: (proofRuns.rows[0]?.count ?? 0) === 0 };
  const runtimeChecks = { endpointProven, priceFresh: endpointProven && registeredQuoteValid && pricingCurrent && currentPricingFailure === null };
  const nextAction = currentPricingFailure === 'model_expired' ? 'register-candidate'
    : currentPricingFailure !== null || (endpointProven && (!registeredQuoteValid || !pricingCurrent)) ? 'refresh-proven-price'
    : !authorizationHeadroom ? 'insufficient-authorization-headroom'
    : paidProofRequired && !candidateRegistered ? 'register-candidate'
    : paidProofRequired ? 'release-and-run-proof-once' : 'release-runtime-call';
  return {
    paidReleaseRequired: true,
    paidProofRequired,
    readyForPaidProof: paidProofRequired && Object.values({ ...commonChecks, ...proofChecks }).every(Boolean),
    readyForRuntimeCalls: !paidProofRequired && Object.values({ ...commonChecks, ...runtimeChecks }).every(Boolean),
    nextAction,
    checks: { ...commonChecks, ...proofChecks, ...runtimeChecks },
    route: { model: price.model, canonicalModel: price.canonicalModel, endpoint: price.endpoint, provider: price.provider, quantization: price.quantization, vision: price.vision, jsonMode: price.jsonMode },
    quote: { checkedAt: price.checkedAt, expiresAt: price.expiresAt, inputUsdPerToken: price.inputUsd, outputUsdPerToken: price.outputUsd, maximumPerRequestUsd: quote?.reservedUsd ?? null, maximumTwoRequestProofUsd: quote ? usdString(usd(quote.reservedUsd).times(2)) : null, requiredReservationUsd, currentPricingFailure },
    authorization: authorization ? { state: authorization.state, limitUsd: authorization.limit_usd, reservedUsd: authorization.reserved_usd, spentUsd: authorization.spent_usd, keyMatches } : null,
    endpoint: registered ? { state: registered.state, proofState: registered.proof_state, policyRevision: registered.policy_revision, proofRef: registered.proof_ref } : null,
    existingProofRuns: proofRuns.rows[0]?.count ?? 0,
    unresolvedRuntimeUsages: unresolved.rows[0]?.count ?? 0,
  };
}
export async function startModelProof(pool: Pool, input: { userId: string; workspaceId: string; key: string }) {
  z.uuid().parse(input.userId); z.uuid().parse(input.workspaceId); z.uuid().parse(input.key);
  const lock = await pool.connect();
  let acquired = false;
  try {
  acquired = (await lock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('single-synthetic-model-proof',0)) AS acquired")).rows[0]?.acquired === true;
  if (!acquired) throw new RunError('conflict');
  const workspace = (await pool.query<{ authz_version: number }>('SELECT authz_version FROM identity_workspaces WHERE id=$1', [input.workspaceId])).rows[0];
  if (!workspace) throw new RunError('access_changed');
  const existing = await pool.query('SELECT id FROM agent_runs WHERE capability_id=$1 LIMIT 1', [MODEL_PROOF_CAPABILITY]);
  if (existing.rowCount) throw new RunError('conflict');
  const registration = modelProofRegistration(pool);
  const service = createRunService(pool, createRunRegistry([registration.capability], registration.tools));
  const run = await service.create({ kind: 'job', userId: input.userId, authzVersion: workspace.authz_version }, { workspaceId: input.workspaceId, projectId: null, capabilityId: MODEL_PROOF_CAPABILITY, capabilityVersion: 1, goal: 'Synthetic model verification', locale: 'en', inputRefs: [] }, input.key, { trusted: true, privateInput: { quantity: randomInt(2, 25), unitPrice: randomInt(10, 500), marker: randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase() } });
  return { runId: run.id, state: run.state, url: `/app/runs/${run.id}`, maximumRequests: 2, maximumRunUsd: run.budget.limitUsd };
  } finally {
    try { if (acquired) await lock.query("SELECT pg_advisory_unlock(hashtextextended('single-synthetic-model-proof',0))"); }
    finally { lock.release(); }
  }
}
export async function proofStatus(pool: Pool, runId: string) {
  z.uuid().parse(runId);
  const run = (await pool.query('SELECT id,state,failure_code,request_count,reserved_usd,spent_usd,workflow_state,workflow_run_id FROM agent_runs WHERE id=$1 AND capability_id=$2', [runId, MODEL_PROOF_CAPABILITY])).rows[0];
  if (!run) throw new RunError('conflict');
  const usage = (await pool.query('SELECT id,state,model,endpoint,reserved_usd,actual_usd,input_tokens,output_tokens,provider_request_id FROM agent_run_usage WHERE run_id=$1 ORDER BY created_at', [runId])).rows;
  return { run, usage };
}
export async function enableProvenModel(pool: Pool, runId: string) {
  z.uuid().parse(runId);
  return identityTransaction(pool, async (tx) => {
    await lockBudget(tx);
    const run = (await tx.query<{ state: string; request_count: number; reserved_usd: string }>('SELECT * FROM agent_runs WHERE id=$1 AND capability_id=$2 FOR SHARE', [runId, MODEL_PROOF_CAPABILITY])).rows[0];
    const receipts = await tx.query("SELECT r.step_id FROM agent_tool_receipts r JOIN agent_run_steps s ON s.run_id=r.run_id AND s.id=r.step_id WHERE r.run_id=$1 AND s.tool_name IN ('runtime.proof-vision','runtime.proof-multiply','runtime.proof-result') AND s.state='succeeded'", [runId]);
    const verified = (await tx.query<{ state: { verified?: unknown } }>('SELECT state FROM agent_run_contexts WHERE run_id=$1', [runId])).rows[0]?.state.verified;
    const usage = (await tx.query<{ state: string; actual_usd: string | null; pricing_snapshot: unknown }>('SELECT state,actual_usd,pricing_snapshot FROM agent_run_usage WHERE run_id=$1 ORDER BY created_at', [runId])).rows;
    if (!run || run.state !== 'completed' || run.request_count !== 2 || Number(run.reserved_usd) !== 0 || receipts.rowCount !== 3 || !verified || usage.length !== 2 || usage.some((item) => item.state !== 'succeeded' || item.actual_usd === null)) throw new RunError('model_unproven');
    const current = (await tx.query<ModelEndpointRow>('SELECT * FROM agent_model_endpoints WHERE model=$1 AND endpoint=$2 AND kind=$3 FOR UPDATE', [CURRENT_TEXT_ROUTE.model, CURRENT_TEXT_ROUTE.endpoint, CURRENT_TEXT_ROUTE.kind])).rows[0];
    if (!current || current.state !== 'candidate' || current.policy_revision !== MODEL_POLICY_REVISION || usage.some((item) => hash(item.pricing_snapshot) !== current.pricing_hash)) throw new RunError('model_unproven');
    const price = PricingSnapshotSchema.parse({ ...PricingSnapshotSchema.parse(current.pricing_snapshot), proof: 'passed', proofRef: runId });
    validatePricing(price, { kind: 'text', maxOutputTokens: 500, parameters: [] });
    await tx.query("UPDATE agent_model_endpoints SET state='enabled',proof_state='passed',proof_ref=$4,pricing_snapshot=$5,pricing_hash=$6,updated_at=now() WHERE model=$1 AND endpoint=$2 AND kind=$3", [price.model, price.endpoint, price.kind, runId, price, hash(price)]);
    return { state: 'enabled', model: price.model, endpoint: price.endpoint, proofRunId: runId };
  });
}
