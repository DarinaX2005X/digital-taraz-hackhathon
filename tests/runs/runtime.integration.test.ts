import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunRegistry, type RunCapability, type RunTool } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { createBudgetLedger } from '../../src/features/runs/server/budget';
import { hash, hashKey, type RunFence } from '../../src/features/runs/server/data';
import type { PricingSnapshot } from '../../src/features/runs/server/pricing';
import { MODEL_POLICY_REVISION, MODEL_PROOF_CAPABILITY, type ModelRoute } from '../../src/features/runs/server/model-policy';
import { isolatedRunPool, syntheticWorkspace } from './database';
import { createRunHandlers } from '../../src/features/runs/server/handlers';
import { activateProofAuthorization, enableProvenModel, modelProofReadiness, refreshProvenPricing, registerProofCandidate, startModelProof } from '../../src/features/runs/server/proof-admin';
import { CURRENT_MODEL_AUTHORIZATION, CURRENT_TEXT_ROUTE } from '../../src/features/runs/server/model-runtime';

let pool: Pool;
const grantId = 'runtime-isolated-tests';
const keyFingerprint = hashKey('isolated-synthetic-not-a-provider-key');
const allowedRoutes: readonly ModelRoute[] = [{ model: 'synthetic/model', endpoint: 'synthetic/provider', kind: 'text', quantization: null }];
let currentPrice: PricingSnapshot;
beforeAll(() => { pool = isolatedRunPool(); });
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  vi.stubEnv('TIRLIK_MODEL_AUTHORIZATION_LIMIT_USD', '10');
  // The guard above admits only the disposable runner's database, never the primary app.
  await pool.query('TRUNCATE agent_run_continuations,agent_model_endpoints,agent_model_outputs,agent_run_operations,agent_run_events,agent_tool_receipts,agent_run_usage,agent_run_contexts,agent_run_steps,agent_runs,agent_budget_days,agent_budget_authorizations,agent_queue_workspaces CASCADE');
  await pool.query('UPDATE agent_queue_clock SET sequence=0');
  await pool.query("INSERT INTO agent_budget_authorizations(id,provider,state,limit_usd,key_fingerprint,authority_ref,activated_at) VALUES($1,'openrouter','active','10',$2,'isolated-synthetic-test',now())", [grantId, keyFingerprint]);
  currentPrice = price();
  await registerPrice(currentPrice);
});
const price = (): PricingSnapshot => ({ model: 'synthetic/model', endpoint: 'synthetic/provider', provider: 'Synthetic', quantization: null, kind: 'text', inputUsd: '0', outputUsd: '0', requestUsd: '0.1', imageUsd: '0', contextTokens: 1000, maxOutputTokens: 100, supportedParameters: ['max_tokens'], checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), modelExpiresAt: null, proof: 'passed', proofRef: 'isolated-test' });
async function registerPrice(pricing: PricingSnapshot, state = 'enabled') {
  await pool.query(`INSERT INTO agent_model_endpoints(model,endpoint,kind,state,policy_revision,pricing_snapshot,pricing_hash,proof_state,proof_ref)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(model,endpoint,kind) DO UPDATE SET state=EXCLUDED.state,pricing_snapshot=EXCLUDED.pricing_snapshot,pricing_hash=EXCLUDED.pricing_hash,proof_state=EXCLUDED.proof_state,proof_ref=EXCLUDED.proof_ref`, [pricing.model, pricing.endpoint, pricing.kind, state, MODEL_POLICY_REVISION, pricing, hash(pricing), pricing.proof, pricing.proofRef]);
}
function registry(overrides: Partial<RunTool> = {}) {
  return createRunRegistry([{ id: 'runtime.synthetic', version: 1, publicStart: true, policy: { scope: 'edit', confidential: false }, initialize: () => ({ context: { total: 0 }, steps: [{ tool: 'synthetic.calculate', version: 1, action: 'calculate', input: { value: 2 } }] }) }], [{
    name: 'synthetic.calculate', version: 1, purpose: 'Synthetic isolated effect', input: z.strictObject({ value: z.number() }), output: z.strictObject({ total: z.number() }), policy: { scope: 'edit', confidential: false }, costClass: 'local', deadlineMs: 30_000, idempotency: 'receipt',
    execute: async (_tx, input, _prepared, context) => ({ output: { total: (input as { value: number }).value }, context: { ...context.context, total: (input as { value: number }).value } }), ...overrides,
  }]);
}
function assistantRegistry() {
  const policy = { scope: 'edit' as const, confidential: false };
  const ask = { tool: 'assistant.ask', version: 1, action: 'continue' as const, input: {} };
  const finish = { tool: 'assistant.finish', version: 1, action: 'save' as const, input: {} };
  const sourceRef = { sourceId: '11111111-1111-4111-8111-111111111111', sourceVersionId: '22222222-2222-4222-8222-222222222222', revision: 1 };
  const branch = { id: 'delivery_check', title: 'Check delivery feasibility', purposeKey: 'runs.branches.deliveryCheck', state: 'planned' as const, parentStepId: null, resultRefs: [] };
  const decision = {
    outcome: 'conditional' as const, selectedOptionId: null,
    options: ['standard', 'later'].map((id, index) => ({
      id, title: index ? 'Later delivery' : 'Standard delivery', outcome: 'conditional' as const,
      sourceRefs: [sourceRef],
      commercial: { currency: 'KZT', quotedTotal: index ? '1100' : '1200', directCost: '700', contribution: index ? '400' : '500', contributionRate: index ? '36.36' : '41.67' },
      deadline: { requestedDate: '2026-10-30', openingDate: '2026-10-29', earliestCompletionDate: index ? '2026-10-31' : '2026-10-30' },
      capacity: [], factors: [],
    })),
    differences: [{ leftOptionId: 'standard', rightOptionId: 'later', dimensions: ['price' as const, 'deadline' as const] }],
  };
  const capability: RunCapability = {
    id: 'business.goal', version: 1, publicStart: true, policy,
    initialize: (input, privateInput) => {
      const continuation = privateInput.continuation as Record<string, unknown> | undefined;
      return { context: continuation ?? { goal: input.goal, plan: ['Check the material unknown'], questions: [], summary: '', results: [], decision, branches: [branch], privateEvidence: 'must-never-leave-the-server', answers: [{ questionId: 'legacy_scope', answer: 'Keep the existing delivery scope.' }], messages: [{ role: 'assistant', content: 'private model text' }] }, steps: [ask] };
    },
    continue: (input, context, change) => {
      if (change.answers?.length) {
        if (!change.answers.some((answer) => answer.questionId === 'delivery_date')) throw new Error('missing answer');
        const questions = context.questions as { id: string; text: string }[];
        const answers = change.answers.map((answer) => {
          const question = questions.find((item) => item.id === answer.questionId);
          if (!question) throw new Error('missing question');
          return { ...answer, question: question.text };
        });
        return { context: { ...context, goal: input.goal, questions: [], answers: [...(context.answers as typeof answers), ...answers], branches: [{ ...branch, state: 'running' as const }] }, steps: [finish] };
      }
      return { context: { ...context, goal: input.goal, plan: change.plan ?? [], questions: [], summary: '', results: [] }, steps: [ask] };
    },
    projectProgress: (raw) => {
      const context = raw as { plan?: unknown; questions?: unknown; answers?: { questionId: string; question?: string; answer: string }[]; summary?: unknown; results?: unknown; decision?: unknown; branches?: unknown };
      const answeredQuestions = (context.answers ?? []).map((answer) => ({ questionId: answer.questionId, ...(answer.question ? { question: answer.question } : {}), answer: answer.answer }));
      return { plan: context.plan as string[], questions: context.questions as never[], answeredQuestions, summary: context.summary as string, results: context.results as never[], decision: context.decision as typeof decision, branches: context.branches as never[] };
    },
  };
  const tools: RunTool[] = [{
    name: 'assistant.ask', version: 1, purpose: 'Pause for one material business answer', input: z.strictObject({}), output: z.strictObject({ asked: z.literal(true) }), policy, costClass: 'local', deadlineMs: 30_000, idempotency: 'receipt',
    execute: async (_tx, _input, _prepared, context) => ({ output: { asked: true }, context: { ...context.context, questions: [{ id: 'delivery_date', text: 'What delivery date is required?', required: true }], branches: [{ ...branch, state: 'waiting_input' as const, parentStepId: context.fence.stepId }] }, nextSteps: [finish], state: 'waiting_input' }),
  }, {
    name: 'assistant.finish', version: 1, purpose: 'Finish the synthetic assistant continuation', input: z.strictObject({}), output: z.strictObject({ saved: z.literal(true) }), policy, costClass: 'local', deadlineMs: 30_000, idempotency: 'receipt',
    execute: async (_tx, _input, _prepared, context) => ({ output: { saved: true }, context: { ...context.context, questions: [], summary: 'Saved a reviewed result.', branches: [{ ...branch, state: 'completed' as const, parentStepId: context.fence.stepId }] }, state: 'completed' }),
  }];
  return createRunRegistry([capability], tools);
}
async function scope() {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const value = await syntheticWorkspace(tx);
    await tx.query('COMMIT');
    return { ...value, principal: { kind: 'session' as const, userId: value.userId, sessionId: value.sessionId } };
  } catch (error) { await tx.query('ROLLBACK'); throw error; }
  finally { tx.release(); }
}
async function runFixture(overrides: Partial<RunTool> = {}) {
  const owner = await scope(); const service = createRunService(pool, registry(overrides));
  const input = { workspaceId: owner.workspaceId, projectId: null, capabilityId: 'runtime.synthetic', capabilityVersion: 1, goal: 'Synthetic isolated runtime', locale: 'en' as const, inputRefs: [] };
  const run = await service.create(owner.principal, input, randomUUID());
  return { owner, service, input, run };
}
async function claimedFixture() {
  const fixture = await runFixture(); const claim = await fixture.service.claim();
  if (!claim) throw new Error('claim missing');
  const begun = await fixture.service.beginStep(claim);
  if (!begun) throw new Error('step missing');
  const fence: RunFence = { ...claim, stepId: begun.step.id };
  const ledger = createBudgetLedger(pool, { allowedRoutes });
  const pricing = currentPrice;
  const reservation = (operationKey: string, reservedUsd = '0.1') => ({ fence, operationKey, attemptKey: `${operationKey}_${fence.epoch}_0`, inputHash: hash({ operationKey }), reservedUsd, pricing, maxOutputTokens: 100, authorizationId: grantId, keyFingerprint });
  return { ...fixture, claim, fence, ledger, reservation };
}

describe('transactional runtime service', () => {
  it('reports an exact non-charging release gate for an already proven current endpoint', async () => {
    const providerKey = 'synthetic-test-key-not-provider';
    vi.stubEnv('OPENROUTER_API_KEY', providerKey);
    try {
      await pool.query('UPDATE agent_budget_authorizations SET id=$1,key_fingerprint=$2 WHERE id=$3', [CURRENT_MODEL_AUTHORIZATION, hashKey(providerKey), grantId]);
      const proofRef = randomUUID();
      const inspected: PricingSnapshot = { ...price(), ...CURRENT_TEXT_ROUTE, canonicalModel: 'xiaomi/mimo-v2.6-flash-20260921', maxOutputTokens: 100_000, contextTokens: 1_048_576, inputUsd: '0.00000014', outputUsd: '0.00000028', requestUsd: '0', supportedParameters: ['max_tokens', 'tools', 'tool_choice', 'response_format', 'structured_outputs'], proof: 'unproven', proofRef: null, vision: true, jsonMode: 'json_schema' };
      const proven = { ...inspected, proof: 'passed' as const, proofRef };
      await registerPrice(proven);
      const readiness = await modelProofReadiness(pool, inspected);
      expect(readiness).toMatchObject({ paidReleaseRequired: true, paidProofRequired: false, readyForPaidProof: false, readyForRuntimeCalls: true, nextAction: 'release-runtime-call' });
      expect(readiness.quote).toMatchObject({ maximumPerRequestUsd: '0.14694064', maximumTwoRequestProofUsd: '0.29388128', requiredReservationUsd: '0.14694064', currentPricingFailure: null });
      expect(readiness.authorization).toMatchObject({ limitUsd: '10.000000000000', reservedUsd: '0.000000000000', spentUsd: '0.000000000000', keyMatches: true });
      expect(readiness.route).not.toHaveProperty('apiKey');

      await pool.query("UPDATE agent_model_endpoints SET state='candidate',proof_state='unproven',proof_ref=NULL,pricing_snapshot=$2,pricing_hash=$3 WHERE model=$1", [inspected.model, inspected, hash(inspected)]);
      await pool.query('UPDATE agent_budget_authorizations SET spent_usd=$2 WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION, '9.70611872']);
      expect(await modelProofReadiness(pool, inspected)).toMatchObject({ paidProofRequired: true, readyForPaidProof: true, readyForRuntimeCalls: false, nextAction: 'release-and-run-proof-once', quote: { requiredReservationUsd: '0.29388128' }, checks: { authorizationHeadroom: true, candidateRegistered: true } });
      await pool.query('UPDATE agent_budget_authorizations SET spent_usd=$2 WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION, '9.706118720001']);
      expect(await modelProofReadiness(pool, inspected)).toMatchObject({ readyForPaidProof: false, nextAction: 'insufficient-authorization-headroom', checks: { authorizationHeadroom: false } });

      const expired = { ...inspected, modelExpiresAt: new Date(0).toISOString() };
      expect(await modelProofReadiness(pool, expired)).toMatchObject({ readyForPaidProof: false, readyForRuntimeCalls: false, nextAction: 'register-candidate', quote: { maximumPerRequestUsd: null, requiredReservationUsd: null, currentPricingFailure: 'model_expired' }, checks: { currentPricingFresh: false } });
    } finally { vi.unstubAllEnvs(); }
  });
  it('refreshes an expired proven price without changing proof, liabilities or model identity', async () => {
    const proofRef = randomUUID();
    const previous: PricingSnapshot = { ...price(), ...CURRENT_TEXT_ROUTE, canonicalModel: 'xiaomi/mimo-v2.6-flash-20260921', maxOutputTokens: 1000, supportedParameters: ['max_tokens', 'tools', 'tool_choice', 'response_format', 'structured_outputs'], proofRef, vision: true, jsonMode: 'json_schema', checkedAt: new Date(Date.now() - 86_500_000).toISOString(), expiresAt: new Date(Date.now() - 100_000).toISOString() };
    await registerPrice(previous);
    await pool.query('UPDATE agent_budget_authorizations SET reserved_usd=0.15,spent_usd=0.02 WHERE id=$1', [grantId]);
    const fresh: PricingSnapshot = { ...previous, inputUsd: '0.00000014', proof: 'unproven', proofRef: null, checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    expect(await refreshProvenPricing(pool, fresh)).toMatchObject({ state: 'enabled', proofRunId: proofRef });
    const row = (await pool.query('SELECT * FROM agent_model_endpoints WHERE model=$1', [fresh.model])).rows[0];
    expect(row).toMatchObject({ state: 'enabled', proof_state: 'passed', proof_ref: proofRef });
    expect(row.pricing_snapshot).toMatchObject({ inputUsd: '0.00000014', proof: 'passed', proofRef });
    expect(row.pricing_hash).toBe(hash(row.pricing_snapshot));
    expect((await pool.query('SELECT reserved_usd,spent_usd FROM agent_budget_authorizations WHERE id=$1', [grantId])).rows[0]).toEqual({ reserved_usd: '0.150000000000', spent_usd: '0.020000000000' });
    await expect(refreshProvenPricing(pool, { ...fresh, canonicalModel: 'xiaomi/mimo-new-version' })).rejects.toMatchObject({ failure: 'model_unproven' });
    await expect(refreshProvenPricing(pool, { ...fresh, vision: false })).rejects.toMatchObject({ failure: 'model_unproven' });
    await pool.query("UPDATE agent_model_endpoints SET state='disabled' WHERE model=$1", [fresh.model]);
    await expect(refreshProvenPricing(pool, fresh)).rejects.toMatchObject({ failure: 'model_unproven' });
  });
  it('keeps the one shared proof authorization balance and refuses closed or rebound grants', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-test-key-not-provider');
    try {
      await expect(activateProofAuthorization(pool)).rejects.toMatchObject({ code: '23505' });
      await pool.query("UPDATE agent_budget_authorizations SET state='closed' WHERE id=$1", [grantId]);
      expect(await activateProofAuthorization(pool)).toMatchObject({ authorizationId: CURRENT_MODEL_AUTHORIZATION });
      await pool.query('UPDATE agent_budget_authorizations SET reserved_usd=0.15,spent_usd=0.02 WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION]);
      expect(await activateProofAuthorization(pool)).toMatchObject({ reservedUsd: '0.150000000000', spentUsd: '0.020000000000' });
      vi.stubEnv('OPENROUTER_API_KEY', 'another-synthetic-key');
      await expect(activateProofAuthorization(pool)).rejects.toMatchObject({ failure: 'conflict' });
      vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-test-key-not-provider');
      await pool.query("UPDATE agent_budget_authorizations SET state='closed' WHERE id=$1", [CURRENT_MODEL_AUTHORIZATION]);
      await expect(activateProofAuthorization(pool)).rejects.toMatchObject({ failure: 'conflict' });
    } finally { vi.unstubAllEnvs(); }
  });
  it('lowers the configured authorization ceiling only when the existing balance is fully safe', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-test-key-not-provider');
    try {
      await pool.query("UPDATE agent_budget_authorizations SET state='closed' WHERE id=$1", [grantId]);
      const initial = await activateProofAuthorization(pool);
      expect(initial.limitUsd).toBe('10.000000000000');
      const identity = (await pool.query('SELECT provider,key_fingerprint,authority_ref,activated_at FROM agent_budget_authorizations WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION])).rows[0];

      vi.stubEnv('TIRLIK_MODEL_AUTHORIZATION_LIMIT_USD', '2');
      await pool.query('UPDATE agent_budget_authorizations SET reserved_usd=0.15,spent_usd=0.02 WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION]);
      await expect(activateProofAuthorization(pool)).rejects.toMatchObject({ failure: 'conflict' });
      await pool.query('UPDATE agent_budget_authorizations SET reserved_usd=0,spent_usd=2.01 WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION]);
      await expect(activateProofAuthorization(pool)).rejects.toMatchObject({ failure: 'conflict' });
      await pool.query('UPDATE agent_budget_authorizations SET spent_usd=0.02 WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION]);
      expect(await activateProofAuthorization(pool)).toMatchObject({ limitUsd: '2.000000000000', reservedUsd: '0.000000000000', spentUsd: '0.020000000000' });
      expect((await pool.query('SELECT provider,key_fingerprint,authority_ref,activated_at FROM agent_budget_authorizations WHERE id=$1', [CURRENT_MODEL_AUTHORIZATION])).rows[0]).toEqual(identity);
      expect(await modelProofReadiness(pool, price())).toMatchObject({ checks: { authorizationActive: true }, authorization: { limitUsd: '2.000000000000' } });

      vi.stubEnv('TIRLIK_MODEL_AUTHORIZATION_LIMIT_USD', '3');
      await expect(activateProofAuthorization(pool)).rejects.toMatchObject({ failure: 'conflict' });
      vi.stubEnv('TIRLIK_MODEL_AUTHORIZATION_LIMIT_USD', '0');
      await expect(activateProofAuthorization(pool)).rejects.toMatchObject({ failure: 'configuration' });
      await expect(modelProofReadiness(pool, price())).rejects.toMatchObject({ failure: 'configuration' });
    } finally { vi.unstubAllEnvs(); }
  });
  it('does not enable a candidate without the complete two-call three-receipt proof and allows one private proof only', async () => {
    const pricing: PricingSnapshot = { ...price(), ...CURRENT_TEXT_ROUTE, proof: 'unproven', proofRef: null, maxOutputTokens: 1000, supportedParameters: ['max_tokens', 'tools', 'tool_choice', 'response_format'], vision: true, jsonMode: 'json_schema' };
    expect(await registerProofCandidate(pool, pricing)).toMatchObject({ state: 'candidate' });
    await expect(registerProofCandidate(pool, { ...pricing, model: 'openai/gpt-5' })).rejects.toMatchObject({ failure: 'model_forbidden' });
    const owner = await scope();
    const result = await startModelProof(pool, { userId: owner.userId, workspaceId: owner.workspaceId, key: randomUUID() });
    expect(result).toMatchObject({ state: 'queued', maximumRequests: 2, maximumRunUsd: '0.500000000000' });
    await expect(enableProvenModel(pool, result.runId)).rejects.toMatchObject({ failure: 'model_unproven' });
    await expect(startModelProof(pool, { userId: owner.userId, workspaceId: owner.workspaceId, key: randomUUID() })).rejects.toMatchObject({ failure: 'conflict' });
    expect((await pool.query('SELECT state FROM agent_model_endpoints WHERE model=$1', [CURRENT_TEXT_ROUTE.model])).rows[0].state).toBe('candidate');
  });
  it('reauthorizes heartbeat and never extends an obsolete lease', async () => {
    const { owner, service, run } = await runFixture();
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    await service.heartbeat(claim);
    await pool.query('UPDATE identity_workspaces SET authz_version=authz_version+1 WHERE id=$1', [owner.workspaceId]);
    await expect(service.heartbeat(claim)).rejects.toMatchObject({ code: 'CONFLICT' });
    await pool.query('UPDATE agent_runs SET execution_epoch=execution_epoch+1 WHERE id=$1', [run.id]);
    await expect(service.heartbeat(claim)).rejects.toBeDefined();
  });
  it('serves authenticated idempotent run commands and actor-fenced read endpoints', async () => {
    const owner = await scope();
    const tools = registry(); const service = createRunService(pool, tools); const wake = vi.fn().mockResolvedValue(undefined);
    const handle = createRunHandlers({ pool, service, registry: tools, wake, origin: 'http://localhost:3000', getActor: async () => ({ user: { id: owner.userId, name: 'Synthetic', email: 'synthetic@example.invalid', locale: 'en' }, session: { id: owner.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } }) });
    const input = { workspaceId: owner.workspaceId, projectId: null, capabilityId: 'runtime.synthetic', capabilityVersion: 1, goal: 'Synthetic API proof', locale: 'en', inputRefs: [] };
    const key = randomUUID();
    const request = (path: string, method = 'GET', body?: unknown, origin = 'http://localhost:3000', userId = owner.userId) => new Request(`http://localhost:3000/api/runs${path}`, { method, headers: { origin, 'X-Tirlik-User-Id': userId, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await handle(request('', 'POST', input, 'http://other.invalid'))).status).toBe(403);
    expect(wake).not.toHaveBeenCalled();
    const first = await handle(request('', 'POST', input)); expect(first.status).toBe(202);
    const run = await first.json();
    expect((await (await handle(request('', 'POST', input))).json()).id).toBe(run.id);
    expect((await handle(request(`/${run.id}`, 'GET', undefined, undefined, randomUUID()))).status).toBe(409);
    expect((await handle(request(`/${run.id}`))).status).toBe(200);
    const list = await (await handle(request(`?workspaceId=${owner.workspaceId}`))).json(); expect(list.runs).toHaveLength(1);
    expect((await handle(request(`/${run.id}/events?after=0&after=1`))).status).toBe(422);
    const events = await (await handle(request(`/${run.id}/events?after=0`))).json(); expect(events.events[0].runId).toBe(run.id);
    const cancelled = await handle(request(`/${run.id}/cancel`, 'POST', { expectedEpoch: run.epoch })); expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).state).toBe('cancelled');
    const outsider = await scope();
    await expect(service.read(outsider.principal, run.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query('DELETE FROM identity_sessions WHERE id=$1', [owner.sessionId]);
    expect((await handle(request(`/${run.id}`))).status).toBe(401);
  });
  it('creates one run under simultaneous retries and rejects changed bodies', async () => {
    const { owner, service, input } = await runFixture(); const key = randomUUID();
    const results = await Promise.all([service.create(owner.principal, input, key), service.create(owner.principal, input, key)]);
    expect(results[0]?.id).toBe(results[1]?.id);
    await expect(service.create(owner.principal, { ...input, goal: 'Changed synthetic input' }, key)).rejects.toMatchObject({ failure: 'conflict' });
  });
  it('accepts a trusted run budget, keeps the public default, and carries the exact ceiling into a continuation', async () => {
    const owner = await scope(), tools = assistantRegistry(), service = createRunService(pool, tools);
    const input = { workspaceId: owner.workspaceId, projectId: null, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Prepare bounded work', locale: 'en' as const, inputRefs: [] };
    await expect(service.create(owner.principal, input, randomUUID(), { budgetLimitUsd: '0.25' })).rejects.toMatchObject({ failure: 'access_changed' });
    const publicRun = await service.create(owner.principal, input, randomUUID());
    expect((await pool.query('SELECT budget_limit_usd FROM agent_runs WHERE id=$1', [publicRun.id])).rows[0].budget_limit_usd).toBe('0.500000000000');
    const bounded = await service.create(owner.principal, input, randomUUID(), { trusted: true, budgetLimitUsd: '0.25' });
    expect((await pool.query('SELECT budget_limit_usd FROM agent_runs WHERE id=$1', [bounded.id])).rows[0].budget_limit_usd).toBe('0.250000000000');
    const child = await service.resume(owner.principal, bounded.id, { expectedEpoch: bounded.epoch, goal: 'Continue the same bounded work' }, randomUUID());
    expect((await pool.query('SELECT budget_limit_usd FROM agent_runs WHERE id=$1', [child.id])).rows[0].budget_limit_usd).toBe('0.250000000000');
    await expect(service.create(owner.principal, input, randomUUID(), { trusted: true, budgetLimitUsd: 'not-usd' })).rejects.toBeDefined();
  });
  it('commits a typed effect and receipt together and exposes no private context in the event log', async () => {
    const { owner, service, run } = await runFixture(); const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    expect(await service.executeStep(claim)).toBe('continue');
    expect(await service.executeStep(claim)).toBe('stopped');
    const final = await service.read(owner.principal, run.id);
    expect(final.state).toBe('completed'); expect(final.steps[0]?.state).toBe('succeeded');
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_tool_receipts WHERE run_id=$1', [run.id])).rows[0].count).toBe(1);
    const events = await service.events(owner.principal, run.id);
    expect(events.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(JSON.stringify(events)).not.toContain('total');
    expect(await service.events(owner.principal, run.id, events.cursor)).toMatchObject({ events: [], cursor: events.cursor, terminal: true });
    await expect(service.events(owner.principal, run.id, events.cursor + 1)).rejects.toMatchObject({ failure: 'conflict' });
  });
  it('rolls back a domain effect when output validation fails', async () => {
    const { service, run } = await runFixture({ execute: async (tx, _input, _prepared, context) => { await tx.query('UPDATE agent_run_contexts SET revision=99 WHERE run_id=$1', [context.fence.runId]); return { output: { invalid: true } }; } });
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    expect(await service.executeStep(claim)).toBe('stopped');
    expect((await pool.query('SELECT revision FROM agent_run_contexts WHERE run_id=$1', [run.id])).rows[0].revision).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_tool_receipts WHERE run_id=$1', [run.id])).rows[0].count).toBe(0);
  });
  it('commits bounded same-step checkpoints once and reuses their context for the final receipt', async () => {
    let effects = 0;
    const { owner, service, run } = await runFixture({ prepare: async (_input, context) => {
      const checkpoint = { key: 'batch_1', inputHash: hash({ batch: 1 }), effect: async (_tx: unknown, current: Record<string, unknown>) => { effects++; return { context: { ...current, batch: 1 } }; } };
      expect((await context.checkpoint(checkpoint)).replay).toBe(false);
      expect((await context.checkpoint(checkpoint)).replay).toBe(true);
      await expect(context.checkpoint({ ...checkpoint, inputHash: hash({ batch: 2 }) })).rejects.toMatchObject({ failure: 'conflict' });
    } });
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    await service.executeStep(claim); await service.executeStep(claim);
    expect(effects).toBe(1); expect((await service.read(owner.principal, run.id)).state).toBe('completed');
    expect((await pool.query('SELECT state,revision FROM agent_run_contexts WHERE run_id=$1', [run.id])).rows[0]).toEqual({ state: { total: 2, batch: 1 }, revision: 2 });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_tool_receipts WHERE run_id=$1', [run.id])).rows[0].count).toBe(2);
  });
  it('bounds an uncooperative prepare and rejects database writes after a timed-out effect', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      let enterPrepare!: () => void; const prepareEntered = new Promise<void>((resolve) => { enterPrepare = resolve; });
      const hanging = await runFixture({ deadlineMs: 25, prepare: () => { enterPrepare(); return new Promise(() => undefined); } });
      const firstClaim = await hanging.service.claim(); if (!firstClaim) throw new Error('claim missing');
      const firstExecution = hanging.service.executeStep(firstClaim);
      await Promise.race([prepareEntered, firstExecution.then(() => { throw new Error('Step stopped before prepare entry'); })]);
      await vi.advanceTimersByTimeAsync(25);
      expect(await firstExecution).toBe('stopped');
      expect((await hanging.service.read(hanging.owner.principal, hanging.run.id)).failure).toBe('step_deadline');
      let enterExecute!: () => void; const executeEntered = new Promise<void>((resolve) => { enterExecute = resolve; });
      let settleLate!: () => void; const lateSettled = new Promise<void>((resolve) => { settleLate = resolve; });
      let rejected = false;
      const late = await runFixture({ deadlineMs: 25, execute: (tx, _input, _prepared, context) => new Promise((resolve) => {
        setTimeout(async () => {
          try { await tx.query('UPDATE agent_run_contexts SET revision=99 WHERE run_id=$1', [context.fence.runId]); }
          catch { rejected = true; }
          finally { resolve({ output: { total: 2 } }); settleLate(); }
        }, 80);
        enterExecute();
      }) });
      const secondClaim = await late.service.claim(); if (!secondClaim) throw new Error('claim missing');
      const secondExecution = late.service.executeStep(secondClaim);
      await Promise.race([executeEntered, secondExecution.then(() => { throw new Error('Step stopped before execute entry'); })]);
      await vi.advanceTimersByTimeAsync(25);
      expect(await secondExecution).toBe('stopped');
      await vi.advanceTimersByTimeAsync(55); await lateSettled;
      expect(rejected).toBe(true);
      expect((await late.service.read(late.owner.principal, late.run.id)).failure).toBe('step_deadline');
      expect((await pool.query('SELECT revision FROM agent_run_contexts WHERE run_id=$1', [late.run.id])).rows[0].revision).toBe(0);
      expect((await pool.query('SELECT count(*)::int AS count FROM agent_tool_receipts WHERE run_id=$1', [late.run.id])).rows[0].count).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('paginates a timestamp tie without losing UUID order or PostgreSQL microseconds', async () => {
    const { owner, service, input } = await runFixture();
    for (let index = 0; index < 30; index++) await service.create(owner.principal, input, randomUUID());
    await pool.query("UPDATE agent_runs SET created_at='2026-10-14T12:00:00.123456Z' WHERE workspace_id=$1", [owner.workspaceId]);
    const first = await service.list(owner.principal, owner.workspaceId);
    expect(first.runs).toHaveLength(30); expect(first.nextCursor).not.toBeNull();
    const second = await service.list(owner.principal, owner.workspaceId, first.nextCursor!);
    expect(second.runs).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.runs, ...second.runs].map((run) => run.id)).size).toBe(31);
    await expect(service.list(owner.principal, owner.workspaceId, 'invalid-cursor')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('resumes an explicit durable continuation without replacing inputs or lifetime counters', async () => {
    const { owner, service, run } = await runFixture({ execute: async (_tx, input) => (input as { value: number }).value === 2
      ? { output: { total: 2 }, state: 'waiting_input', nextSteps: [{ tool: 'synthetic.calculate', version: 1, action: 'save', input: { value: 3 } }] }
      : { output: { total: 3 }, state: 'completed' } });
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    await service.executeStep(claim);
    await pool.query('UPDATE agent_runs SET request_count=12,spent_usd=0.4 WHERE id=$1', [run.id]);
    const paused = await service.read(owner.principal, run.id);
    expect(paused.actions.resume).toBe(true); expect(paused.steps[0]?.state).toBe('succeeded');
    await service.resume(owner.principal, run.id, { expectedEpoch: paused.epoch }, randomUUID());
    const continued = await service.claim(); if (!continued) throw new Error('claim missing');
    await service.executeStep(continued);
    const complete = await service.read(owner.principal, run.id);
    expect(complete.state).toBe('completed'); expect(complete.steps).toHaveLength(2); expect(complete.budget.requestCount).toBe(12);
    expect(complete.budget.spentUsd).toBe('0.400000000000'); expect(complete.deadlineAt).toBe(paused.deadlineAt);
  });
  it('persists assistant questions and answers, then supersedes changed goals with a bounded continuation chain', async () => {
    const owner = await scope();
    const service = createRunService(pool, assistantRegistry());
    const input = { workspaceId: owner.workspaceId, projectId: null, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Prepare a viable delivery offer', locale: 'en' as const, inputRefs: [] };
    const created = await service.create(owner.principal, input, randomUUID());
    const firstClaim = await service.claim(); if (!firstClaim) throw new Error('claim missing');
    await service.executeStep(firstClaim);
    const waiting = await service.read(owner.principal, created.id);
    expect(waiting).toMatchObject({ state: 'waiting_input', progress: { questions: [{ id: 'delivery_date', required: true }], answeredQuestions: [{ questionId: 'legacy_scope', answer: 'Keep the existing delivery scope.' }], decision: { outcome: 'conditional', options: [{ id: 'standard' }, { id: 'later' }] }, branches: [{ id: 'delivery_check', state: 'waiting_input' }] }, actions: { resume: true, revise: true } });
    expect(JSON.stringify(waiting)).not.toContain('must-never-leave-the-server');
    expect(JSON.stringify(waiting)).not.toContain('private model text');
    expect((await service.read(owner.principal, created.id)).progress.answeredQuestions).toEqual([{ questionId: 'legacy_scope', answer: 'Keep the existing delivery scope.' }]);
    const waitingEvents = await service.events(owner.principal, created.id);
    expect(waitingEvents.events.filter((event) => event.kind === 'branch_state').map((event) => event.branchState)).toEqual(['planned', 'waiting_input']);
    expect(waitingEvents.events.filter((event) => event.kind === 'projection_changed').map((event) => event.projectionRevision)).toEqual([0, 1]);
    expect(JSON.stringify(waitingEvents)).not.toContain('must-never-leave-the-server');
    const outsider = await scope();
    await expect(service.events(outsider.principal, created.id, waitingEvents.cursor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await service.resume(owner.principal, created.id, { expectedEpoch: waiting.epoch, answers: [{ questionId: 'delivery_date', answer: '2026-10-30' }] }, randomUUID());
    const secondClaim = await service.claim(); if (!secondClaim) throw new Error('claim missing');
    await service.executeStep(secondClaim);
    const completed = await service.read(owner.principal, created.id);
    expect(completed).toMatchObject({ state: 'completed', progress: { questions: [], answeredQuestions: [{ questionId: 'legacy_scope', answer: 'Keep the existing delivery scope.' }, { questionId: 'delivery_date', question: 'What delivery date is required?', answer: '2026-10-30' }], summary: 'Saved a reviewed result.' }, actions: { resume: false, revise: true } });
    expect((await service.read(owner.principal, created.id)).progress.answeredQuestions).toEqual(completed.progress.answeredQuestions);
    const continuedEvents = await service.events(owner.principal, created.id, waitingEvents.cursor);
    expect(continuedEvents.events.map((event) => event.sequence)).toEqual(continuedEvents.events.map((_event, index) => waitingEvents.cursor + index + 1));
    expect(continuedEvents.events.filter((event) => event.kind === 'branch_state').map((event) => event.branchState)).toEqual(['running', 'completed']);
    expect(continuedEvents.events.filter((event) => event.kind === 'projection_changed').map((event) => event.projectionRevision)).toEqual([2, 3]);

    const child = await service.resume(owner.principal, created.id, { expectedEpoch: completed.epoch, goal: 'Prepare the same offer for a later date', plan: ['Recheck capacity'] }, randomUUID());
    expect(child).toMatchObject({ state: 'queued', goal: 'Prepare the same offer for a later date', progress: { parentRunId: created.id } });
    const parent = await service.read(owner.principal, created.id);
    expect(parent.progress.continuationRunId).toBe(child.id); expect(parent.actions.revise).toBe(false);
    let tail = child;
    for (let depth = 2; depth <= 13; depth++) {
      const next = await service.resume(owner.principal, tail.id, { expectedEpoch: tail.epoch, goal: `Human follow-up ${depth}` }, randomUUID());
      expect(next.progress.parentRunId).toBe(tail.id);
      tail = next;
    }
    expect(tail.goal).toBe('Human follow-up 13');
    expect((await service.read(owner.principal, child.id)).state).toBe('cancelled');
  });
  it('fences cancellation while preparation is in flight and never commits the late result', async () => {
    let ready!: () => void; let release!: () => void; let effects = 0;
    const prepared = new Promise<void>((resolve) => { ready = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const { owner, service, run } = await runFixture({ prepare: async () => { ready(); await gate; }, execute: async () => { effects++; return { output: { total: 2 } }; } });
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    const execution = service.executeStep(claim); await prepared;
    const key = randomUUID(); const cancelled = await service.cancel(owner.principal, run.id, { expectedEpoch: claim.epoch }, key);
    expect((await service.cancel(owner.principal, run.id, { expectedEpoch: claim.epoch }, key)).epoch).toBe(cancelled.epoch);
    release(); await execution;
    expect(effects).toBe(0); expect((await service.read(owner.principal, run.id)).state).toBe('cancelled');
  });
  it('rechecks permission epoch after preparation and denies cross-workspace reads', async () => {
    let ready!: () => void; let release!: () => void;
    const prepared = new Promise<void>((resolve) => { ready = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const { owner, service, run } = await runFixture({ prepare: async () => { ready(); await gate; } });
    const other = await scope(); await expect(service.read(other.principal, run.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    const execution = service.executeStep(claim); await prepared;
    await pool.query('UPDATE identity_workspaces SET authz_version=authz_version+1 WHERE id=$1', [owner.workspaceId]);
    release(); await execution;
    expect((await service.read(owner.principal, run.id))).toMatchObject({ state: 'failed', failure: 'access_changed' });
  });
  it('stops a claim immediately when authorization or a tool version disappears before execution', async () => {
    const revoked = await runFixture(); const claim = await revoked.service.claim(); if (!claim) throw new Error('claim missing');
    await pool.query('UPDATE identity_workspaces SET authz_version=authz_version+1 WHERE id=$1', [revoked.owner.workspaceId]);
    expect(await revoked.service.executeStep(claim)).toBe('stopped');
    expect(await revoked.service.read(revoked.owner.principal, revoked.run.id)).toMatchObject({ state: 'failed', failure: 'access_changed' });
    const missing = await runFixture(); const second = await missing.service.claim(); if (!second) throw new Error('claim missing');
    await pool.query('UPDATE agent_run_steps SET tool_version=2 WHERE run_id=$1', [missing.run.id]);
    expect(await missing.service.executeStep(second)).toBe('stopped');
    expect(await missing.service.read(missing.owner.principal, missing.run.id)).toMatchObject({ state: 'waiting_input', failure: 'configuration', actions: { resume: true } });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_runs WHERE state=\'running\'')).rows[0].count).toBe(0);
  });
  it('does not stop the active worker when the same claim is delivered twice', async () => {
    let entered!: () => void; let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const { service, owner, run } = await runFixture({ prepare: async () => { entered(); await gate; } });
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    const first = service.executeStep(claim); await ready;
    expect(await service.executeStep(claim)).toBe('stopped');
    expect((await service.read(owner.principal, run.id)).state).toBe('running');
    release(); expect(await first).toBe('continue'); expect(await service.executeStep(claim)).toBe('stopped');
    expect((await service.read(owner.principal, run.id)).state).toBe('completed');
  });
  it('expires queued lifetime deadlines in bounded batches without resetting progress or counters', async () => {
    const fixtures = [await runFixture(), await runFixture(), await runFixture()];
    await pool.query("UPDATE agent_runs SET started_at=now()-interval '11 minutes',deadline_at=now()-interval '1 second',request_count=3,spent_usd=0.1 WHERE id=ANY($1::uuid[])", [fixtures.map((fixture) => fixture.run.id)]);
    expect(await fixtures[0]!.service.claim()).toBeNull();
    const ledger = createBudgetLedger(pool);
    expect(await ledger.recoverExpired(1)).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM agent_runs WHERE state='queued'")).rows[0].count).toBe(2);
    expect(await ledger.recoverExpired(2)).toHaveLength(2);
    for (const { owner, service, run } of fixtures) {
      const stopped = await service.read(owner.principal, run.id);
      expect(stopped).toMatchObject({ state: 'waiting_input', failure: 'run_deadline', budget: { requestCount: 3, spentUsd: '0.100000000000' }, actions: { resume: false } });
      expect(stopped.epoch).toBeGreaterThan(run.epoch); expect(stopped.steps[0]?.state).toBe('skipped');
      expect((await service.events(owner.principal, run.id)).events.some((event) => event.failure === 'run_deadline')).toBe(true);
    }
  });
  it('round-robins tenants and atomically enforces two workspace/eight global claims', async () => {
    const service = createRunService(pool, registry()); const owners = [];
    for (let workspace = 0; workspace < 5; workspace++) {
      const owner = await scope(); owners.push(owner);
      for (let index = 0; index < 3; index++) await service.create(owner.principal, { workspaceId: owner.workspaceId, projectId: null, capabilityId: 'runtime.synthetic', capabilityVersion: 1, goal: 'Fair queue synthetic', locale: 'en', inputRefs: [] }, randomUUID());
    }
    const claims = await Promise.all(Array.from({ length: 12 }, () => service.claim()));
    expect(claims.filter(Boolean)).toHaveLength(8);
    const active = (await pool.query("SELECT workspace_id,count(*)::int AS count FROM agent_runs WHERE state='running' GROUP BY workspace_id")).rows;
    expect(active).toHaveLength(5); expect(active.every((row) => row.count <= 2)).toBe(true);
    expect(owners).toHaveLength(5);
  });
});
describe('authoritative provider liability ledger', () => {
  it('requires the independent approved route and a matching enabled persistent proof at reserve and dispatch', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    const original = reservation('approved');
    await expect(ledger.reserve({ ...original, pricing: { ...original.pricing, model: 'openai/gpt-5', endpoint: 'openai' } })).rejects.toMatchObject({ failure: 'model_forbidden' });
    await pool.query("UPDATE agent_model_endpoints SET state='disabled'");
    await expect(ledger.reserve(original)).rejects.toMatchObject({ failure: 'model_unproven' });
    await pool.query("UPDATE agent_model_endpoints SET state='enabled'");
    await expect(ledger.reserve({ ...original, pricing: { ...original.pricing, inputUsd: '0.00000001' } })).rejects.toMatchObject({ failure: 'price_unknown' });
    const pending = await ledger.reserve(original);
    await pool.query("UPDATE agent_model_endpoints SET state='disabled'");
    await expect(ledger.dispatch(fence, pending.usage.id)).rejects.toMatchObject({ failure: 'model_unproven' });
    expect((await pool.query('SELECT state FROM agent_run_usage WHERE id=$1', [pending.usage.id])).rows[0].state).toBe('released');
    expect((await pool.query('SELECT reserved_usd FROM agent_budget_authorizations WHERE id=$1', [grantId])).rows[0].reserved_usd).toBe('0.000000000000');
  });
  it('limits candidate proof to its trusted run purpose without enabling normal product use', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    const candidate: PricingSnapshot = { ...currentPrice, proof: 'unproven', proofRef: null };
    await registerPrice(candidate, 'candidate');
    const input = { ...reservation('candidate'), pricing: candidate };
    await expect(ledger.reserve(input)).rejects.toMatchObject({ failure: 'model_unproven' });
    const proofLedger = createBudgetLedger(pool, { allowedRoutes, proofRunId: fence.runId });
    await expect(proofLedger.reserve(input)).rejects.toMatchObject({ failure: 'model_unproven' });
    await pool.query('UPDATE agent_runs SET capability_id=$2 WHERE id=$1', [fence.runId, MODEL_PROOF_CAPABILITY]);
    for (const key of ['candidate_first', 'candidate_second']) {
      const accepted = await proofLedger.reserve({ ...input, operationKey: key, attemptKey: key, inputHash: hash({ key }) });
      await proofLedger.dispatch(fence, accepted.usage.id);
      await proofLedger.settle(accepted.usage.id, { state: 'succeeded', actualUsd: '0.01', inputTokens: 1, outputTokens: 1, output: { content: 'synthetic', toolCalls: [] } });
    }
    await expect(proofLedger.reserve({ ...input, operationKey: 'candidate_third', attemptKey: 'candidate_third', inputHash: hash({ key: 'third' }) })).rejects.toMatchObject({ failure: 'request_limit' });
    expect((await pool.query('SELECT state,proof_state FROM agent_model_endpoints')).rows[0]).toEqual({ state: 'candidate', proof_state: 'unproven' });
  });
  it('reserves once under concurrency and allows only one dispatch', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    const results = await Promise.all([ledger.reserve(reservation('same')), ledger.reserve(reservation('same'))]);
    expect(results[0]?.usage.id).toBe(results[1]?.usage.id);
    const id = results[0]!.usage.id;
    const attempts = await Promise.allSettled([ledger.dispatch(fence, id), ledger.dispatch(fence, id)]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await pool.query('SELECT request_count,reserved_usd FROM agent_runs WHERE id=$1', [fence.runId])).rows[0]).toEqual({ request_count: 1, reserved_usd: '0.100000000000' });
  });
  it('reuses a saved model result after lease recovery despite new epochs, rates, model selection, or unavailable metadata', async () => {
    const { ledger, reservation, fence, service, owner } = await claimedFixture();
    const original = reservation('durable_operation'); const { usage } = await ledger.reserve(original);
    const output = { content: 'Synthetic committed answer', toolCalls: [] };
    await ledger.dispatch(fence, usage.id);
    await ledger.settle(usage.id, { state: 'succeeded', actualUsd: '0.012345678901', inputTokens: 20, outputTokens: 4, output });
    await pool.query("UPDATE agent_runs SET lease_until=now()-interval '1 second' WHERE id=$1", [fence.runId]);
    await ledger.recoverExpired();
    const paused = await service.read(owner.principal, fence.runId);
    expect(paused.state).toBe('queued');
    const claim = await service.claim(); if (!claim) throw new Error('claim missing');
    const begun = await service.beginStep(claim); if (!begun) throw new Error('step missing');
    const nextFence = { ...claim, stepId: begun.step.id };
    expect(nextFence.epoch).toBeGreaterThan(fence.epoch); expect(nextFence.stepId).toBe(fence.stepId);
    expect(await ledger.lookupOperation({ fence: nextFence, operationKey: original.operationKey, inputHash: original.inputHash })).toMatchObject({ usage: { id: usage.id }, output });
    const changed = { ...original, fence: nextFence, attemptKey: 'later_epoch', pricing: { ...original.pricing, model: 'synthetic/changed', endpoint: 'synthetic/changed-route', requestUsd: '0.3', proof: 'unproven' as const, expiresAt: new Date(0).toISOString() } };
    expect(await ledger.reserve(changed)).toMatchObject({ usage: { id: usage.id }, replay: true, output });
    await expect(ledger.reserve({ ...changed, inputHash: hash({ changed: true }) })).rejects.toMatchObject({ failure: 'conflict' });
    expect((await pool.query('SELECT request_count,reserved_usd,spent_usd FROM agent_runs WHERE id=$1', [fence.runId])).rows[0]).toEqual({ request_count: 1, reserved_usd: '0.000000000000', spent_usd: '0.012345678901' });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_run_usage WHERE run_id=$1', [fence.runId])).rows[0].count).toBe(1);
  });
  it('allows an explicit retry to replay a settled model output rejected by local validation', async () => {
    const { ledger, reservation, fence, service, owner } = await claimedFixture();
    const operation = reservation('settled_invalid_result');
    const { usage } = await ledger.reserve(operation);
    const output = { content: null, toolCalls: [{ id: 'read', name: 'read_artifact', arguments: '{"revision":"1"}' }] };
    await ledger.dispatch(fence, usage.id);
    await ledger.settle(usage.id, { state: 'succeeded', actualUsd: '0.01', inputTokens: 10, outputTokens: 3, output });
    await pool.query("UPDATE agent_run_steps SET state='failed',failure_code='invalid_result',retryable=false,finished_at=now() WHERE id=$1", [fence.stepId]);
    await pool.query("UPDATE agent_runs SET state='waiting_input',failure_code='invalid_result',lease_owner=NULL,lease_until=NULL WHERE id=$1", [fence.runId]);
    const paused = await service.read(owner.principal, fence.runId);
    expect(paused.actions).toMatchObject({ resume: true, retryStepIds: [fence.stepId] });
    const resumed = await service.resume(owner.principal, fence.runId, { expectedEpoch: paused.epoch, stepId: fence.stepId }, randomUUID());
    expect(resumed).toMatchObject({ state: 'queued', failure: null });
    expect(resumed.steps.find((step) => step.id === fence.stepId)).toMatchObject({ state: 'planned', failure: null });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_run_usage WHERE run_id=$1', [fence.runId])).rows[0].count).toBe(1);
  });
  it('keeps released attempt history bound to its input and route while allowing an explicit known-rejected retry', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    const original = reservation('known_rejected'); const first = await ledger.reserve(original);
    await ledger.dispatch(fence, first.usage.id); await ledger.settle(first.usage.id, { state: 'released', knownRejected: true });
    const retry = { ...original, attemptKey: 'known_rejected_retry', pricing: { ...original.pricing, requestUsd: '0.11' }, reservedUsd: '0.11' };
    await expect(ledger.reserve({ ...retry, inputHash: hash({ changed: true }) })).rejects.toMatchObject({ failure: 'conflict' });
    await expect(ledger.lookupOperation({ ...original, inputHash: hash({ changed: true }) })).rejects.toMatchObject({ failure: 'conflict' });
    await expect(ledger.reserve({ ...retry, pricing: { ...retry.pricing, model: 'synthetic/other' } })).rejects.toMatchObject({ failure: 'model_forbidden' });
    await expect(ledger.reserve({ ...retry, pricing: { ...retry.pricing, endpoint: 'synthetic/other' } })).rejects.toMatchObject({ failure: 'model_forbidden' });
    await registerPrice(retry.pricing);
    const second = await ledger.reserve(retry);
    expect(second.usage.id).not.toBe(first.usage.id); expect(second.usage.operation_key).toBe(first.usage.operation_key);
    await ledger.dispatch(fence, second.usage.id); await ledger.settle(second.usage.id, { state: 'ambiguous' });
    await expect(ledger.lookupOperation(original)).rejects.toMatchObject({ failure: 'ambiguous_charge' });
    await expect(ledger.reserve({ ...retry, attemptKey: 'unsafe_third_attempt' })).rejects.toMatchObject({ failure: 'ambiguous_charge' });
    expect((await pool.query('SELECT request_count,reserved_usd FROM agent_runs WHERE id=$1', [fence.runId])).rows[0]).toEqual({ request_count: 2, reserved_usd: '0.110000000000' });
  });
  it('does not replace a pending quote or resend a billable result without validated output', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    const original = reservation('pending_quote'); const { usage } = await ledger.reserve(original);
    await expect(ledger.reserve({ ...original, pricing: { ...original.pricing, requestUsd: '0.12' }, reservedUsd: '0.12' })).rejects.toMatchObject({ failure: 'price_unknown' });
    expect((await ledger.lookupOperation(original))?.usage.id).toBe(usage.id);
    await ledger.dispatch(fence, usage.id); await ledger.settle(usage.id, { state: 'succeeded', actualUsd: '0.01', inputTokens: 1, outputTokens: 1 });
    await expect(ledger.lookupOperation(original)).rejects.toMatchObject({ failure: 'invalid_result' });
    await expect(ledger.reserve({ ...original, attemptKey: 'another_attempt' })).rejects.toMatchObject({ failure: 'invalid_result' });
    expect((await pool.query('SELECT request_count,reserved_usd,spent_usd FROM agent_runs WHERE id=$1', [fence.runId])).rows[0]).toEqual({ request_count: 1, reserved_usd: '0.000000000000', spent_usd: '0.010000000000' });
  });
  it('rejects under-reservation, a third model branch, and workspace daily exhaustion', async () => {
    const { ledger, reservation, owner } = await claimedFixture();
    await expect(ledger.reserve(reservation('too-small', '0.01'))).rejects.toMatchObject({ failure: 'price_unknown' });
    await pool.query("INSERT INTO agent_budget_days(scope,scope_key,day,spent_usd) VALUES('workspace',$1,(now() AT TIME ZONE 'UTC')::date,1.95)", [owner.workspaceId]);
    await expect(ledger.reserve(reservation('workspace'))).rejects.toMatchObject({ failure: 'workspace_budget' });
    await pool.query('DELETE FROM agent_budget_days');
    await ledger.reserve(reservation('first')); await ledger.reserve(reservation('second'));
    await expect(ledger.reserve(reservation('third'))).rejects.toMatchObject({ failure: 'branch_limit' });
  });
  it('releases reserved liabilities after cancellation or permission revocation, but never a dispatched one', async () => {
    const { ledger, reservation, fence, service, owner } = await claimedFixture();
    const pending = await ledger.reserve(reservation('pending')); const sent = await ledger.reserve(reservation('sent'));
    await ledger.dispatch(fence, sent.usage.id);
    const cancelled = await service.cancel(owner.principal, fence.runId, { expectedEpoch: fence.epoch }, randomUUID());
    expect(cancelled.budget.reservedUsd).toBe('0.100000000000');
    expect((await pool.query('SELECT state FROM agent_run_usage WHERE id=$1', [pending.usage.id])).rows[0].state).toBe('released');
    expect((await pool.query('SELECT state FROM agent_run_usage WHERE id=$1', [sent.usage.id])).rows[0].state).toBe('dispatched');
    await expect(ledger.dispatch(fence, pending.usage.id)).rejects.toMatchObject({ failure: 'lease_lost' });
    const other = await claimedFixture(); const reserved = await other.ledger.reserve(other.reservation('revoked'));
    await pool.query('UPDATE identity_workspaces SET authz_version=authz_version+1 WHERE id=$1', [other.owner.workspaceId]);
    await expect(other.ledger.dispatch(other.fence, reserved.usage.id)).rejects.toThrow();
    expect((await pool.query('SELECT state FROM agent_run_usage WHERE id=$1', [reserved.usage.id])).rows[0].state).toBe('released');
  });
  it('rechecks a closed authorization at dispatch and recovers orphaned undispatched reservations', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    const pending = await ledger.reserve(reservation('closed'));
    await pool.query("UPDATE agent_budget_authorizations SET state='closed' WHERE id=$1", [grantId]);
    await expect(ledger.dispatch(fence, pending.usage.id)).rejects.toMatchObject({ failure: 'configuration' });
    expect((await pool.query('SELECT reserved_usd FROM agent_budget_authorizations WHERE id=$1', [grantId])).rows[0].reserved_usd).toBe('0.000000000000');
    await pool.query("UPDATE agent_budget_authorizations SET state='active' WHERE id=$1", [grantId]);
    const abandoned = await ledger.reserve(reservation('abandoned'));
    await pool.query("UPDATE agent_runs SET state='cancelled',finished_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1", [fence.runId]);
    await ledger.recoverExpired();
    expect((await pool.query('SELECT state FROM agent_run_usage WHERE id=$1', [abandoned.usage.id])).rows[0].state).toBe('released');
    expect((await pool.query('SELECT reserved_usd FROM agent_runs WHERE id=$1', [fence.runId])).rows[0].reserved_usd).toBe('0.000000000000');
  });
  it('holds uncertainty across UTC midnight and reconciles actual cost after cancellation', async () => {
    const { ledger, reservation, fence, service, owner } = await claimedFixture();
    const { usage } = await ledger.reserve(reservation('late')); await ledger.dispatch(fence, usage.id); await ledger.settle(usage.id, { state: 'ambiguous' });
    await service.cancel(owner.principal, fence.runId, { expectedEpoch: fence.epoch }, randomUUID());
    await pool.query("UPDATE agent_run_usage SET budget_day=budget_day-1 WHERE id=$1", [usage.id]);
    await pool.query('UPDATE agent_budget_days SET day=day-1');
    await ledger.settle(usage.id, { state: 'succeeded', actualUsd: '0.012345678901', inputTokens: 20, outputTokens: 4, output: { content: 'synthetic', toolCalls: [] } });
    expect((await pool.query('SELECT state,reserved_usd,spent_usd FROM agent_runs WHERE id=$1', [fence.runId])).rows[0]).toEqual({ state: 'cancelled', reserved_usd: '0.000000000000', spent_usd: '0.012345678901' });
    expect((await pool.query('SELECT reserved_usd,spent_usd FROM agent_budget_authorizations WHERE id=$1', [grantId])).rows[0]).toEqual({ reserved_usd: '0.000000000000', spent_usd: '0.012345678901' });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_model_outputs WHERE usage_id=$1', [usage.id])).rows[0].count).toBe(1);
  });
  it('does not reset global authorization, daily debt, or run lifetime limits', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    await pool.query('UPDATE agent_budget_authorizations SET spent_usd=9.95 WHERE id=$1', [grantId]);
    await expect(ledger.reserve(reservation('grant'))).rejects.toMatchObject({ failure: 'authorization_budget' });
    await pool.query('UPDATE agent_budget_authorizations SET spent_usd=0 WHERE id=$1', [grantId]);
    await pool.query("INSERT INTO agent_budget_days(scope,scope_key,day,reserved_usd) VALUES('deployment','deployment',current_date-1,4.95)");
    await expect(ledger.reserve(reservation('day'))).rejects.toMatchObject({ failure: 'deployment_budget' });
    await pool.query('DELETE FROM agent_budget_days');
    await pool.query('UPDATE agent_runs SET request_count=12 WHERE id=$1', [fence.runId]);
    await expect(ledger.reserve(reservation('requests'))).rejects.toMatchObject({ failure: 'request_limit' });
    await pool.query('UPDATE agent_runs SET request_count=0,spent_usd=0.45 WHERE id=$1', [fence.runId]);
    await expect(ledger.reserve(reservation('run'))).rejects.toMatchObject({ failure: 'run_budget' });
  });
  it('accounts for provider overage honestly and refuses future spending', async () => {
    const { ledger, reservation, fence } = await claimedFixture(); const { usage } = await ledger.reserve(reservation('overage'));
    await ledger.dispatch(fence, usage.id); await ledger.settle(usage.id, { state: 'succeeded', actualUsd: '0.51', inputTokens: 1, outputTokens: 1 });
    await expect(ledger.reserve(reservation('after'))).rejects.toMatchObject({ failure: 'price_exceeded' });
    expect((await pool.query('SELECT spent_usd FROM agent_budget_authorizations WHERE id=$1', [grantId])).rows[0].spent_usd).toBe('0.510000000000');
  });
  it('quarantines a disproven quote below the run cap and never caches its output or dispatches another reservation', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    const first = await ledger.reserve(reservation('first')); const pending = await ledger.reserve(reservation('pending'));
    await ledger.dispatch(fence, first.usage.id);
    await ledger.settle(first.usage.id, { state: 'succeeded', actualUsd: '0.12', inputTokens: 1, outputTokens: 1, output: { content: 'Must not replay', toolCalls: [] } });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_model_outputs WHERE usage_id=$1', [first.usage.id])).rows[0].count).toBe(0);
    expect((await pool.query('SELECT state,quarantine_usage_id FROM agent_model_endpoints')).rows[0]).toEqual({ state: 'quarantined', quarantine_usage_id: first.usage.id });
    await expect(ledger.lookupOperation(reservation('first'))).rejects.toMatchObject({ failure: 'price_exceeded' });
    await expect(ledger.dispatch(fence, pending.usage.id)).rejects.toMatchObject({ failure: 'price_exceeded' });
    const other = await claimedFixture();
    await expect(other.ledger.reserve(other.reservation('different_workspace'))).rejects.toMatchObject({ failure: 'price_exceeded' });
    expect((await pool.query('SELECT reserved_usd,spent_usd FROM agent_budget_authorizations WHERE id=$1', [grantId])).rows[0]).toEqual({ reserved_usd: '0.000000000000', spent_usd: '0.120000000000' });
  });
  it('recovers an expired lease without replaying dispatched requests and fences the old worker', async () => {
    const { ledger, reservation, fence, service, owner } = await claimedFixture();
    const safe = await ledger.reserve(reservation('safe')); const unknown = await ledger.reserve(reservation('unknown'));
    await ledger.dispatch(fence, unknown.usage.id);
    await pool.query("UPDATE agent_runs SET lease_until=now()-interval '1 second' WHERE id=$1", [fence.runId]);
    expect(await ledger.recoverExpired()).toContain(fence.runId);
    const states = (await pool.query('SELECT id,state FROM agent_run_usage WHERE run_id=$1', [fence.runId])).rows;
    expect(states).toContainEqual({ id: safe.usage.id, state: 'released' }); expect(states).toContainEqual({ id: unknown.usage.id, state: 'ambiguous' });
    const run = await service.read(owner.principal, fence.runId); expect(run.failure).toBe('ambiguous_charge'); expect(run.actions.resume).toBe(false);
    await expect(ledger.dispatch(fence, safe.usage.id)).rejects.toMatchObject({ failure: 'lease_lost' });
    await expect(service.resume(owner.principal, fence.runId, { expectedEpoch: run.epoch }, randomUUID())).rejects.toThrow();
  });
  it('rejects false refunds, changed reconciliation, and foreign grant keys', async () => {
    const { ledger, reservation, fence } = await claimedFixture();
    await expect(ledger.reserve({ ...reservation('wrong-key'), keyFingerprint: 'f'.repeat(64) })).rejects.toMatchObject({ failure: 'configuration' });
    const { usage } = await ledger.reserve(reservation('refund')); await ledger.dispatch(fence, usage.id); await ledger.settle(usage.id, { state: 'ambiguous' });
    await expect(ledger.settle(usage.id, { state: 'released', knownRejected: true })).rejects.toMatchObject({ failure: 'ambiguous_charge' });
    await ledger.settle(usage.id, { state: 'succeeded', actualUsd: '0.01', inputTokens: 1, outputTokens: 1 });
    await expect(ledger.settle(usage.id, { state: 'succeeded', actualUsd: '0.02', inputTokens: 1, outputTokens: 1 })).rejects.toMatchObject({ failure: 'conflict' });
  });
});
