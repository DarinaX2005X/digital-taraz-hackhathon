import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { businessRegistration, type BusinessToolExtension } from '../../src/features/agent-tools/server/business';
import { createRunRegistry } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { createRunHandlers } from '../../src/features/runs/server/handlers';
import type { ModelOutput, ModelRequest } from '../../src/features/runs/server/gateway';
import { createSourceService } from '../../src/features/sources/server/service';
import { LocalSourceStorage } from '../../src/features/sources/server/storage';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { RunSchema } from '../../src/contracts/runs';
import { createArtifactTargetResolver } from '../../src/features/artifacts/domain/targets';
import { OperationsCheckInputSchema, OperationsDecisionSchema, type DecisionOptionDraft } from '../../src/features/commercial/domain/decision';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';
import { businessWorkToolExtension } from '../../src/features/agent-tools/server/business-work-adapter';
import { materialContextBusinessToolExtension } from '../../src/features/agent-tools/server/material-context';
import { BusinessWorkResultSchema, type BusinessWorkToolDescriptor } from '../../src/contracts/business-work';
import { ProposeWorkPlanInputSchema } from '../../src/features/operations/domain/propose-work-plan';
import { operationsBusinessTools } from '../../src/features/operations/server/ai-business-tool';
import { excerptArtifact } from '../../src/features/agent-tools/server/artifact-context';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

const call = (name: string, args: unknown, id = name): ModelOutput => ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const calls = (...items: { name: string; args: unknown; id?: string }[]): ModelOutput => ({ content: null, toolCalls: items.map((item) => ({ id: item.id ?? item.name, name: item.name, arguments: JSON.stringify(item.args) })) });
const verified = (): ModelOutput => ({ content: JSON.stringify({ verdict: 'ready', findings: [] }), toolCalls: [] });

const fixtureOperationsExtension: BusinessToolExtension = () => [{
  name: 'assess_delivery_date',
  description: 'Check a requested date against the pinned opening date and exact available minutes. Return a typed decision and editable plan; never book resources.',
  schema: OperationsCheckInputSchema, output: OperationsDecisionSchema, action: 'calculate', costClass: 'local',
  effect: async (_tx, raw, _context, state) => {
    const input = OperationsCheckInputSchema.parse(raw), selected = new Set(input.availabilitySourceIds);
    const availabilitySources = state.sources.filter((source) => selected.has(source.sourceRef.sourceId));
    const text = availabilitySources.flatMap((source) => source.fragments.flatMap((fragment) => [fragment.text ?? '', ...(fragment.values ?? [])])).join('\n');
    const capacityToken = text.match(/available minutes[^0-9]*(\d+)/i)?.[1];
    const availableMinutes = capacityToken ? Number(capacityToken) : null;
    const requiredMinutes = input.planDraft?.tasks.reduce((total, task) => total + (task.effortMinutes ?? task.durationMinutes ?? 0), 0) ?? null;
    const sourceRefs = availabilitySources.map((source) => source.sourceRef);
    const dateConflict = input.openingDate !== null && input.openingDate > input.requestedDate;
    const capacityUnknown = availableMinutes === null || requiredMinutes === null || requiredMinutes === 0;
    const overCapacity = !capacityUnknown && requiredMinutes! > availableMinutes!;
    const capacityEvidence = capacityUnknown
      ? { origin: 'missing' as const, resourceId: '00000000-0000-4000-8000-000000000099', availabilityVersionId: null, verifiedAt: null, sourceRefs: [] as [] }
      : { origin: 'source' as const, resourceId: '00000000-0000-4000-8000-000000000099', availabilityVersionId: '00000000-0000-4000-8000-000000000098', verifiedAt: '2026-10-15T00:00:00.000Z', sourceRefs };
    const reasons = dateConflict
      ? [{ code: 'opens_after_deadline', message: `Opening date ${input.openingDate} is after requested date ${input.requestedDate}.`, sourceRefs, question: null }]
      : capacityUnknown
        ? [{ code: 'missing_availability', message: 'Available team minutes are not confirmed for the requested window.', sourceRefs, question: 'How many team minutes are available before the requested date?' }]
        : overCapacity
          ? [{ code: 'capacity_shortfall', message: `The work needs ${requiredMinutes} minutes but only ${availableMinutes} are available.`, sourceRefs, question: null }]
          : [];
    const verdict = dateConflict || overCapacity ? 'cannot-meet' as const : capacityUnknown ? 'cannot-confirm' as const : 'can-meet' as const;
    const content = input.planDraft && verdict === 'can-meet' ? {
      kind: 'plan' as const, schemaVersion: 1 as const, timezone: input.planDraft.timezone,
      entries: input.planDraft.tasks.map((task) => ({
        id: task.id, title: task.title, status: 'todo' as const,
        ...(task.startDate && task.endDate ? { startDate: task.startDate, endDate: task.endDate } : {}),
        ...(task.startAt && task.endAt ? { startAt: task.startAt, endAt: task.endAt } : {}),
        resourceIds: task.resourceIds, dependencies: task.dependencies,
        ...(task.effortMinutes ? { effort: { decimal: String(task.effortMinutes), unit: 'minute' } } : {}),
        ...(task.durationMinutes ? { durationMinutes: task.durationMinutes } : {}),
        checklist: [], availabilityVersionIds: availabilitySources.map((source) => source.sourceRef.sourceVersionId),
      })),
    } : null;
    const result = OperationsDecisionSchema.parse({
      assessmentId: input.assessmentId, optionId: input.optionId, request: input, verdict,
      requestedDate: input.requestedDate, openingDate: input.openingDate,
      earliestCompletionDate: verdict === 'can-meet' ? input.planDraft?.tasks.at(-1)?.endDate ?? null : null,
      reasons, conditions: [], capacity: [{ scope: input.optionId, requiredMinutes, availableMinutes, evidence: capacityEvidence }],
      alternatives: dateConflict ? [{ code: 'reschedule_after_opening', message: 'Use a date after opening.', entryIds: input.planDraft?.tasks.map((task) => task.id) ?? [], suggestedDate: input.openingDate, sourceRefs }] : overCapacity ? [{ code: 'reduce_scope', message: 'Reduce scope or add evidenced availability.', entryIds: input.planDraft?.tasks.map((task) => task.id) ?? [], suggestedDate: null, sourceRefs }] : [],
      planDraft: content ? { title: `${input.optionId} operational plan`, content, sourceRefs } : null,
    });
    return { output: result, context: { ...state, operations: [...state.operations.filter((item) => item.assessmentId !== result.assessmentId), result], decision: null, bundle: null } };
  },
}];
const nativePlanExtension: BusinessToolExtension = (services) => operationsBusinessTools(services).filter((tool) => tool.name === 'create_plan');

type SetupOptions = { failLinks?: boolean; availability?: string; catalog?: string; gateway?: (request: ModelRequest) => Promise<ModelOutput>; extensions?: BusinessToolExtension[] };
async function setup(options: SetupOptions = {}) {
  const fixture = await artifactFixture(pool);
  const input = { workspaceId: fixture.workspaceId, projectId: fixture.projectId, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Check whether we can deliver 2 custom service units by 2026-11-05 without a loss, show options and prepare a reply.', locale: 'en' as const, inputRefs: [] as { kind: 'source'; id: string; revision: number }[] };
  const uploaded: Record<string, { kind: 'source'; id: string; revision: number }> = {};
  const sourceService = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'business-tests', randomUUID())));
  const upload = async (title: string, content: string, attach = true) => {
    const bytes = Buffer.from(content);
    const initialized = await sourceService.init(fixture.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: fixture.workspaceId, projectId: fixture.projectId, title, fileName: `${title}.txt`, format: 'text', size: bytes.length }));
    await sourceService.put(fixture.owner, fixture.workspaceId, initialized.upload.id, initialized.token!, new Blob([new Uint8Array(bytes)]).stream());
    const completed = await sourceService.finalize(fixture.owner, fixture.workspaceId, initialized.upload.id);
    const ref = { kind: 'source' as const, id: completed.upload.sourceId, revision: 1 };
    if (attach) { input.inputRefs.push(ref); uploaded[title] = ref; }
    return ref;
  };
  await upload('Request', 'Need 2 custom service units by 2026-11-05.');
  await upload('Catalog', options.catalog ?? 'Standard service 1250 KZT. Accelerated service 1500 KZT.');
  await upload('Conditions', 'Direct costs cover labor and materials. Unit direct cost is 900 KZT. Delivery is excluded and billed separately.');
  await upload('Availability', options.availability ?? 'Workshop opens 2026-11-01. Available minutes before 2026-11-05: 960.');

  const complete = vi.fn(options.gateway ?? createDecisionGateway());
  const registration = businessRegistration(pool, { gateway: { complete }, extensions: [fixtureOperationsExtension, ...(options.extensions ?? [])], ...(options.failLinks ? { registerOfferLinks: async () => { throw new Error('SYNTHETIC_AFTER_ARTIFACTS_BEFORE_RECEIPT'); } } : {}) });
  const registry = createRunRegistry([registration.capability], registration.tools), service = createRunService(pool, registry);
  const handle = createRunHandlers({ pool, service, registry, origin: 'http://localhost:3000', wake: async () => undefined, getActor: async () => ({ user: { id: fixture.owner.userId, name: 'Synthetic owner', email: 'synthetic@example.test', locale: 'en' }, session: { id: fixture.owner.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } }) });
  const request = (suffix: string, body?: unknown, key = randomUUID()) => handle(new Request(`http://localhost:3000/api/runs${suffix}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:3000', 'X-Tirlik-User-Id': fixture.owner.userId, 'Idempotency-Key': key, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const drain = async (runId: string) => {
    const claim = await service.claim(); expect(claim?.runId).toBe(runId);
    for (let i = 0; i < 40; i++) if (await service.executeStep(claim!) === 'stopped') return service.read(fixture.owner, runId);
    throw new Error('SYNTHETIC_STEP_BOUND');
  };
  return { ...fixture, registry, service, input, request, drain, complete, upload, uploaded };
}

function contextOf(request: ModelRequest) {
  return JSON.parse(request.messages[1]!.content!) as {
    goal: string; requiredArtifactKinds: string[]; answers: { questionId: string; question?: string; answer: string }[]; plan: string[];
    currentArtifact: { id: string; revision: number } | null;
    sources: { sourceRef: { sourceId: string; sourceVersionId: string; revision: number }; title: string; fragments: { id: string; text?: string; values?: string[] }[] }[];
    artifacts: { artifactId: string; revision: number; kind: string; targets: { targetId: string; targetProperty: 'value' | 'text' | 'fill'; text: string; locked: boolean }[] }[];
    operations: { assessmentId: string }[]; decision: { blockers: { id: string; userResolvable: boolean }[] } | null; selectedOptionId: string | null; bundle: unknown;
    savedResults: { id: string; title: string }[];
  };
}
function sourceFact(context: ReturnType<typeof contextOf>, title: string, token: string) {
  const source = context.sources.find((item) => item.title === title)!;
  const fragment = source.fragments.find((item) => [item.text ?? '', ...(item.values ?? [])].some((value) => value.includes(token)))!;
  return { source, fragment };
}
function operationInput(context: ReturnType<typeof contextOf>, optionId: 'standard' | 'accelerated') {
  const request = sourceFact(context, 'Request', '2026-11-05'), availability = sourceFact(context, 'Availability', 'opens');
  const opening = (availability.fragment.text ?? availability.fragment.values?.join(' ') ?? '').match(/opens\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  return {
    assessmentId: `capacity_${optionId}`, optionId, requestedDate: '2026-11-05', requestedDateEvidence: { origin: 'source', sourceId: request.source.sourceRef.sourceId, artifactId: null, fragmentId: request.fragment.id, raw: '2026-11-05' },
    openingDate: opening, openingDateEvidence: opening ? { origin: 'source', sourceId: availability.source.sourceRef.sourceId, artifactId: null, fragmentId: availability.fragment.id, raw: opening } : null,
    availabilitySourceIds: [availability.source.sourceRef.sourceId], planArtifact: null,
    planDraft: { timezone: 'Asia/Qyzylorda', tasks: [{ id: `${optionId}_work`, title: optionId === 'standard' ? 'Prepare standard scope' : 'Prepare accelerated scope', durationMinutes: optionId === 'standard' ? 480 : 360, effortMinutes: optionId === 'standard' ? 480 : 360, resourceIds: [], dependencies: [], sourceRefs: [request.source.sourceRef], startDate: '2026-11-02', endDate: optionId === 'standard' ? '2026-11-04' : '2026-11-03', startAt: null, endAt: null }] },
  };
}
function optionInput(context: ReturnType<typeof contextOf>, optionId: 'standard' | 'accelerated'): DecisionOptionDraft {
  const request = sourceFact(context, 'Request', '2'), conditions = sourceFact(context, 'Conditions', '900');
  const catalogSource = context.sources.find((item) => item.title === 'Catalog')!, catalog = { source: catalogSource, fragment: catalogSource.fragments[0]! };
  const price = optionId === 'standard' ? (catalog.fragment.text ?? '').includes('1250') ? '1250' : null : (catalog.fragment.text ?? '').includes('1500') ? '1500' : null;
  const numeric = (value: string | null, fact: typeof catalog, raw: string | null = value) => value === null ? { value: null, evidence: null } : { value, evidence: { origin: 'source' as const, sourceId: fact.source.sourceRef.sourceId, artifactId: null, fragmentId: fact.fragment.id, raw: raw!, decimalSeparator: '.' as const, groupSeparator: 'none' as const } };
  return {
    id: optionId, title: optionId === 'standard' ? 'Standard' : 'Accelerated',
    offer: { title: `${optionId} custom service proposal`, currency: 'KZT', introduction: 'Prepared from the selected reviewed materials.', lines: [{ label: 'Custom service', unit: 'unit', quantity: { value: '2', evidence: { origin: 'goal', sourceId: null, artifactId: null, fragmentId: null, raw: '2', decimalSeparator: '.', groupSeparator: 'none' } }, price: numeric(price, catalog) }], discountRate: null, taxRate: null, terms: ['Delivery is excluded and billed separately.'], requirements: [{ text: 'Two units by 2026-11-05', status: 'answered', response: 'Scope and date checked.' }] },
    costs: [{ id: 'direct_cost', label: 'Labor and materials', quantity: { value: '2', evidence: { origin: 'goal', sourceId: null, artifactId: null, fragmentId: null, raw: '2', decimalSeparator: '.', groupSeparator: 'none' } }, unitCost: numeric('900', conditions) }],
    costCoverage: { state: 'complete', description: 'The conditions name the complete direct-cost basis.', evidence: { origin: 'source', sourceId: conditions.source.sourceRef.sourceId, artifactId: null, fragmentId: conditions.fragment.id, raw: 'Direct costs cover labor and materials' } }, minimumContributionRate: null,
    operationsAssessmentId: `capacity_${optionId}`, claims: [{ id: 'deadline', status: 'fact', impact: 'context', text: 'Requested by 2026-11-05.', evidence: { origin: 'source', sourceId: request.source.sourceRef.sourceId, artifactId: null, fragmentId: request.fragment.id, raw: '2026-11-05' }, question: null }],
    termClaims: [{ termIndex: 0, claim: { id: 'delivery_excluded', status: 'fact', impact: 'condition', text: 'Delivery is excluded and billed separately.', evidence: { origin: 'source', sourceId: conditions.source.sourceRef.sourceId, artifactId: null, fragmentId: conditions.fragment.id, raw: 'Delivery is excluded and billed separately' }, question: null } }],
    tradeoffs: [optionId === 'standard' ? 'Lower quote with standard preparation.' : 'Higher quote with shorter preparation.'],
  };
}

function createDecisionGateway(): (request: ModelRequest) => Promise<ModelOutput> {
  return async (request) => {
    if (request.jsonSchema) return verified();
    const context = contextOf(request);
    if (!context.goal.toLowerCase().includes('custom service')) {
      if (context.currentArtifact) {
        const active = context.artifacts.find((artifact) => artifact.artifactId === context.currentArtifact!.id);
        if (!active) throw new Error('CURRENT_ARTIFACT_CONTEXT_MISSING');
        if (!active.targets.some((target) => target.text.includes('Follow-up heading'))) {
          const target = active.targets.find((item) => !item.locked && !item.text.includes('My own wording'));
          if (!target) throw new Error('EDITABLE_TARGET_MISSING');
          return call('revise_document', { reason: 'Apply the human follow-up to the current document', updates: [{ targetId: target.targetId, text: 'Follow-up heading' }] });
        }
        return call('finish_work', { summary: 'The current memo was revised without replacing unrelated wording.' });
      }
      if (!context.savedResults.some((result) => result.title === 'Meeting memo')) return call('create_document', { title: 'Meeting memo', paragraphs: [{ kind: 'paragraph', text: 'The revised goal uses a document path and preserves the edited plan.' }] });
      return call('finish_work', { summary: 'The revised memo is saved.' });
    }
    if (!context.plan.length) return calls(
      { name: 'plan_work', args: { steps: ['Read the request and evidence', 'Check commercial viability and dated capacity', 'Compare options', 'Create the selected editable bundle'] } },
      { name: 'classify_sources', args: { assignments: context.sources.map((item) => ({ sourceId: item.sourceRef.sourceId, roles: [item.title.toLowerCase() === 'request' ? 'request' : item.title.toLowerCase() === 'catalog' ? 'catalog' : item.title.toLowerCase() === 'conditions' ? 'conditions' : 'availability'] })) } },
    );
    if (context.operations.length === 0) return calls(
      { name: 'assess_delivery_date', args: operationInput(context, 'standard'), id: 'capacity_standard_call' },
      { name: 'assess_delivery_date', args: operationInput(context, 'accelerated'), id: 'capacity_accelerated_call' },
    );
    if (!context.decision) return call('compare_decision_options', { options: [optionInput(context, 'standard'), optionInput(context, 'accelerated')] });
    if (!context.selectedOptionId) {
      const blocker = context.decision.blockers.find((item) => item.userResolvable);
      return blocker ? call('ask_user', { blockerId: blocker.id }) : call('present_decision', {});
    }
    if (!context.bundle) return call('prepare_decision_bundle', { optionId: context.selectedOptionId });
    return call('finish_work', { summary: 'The checked estimate, offer and operational plan are ready for review.' });
  };
}

const proposalInput = {
  plan: {
    kind: 'plan' as const, schemaVersion: 1 as const, timezone: 'Asia/Qyzylorda',
    entries: [{
      id: 'work', title: 'Checked work', status: 'todo' as const, resourceIds: [], dependencies: [], assignments: [],
      effort: { decimal: '60', unit: 'person-minutes' }, durationMinutes: 60,
      startAt: '2026-11-01T09:00:00.000Z', endAt: '2026-11-01T10:00:00.000Z', checklist: [], availabilityVersionIds: [],
    }],
  },
  resourceRefs: [], window: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z' },
  lockedEntryIds: [], materialConstraints: [], objective: 'earliest-finish' as const,
};
const proposalToolExtension: BusinessToolExtension = () => [{
  name: 'propose_work_plan', description: 'Validate one canonical schedule proposal.',
  schema: z.strictObject({ proposalId: z.string(), title: z.string(), input: ProposeWorkPlanInputSchema }),
  output: z.strictObject({ accepted: z.literal(true) }), action: 'calculate', costClass: 'local',
  effect: async (_tx, _raw, _context, state) => ({ output: { accepted: true }, context: state }),
}];

describe('J1 assistant decision procedure through durable runtime and canonical persistence', () => {
  it('offers and executes source-bound work tools only when pinned source evidence exists', async () => {
    const fixture = await artifactFixture(pool), artifact = await fixture.create();
    const descriptor: BusinessWorkToolDescriptor<{ sourceRefs: string[] }> = {
      name: 'build_source_bound_work', version: 1, purpose: 'Synthetic source-bound work producer.',
      inputSchema: z.strictObject({ sourceRefs: z.array(z.string()).min(1) }), outputSchema: BusinessWorkResultSchema,
      policy: 'edit', costClass: 'local', deadlineMs: 30_000, idempotency: 'operation-receipt',
      async execute() { throw new Error('SOURCE_BOUND_TOOL_MUST_NOT_EXECUTE'); },
    };
    const complete = vi.fn(async (request: ModelRequest) => {
      if (request.jsonSchema) return verified();
      expect(request.tools?.map((tool) => tool.name)).not.toContain('build_source_bound_work');
      expect(request.tools?.map((tool) => tool.name)).not.toContain('query_material_context');
      const context = contextOf(request);
      return context.savedResults.length
        ? call('finish_work', { summary: 'The artifact-only document is ready.' })
        : call('create_document', { title: 'Artifact-only memo', paragraphs: [{ kind: 'paragraph', text: 'Prepared without invented source references.' }] });
    });
    const registration = businessRegistration(pool, { gateway: { complete }, extensions: [materialContextBusinessToolExtension(pool), businessWorkToolExtension([descriptor])] });
    const registry = createRunRegistry([registration.capability], registration.tools), service = createRunService(pool, registry);
    const input = { workspaceId: fixture.workspaceId, projectId: fixture.projectId, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Prepare a memo from the selected artifact.', locale: 'en' as const, inputRefs: [{ kind: 'artifact' as const, id: artifact.artifact.id, revision: 0 }] };
    const created = await service.create(fixture.owner, input, randomUUID()), claim = await service.claim();
    expect(claim?.runId).toBe(created.id);
    for (let index = 0; index < 10; index++) if (await service.executeStep(claim!) === 'stopped') break;
    expect(await service.read(fixture.owner, created.id)).toMatchObject({ state: 'completed', failure: null });

    const state = (await pool.query<{ state: Record<string, unknown> }>('SELECT state FROM agent_run_contexts WHERE run_id=$1', [created.id])).rows[0]!.state;
    const sourceTool = registration.tools.find((tool) => tool.name === 'business.build_source_bound_work')!;
    const client = await pool.connect();
    try {
      await expect(sourceTool.execute(client, { callId: 'forced', arguments: { sourceRefs: ['invented'] } }, undefined, {
        fence: { runId: created.id, stepId: randomUUID(), epoch: 0, leaseOwner: randomUUID() },
        workspaceId: fixture.workspaceId, projectId: fixture.projectId, userId: fixture.owner.userId, authzVersion: 1,
        context: state, signal: new AbortController().signal,
        checkpoint: async () => { throw new Error('UNEXPECTED_CHECKPOINT'); },
      })).rejects.toMatchObject({ failure: 'invalid_result' });
    } finally { client.release(); }
  });

  it('uses one bounded correction request for a settled invalid tool payload', async () => {
    const normal = createDecisionGateway();
    let first = true;
    const f = await setup({ gateway: async (request) => {
      if (request.operationKey === 'business_decision_correction') {
        expect(request.maxReservedUsd).toBe('0.15');
        expect(request.tools).toBeUndefined();
        expect(request.toolChoice).toBeUndefined();
        expect(request.jsonSchema?.name).toBe('business_decision_correction');
        const correction = JSON.parse(request.messages.at(-1)!.content!) as { validationErrors: string[]; correctionTools: string[] };
        expect(correction.validationErrors.length).toBeGreaterThan(0);
        expect(correction.validationErrors.length).toBeLessThanOrEqual(10);
        expect(correction.correctionTools).toContain('plan_work');
        return { content: JSON.stringify({ toolCalls: [{ id: 'corrected_plan', name: 'plan_work', arguments: { steps: ['Read the selected evidence', 'Prepare checked options'] } }] }), toolCalls: [] };
      }
      if (request.jsonSchema) return verified();
      if (first) { first = false; return call('plan_work', { steps: [] }); }
      return normal(request);
    } });
    const run = await f.service.create(f.owner, f.input, randomUUID()), claim = await f.service.claim();
    expect(claim?.runId).toBe(run.id);
    expect(await f.service.executeStep(claim!)).toBe('continue');
    expect(await f.service.executeStep(claim!)).toBe('continue');
    const corrected = await f.service.read(f.owner, run.id);
    expect(corrected).toMatchObject({ state: 'running', failure: null });
    expect(f.complete.mock.calls.filter(([request]) => request.operationKey === 'business_decision_correction')).toHaveLength(1);
    await f.service.cancel(f.owner, run.id, { expectedEpoch: corrected.epoch }, randomUUID());
  });

  it('corrects the observed plan.calendar and fact-5 response through a strict structured envelope', async () => {
    let stage: 'plan' | 'invalid-proposal' | 'done' = 'plan';
    const f = await setup({ extensions: [proposalToolExtension], gateway: async (request) => {
      if (request.jsonSchema) {
        expect(request.operationKey).toBe('business_decision_correction');
        expect(request.tools).toBeUndefined();
        const correction = JSON.parse(request.messages.at(-1)!.content!) as {
          validationErrors: string[];
          correctionTools: string[];
          authorizedSourceRefs: { sourceId: string; sourceVersionId: string; revision: number }[];
          invalidToolCalls: { arguments: { input: { plan: { calendar?: unknown } } } }[];
        };
        expect(correction.validationErrors).toEqual(expect.arrayContaining([
          expect.stringContaining('unrecognized_keys'),
          expect.stringContaining('invalid_format'),
        ]));
        expect(correction.correctionTools).toEqual(['propose_work_plan']);
        expect(correction.authorizedSourceRefs.length).toBeGreaterThan(0);
        expect(correction.authorizedSourceRefs.every((ref) => ref.sourceId !== '00000000-0000-0000-0000-000000000000')).toBe(true);
        expect(correction.invalidToolCalls[0]!.arguments.input.plan.calendar).toBeDefined();
        const schema = request.jsonSchema.schema as { properties: { toolCalls: { items: { anyOf: { properties: { arguments: { properties: { input: { type: string; properties: { plan: { additionalProperties: boolean } } } } } } }[] } } } };
        const inputSchema = schema.properties.toolCalls.items.anyOf[0]!.properties.arguments.properties.input;
        expect(inputSchema.type).toBe('object');
        expect(inputSchema.properties.plan.additionalProperties).toBe(false);
        return { content: JSON.stringify({ toolCalls: [{ id: 'corrected_proposal', name: 'propose_work_plan', arguments: { proposalId: 'checked-work', title: 'Checked work', input: proposalInput } }] }), toolCalls: [] };
      }
      if (stage === 'plan') {
        stage = 'invalid-proposal';
        const context = contextOf(request);
        return calls(
          { name: 'plan_work', args: { steps: ['Read the selected evidence', 'Prepare a checked plan'] } },
          { name: 'classify_sources', args: { assignments: context.sources.map((source) => ({ sourceId: source.sourceRef.sourceId, roles: ['request'] })) } },
        );
      }
      if (stage !== 'invalid-proposal') throw new Error('UNEXPECTED_MODEL_CALL');
      stage = 'done';
      const context = contextOf(request), source = context.sources[0]!.sourceRef;
      const badInput = {
        ...proposalInput,
        plan: { ...proposalInput.plan, calendar: { uid: 'invented-calendar', sequence: 1 } },
        materialConstraints: [{ entryId: 'work', sourceRef: { ...source, fragmentId: 'fact-5' }, availableAt: '2026-11-01T09:00:00.000Z' }],
      };
      return calls(
        { name: 'propose_work_plan', id: 'observed_first', args: { proposalId: 'first', title: 'First', input: badInput } },
        { name: 'propose_work_plan', id: 'observed_second', args: { proposalId: 'second', title: 'Second', input: badInput } },
      );
    } });
    const run = await f.service.create(f.owner, f.input, randomUUID()), claim = await f.service.claim();
    for (let index = 0; index < 5; index++) expect(await f.service.executeStep(claim!)).toBe('continue');
    const corrected = await f.service.read(f.owner, run.id);
    expect(corrected).toMatchObject({ state: 'running', failure: null });
    expect(corrected.steps.some((step) => step.toolName === 'business.propose_work_plan' && step.state === 'planned')).toBe(true);
    await f.service.cancel(f.owner, run.id, { expectedEpoch: corrected.epoch }, randomUUID());
  });

  it('rejects double-encoded nested input and invented SourceRefs after the one bounded correction', async () => {
    for (const invalid of ['double-encoded', 'invented-source'] as const) {
      let stage: 'plan' | 'invalid-proposal' | 'done' = 'plan';
      const f = await setup({ extensions: [proposalToolExtension], gateway: async (request) => {
        if (request.jsonSchema) {
          const input = invalid === 'double-encoded'
            ? JSON.stringify(proposalInput)
            : { ...proposalInput, materialConstraints: [{ entryId: 'work', sourceRef: { sourceId: '00000000-0000-0000-0000-000000000000', sourceVersionId: '00000000-0000-0000-0000-000000000000', revision: 1 }, availableAt: '2026-11-01T09:00:00.000Z' }] };
          return { content: JSON.stringify({ toolCalls: [{ id: `invalid_${invalid}`, name: 'propose_work_plan', arguments: { proposalId: 'invalid', title: 'Invalid', input } }] }), toolCalls: [] };
        }
        if (stage === 'plan') {
          stage = 'invalid-proposal';
          const context = contextOf(request);
          return calls(
            { name: 'plan_work', args: { steps: ['Read the selected evidence', 'Prepare a checked plan'] } },
            { name: 'classify_sources', args: { assignments: context.sources.map((source) => ({ sourceId: source.sourceRef.sourceId, roles: ['request'] })) } },
          );
        }
        if (stage !== 'invalid-proposal') throw new Error('UNEXPECTED_MODEL_CALL');
        stage = 'done';
        return call('propose_work_plan', { proposalId: 'broken', title: 'Broken', input: { ...proposalInput, plan: { ...proposalInput.plan, calendar: {} } } });
      } });
      const run = await f.service.create(f.owner, f.input, randomUUID()), claim = await f.service.claim();
      for (let index = 0; index < 4; index++) expect(await f.service.executeStep(claim!)).toBe('continue');
      expect(await f.service.executeStep(claim!)).toBe('stopped');
      expect(await f.service.read(f.owner, run.id)).toMatchObject({ state: 'waiting_input', failure: 'invalid_result' });
    }
  });

  it('reads four source roles, compares trade-offs, waits for a human choice and atomically saves three editable artifacts', async () => {
    const f = await setup();
    const key = randomUUID(), response = await f.request('', f.input, key); expect(response.status).toBe(202);
    const run = RunSchema.parse(await response.json()); expect(RunSchema.parse(await (await f.request('', f.input, key)).json()).id).toBe(run.id);
    const waiting = await f.drain(run.id);
    expect(waiting).toMatchObject({ state: 'waiting_input', failure: null }); expect(waiting.progress.plan).toHaveLength(4); expect(waiting.progress.questions).toHaveLength(1);
    const decisionRequests = f.complete.mock.calls.map(([request]) => request).filter((request) => !request.jsonSchema);
    const decisionRequestMetrics = decisionRequests.map((request) => ({
      bytes: Buffer.byteLength(JSON.stringify({ messages: request.messages, tools: request.tools, toolChoice: request.toolChoice, maxOutputTokens: request.maxOutputTokens })),
      messages: request.messages.length,
      tools: request.tools?.map((tool) => tool.name) ?? [],
    }));
    expect(decisionRequestMetrics.every((metric) => metric.messages === 2)).toBe(true);
    expect(Math.max(...decisionRequestMetrics.map((metric) => metric.bytes))).toBeLessThan(32_000);
    expect(decisionRequestMetrics.slice(2).every((metric) => metric.tools.length === 1)).toBe(true);
    for (const request of decisionRequests) {
      const modelContext = contextOf(request), names = request.tools?.map((tool) => tool.name) ?? [];
      if (new Set(modelContext.operations.map((item) => item.assessmentId)).size < 2) expect(names).not.toContain('compare_decision_options');
      if (modelContext.selectedOptionId === null) expect(names).not.toContain('prepare_decision_bundle');
      if (!modelContext.savedResults.length) expect(names).not.toContain('finish_work');
    }
    expect(decisionRequests.some((request) => (request.tools ?? []).some((tool) => tool.name === 'compare_decision_options'))).toBe(true);
    expect(waiting.progress.decision).toMatchObject({ outcome: 'conditional', selectedOptionId: null, options: [{ id: 'standard', commercial: { quotedTotal: '2500.00', contribution: '700.00' } }, { id: 'accelerated', commercial: { quotedTotal: '3000.00', contribution: '1200.00' } }] });
    const publicStandard = waiting.progress.decision!.options.find((option) => option.id === 'standard')!;
    expect(publicStandard.sourceRefs).toHaveLength(4);
    const capacitySourceRef = publicStandard.capacity[0]!.evidence.sourceRefs[0]!;
    expect(capacitySourceRef.sourceVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(publicStandard.sourceRefs).toContainEqual(capacitySourceRef);
    expect(waiting.progress.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'capacity_standard', purposeKey: 'business.branch.operationsCheck', state: 'completed', resultRefs: [] }),
      expect.objectContaining({ id: 'capacity_accelerated', purposeKey: 'business.branch.operationsCheck', state: 'completed', resultRefs: [] }),
    ]));
    expect(JSON.stringify(waiting.progress.decision)).not.toContain('Direct costs cover labor and materials');
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    await expect(f.service.resume(f.owner, run.id, { expectedEpoch: waiting.epoch, selectedOptionId: 'missing_option' }, randomUUID())).rejects.toMatchObject({ failure: 'conflict' });
    const resumeKey = randomUUID(), resumeInput = { expectedEpoch: waiting.epoch, selectedOptionId: 'standard', acceptedConditionIds: ['accept_conditions_standard'] };
    const resumed = await f.service.resume(f.owner, run.id, resumeInput, resumeKey);
    expect((await f.service.resume(f.owner, run.id, resumeInput, resumeKey)).id).toBe(resumed.id);
    const done = await f.drain(resumed.id); expect(done.state).toBe('completed'); expect(done.progress.results).toHaveLength(3); expect(done.progress.decision?.selectedOptionId).toBe('standard');
    const resumedDecisionRequests = f.complete.mock.calls.map(([request]) => request).filter((request) => !request.jsonSchema && contextOf(request).selectedOptionId === 'standard');
    expect(resumedDecisionRequests.some((request) => (request.tools ?? []).some((tool) => tool.name === 'prepare_decision_bundle'))).toBe(true);
    expect(resumedDecisionRequests.some((request) => contextOf(request).savedResults.length > 0 && (request.tools ?? []).some((tool) => tool.name === 'finish_work'))).toBe(true);
    expect(done.progress.branches?.find((branch) => branch.id === 'capacity_standard')?.resultRefs).toEqual([expect.objectContaining({ kind: 'artifact', id: expect.any(String), revision: 0 })]);
    const loaded = await Promise.all(done.progress.results.map((item) => f.read(item.id)));
    expect(loaded.map((item) => item.content.kind).sort()).toEqual(['document', 'plan', 'table']);
    const table = loaded.find((item) => item.content.kind === 'table')!, document = loaded.find((item) => item.content.kind === 'document')!, plan = loaded.find((item) => item.content.kind === 'plan')!;
    expect(JSON.stringify(table.content)).toContain('2500.00'); expect(JSON.stringify(document.content)).toContain('2500.00 KZT');
    expect(plan.artifact.sourceRefs).toHaveLength(4); expect(plan.permissions.edit && document.permissions.edit && table.permissions.edit).toBe(true);
    expect((await f.service.events(f.owner, resumed.id)).events.some((event) => event.resultRefs.length === 3)).toBe(true);
    await expect(f.service.read(f.member, resumed.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    if (document.content.kind !== 'document') throw new Error('document missing');
    const paragraph = document.content.document.content!.find((node) => node.type === 'paragraph')!, targetId = String(paragraph.attrs!.id), resolver = createArtifactTargetResolver(document.content, document.artifact.bindings, document.locks);
    const sources = Object.fromEntries(document.sourceFreshness.filter((item) => item.currentRevision !== undefined).map((item) => [item.sourceRef.sourceId, item.currentRevision!]));
    const artifactService = (await import('../../src/features/artifacts/server/service')).createArtifactService(pool);
    await artifactService.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: document.viewer.authzVersion, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [document.artifact.id]: document.artifact.currentRevision }, expectedSourceRevisions: sources, commands: [{ commandId: randomUUID(), artifactId: document.artifact.id, baseRevision: document.artifact.currentRevision, kind: 'document', reason: 'Personal wording', expectedSourceRevisions: sources, operations: [{ targetId, op: 'set', beforeHash: resolver(targetId)!.hash, value: { ...paragraph, content: [{ type: 'text', text: 'My own wording survives reopening.' }] } }] }] } });
    const manuallyEdited = await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: document.artifact.id });
    expect(JSON.stringify(manuallyEdited.content)).toContain('My own wording survives reopening.');
    const manualResolver = createArtifactTargetResolver(manuallyEdited.content, manuallyEdited.artifact.bindings, manuallyEdited.locks);
    const manualSources = Object.fromEntries(manuallyEdited.sourceFreshness.filter((item) => item.currentRevision !== undefined).map((item) => [item.sourceRef.sourceId, item.currentRevision!]));
    await artifactService.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: manuallyEdited.viewer.authzVersion, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [document.artifact.id]: manuallyEdited.artifact.currentRevision }, expectedSourceRevisions: manualSources, commands: [{ commandId: randomUUID(), artifactId: document.artifact.id, baseRevision: manuallyEdited.artifact.currentRevision, kind: 'document', reason: 'Protect approved personal wording', expectedSourceRevisions: manualSources, operations: [{ targetId, op: 'lock', beforeHash: manualResolver(targetId)!.hash, value: { locked: true, reason: 'Approved personal wording' } }] }] } });
    const protectedEdit = await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: document.artifact.id });
    expect(protectedEdit.locks?.[targetId]?.reason).toBe('Approved personal wording');
    await expect(artifactService.version(f.owner, { workspaceId: f.workspaceId, artifactId: document.artifact.id, revision: protectedEdit.artifact.currentRevision, expectedProjectId: f.projectId })).resolves.toMatchObject({ headRevision: protectedEdit.artifact.currentRevision, artifact: { status: 'draft' } });
    expect(RunSchema.parse(await (await f.request(`/${run.id}`)).json()).progress.results.map((item) => item.id)).toEqual(done.progress.results.map((item) => item.id));
    const changedKey = randomUUID(), changedInput = { expectedEpoch: done.epoch, goal: 'Prepare a meeting memo from the selected sources.', plan: ['Extract decisions', 'Revise the current memo'], currentArtifact: { id: document.artifact.id, revision: protectedEdit.artifact.currentRevision } };
    const changed = await f.service.resume(f.owner, done.id, changedInput, changedKey);
    expect((await f.service.resume(f.owner, done.id, changedInput, changedKey)).id).toBe(changed.id);
    const revised = await f.drain(changed.id);
    expect(revised).toMatchObject({ state: 'completed', failure: null });
    expect(revised.progress.plan).toEqual(changedInput.plan);
    expect(revised.steps.some((step) => step.toolName === 'business.revise_document')).toBe(true); expect(revised.steps.some((step) => step.toolName === 'business.create_document')).toBe(false); expect(revised.steps.some((step) => step.toolName === 'business.compare_decision_options')).toBe(false);
    const followUpRequests = f.complete.mock.calls.map(([request]) => request).filter((request) => !request.jsonSchema && contextOf(request).currentArtifact?.id === document.artifact.id);
    expect(followUpRequests.map((request) => request.tools?.map((tool) => tool.name))).toEqual([
      ['plan_work', 'read_artifact', 'revise_document'],
      ['finish_work'],
    ]);
    expect(followUpRequests.every((request) => request.messages.length === 2)).toBe(true);
    const afterFollowUp = await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: document.artifact.id });
    expect(afterFollowUp.artifact.currentRevision).toBe(protectedEdit.artifact.currentRevision + 1);
    expect(JSON.stringify(afterFollowUp.content)).toContain('Follow-up heading');
    expect(JSON.stringify(afterFollowUp.content)).toContain('My own wording survives reopening.');
    expect(afterFollowUp.locks?.[targetId]?.reason).toBe('Approved personal wording');
    expect(revised.progress.results.find((result) => result.id === document.artifact.id)?.revision).toBe(afterFollowUp.artifact.currentRevision);
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(3);
  }, 90_000);

  it('routes normal-language goals to four native editable kinds, persists a clarification answer, and revises each selected kind in place', async () => {
    const humanHeadText = 'A human updated this sentence after the assistant saved revision zero.';
    let expectExactDocumentRevision = false, sawExactDocumentRevision = false;
    const formatGateway = async (request: ModelRequest): Promise<ModelOutput> => {
      if (request.jsonSchema) {
        if (expectExactDocumentRevision) {
          const evidence = request.messages[1]!.content!;
          expect(evidence).toContain('Launch readiness is reviewed against the current internal checklist.');
          expect(evidence).not.toContain(humanHeadText);
          sawExactDocumentRevision = true;
          expectExactDocumentRevision = false;
        }
        return verified();
      }
      const context = contextOf(request), goal = context.goal.toLocaleLowerCase('und');
      const toolNames = request.tools?.map((tool) => tool.name) ?? [];
      if (context.currentArtifact) {
        const active = context.artifacts.find((artifact) => artifact.artifactId === context.currentArtifact!.id);
        if (!active) throw new Error('CURRENT_NATIVE_ARTIFACT_MISSING');
        const editable = active.targets.find((target) => !target.locked && (
          active.kind === 'design' ? target.targetProperty === 'text' && target.text === 'Открываемся в субботу — приходите!'
            : active.kind === 'table' ? target.text === 'Новая'
              : active.kind === 'plan' ? target.text.includes('Draft launch checklist')
                : target.text.includes('Launch readiness is reviewed') || target.text === humanHeadText
        ));
        if (editable) {
          expect(context.savedResults).toEqual([]);
          expect(toolNames).toContain(`revise_${active.kind}`);
          if (active.kind === 'design') return call('revise_design', { reason: 'Use the requested follow-up headline', updates: [{ targetId: editable.targetId, text: 'Открываемся в эту субботу' }] });
          if (active.kind === 'table') return call('revise_table', { reason: 'Advance the selected application', updates: [{ targetId: editable.targetId, value: 'В работе' }] });
          if (active.kind === 'plan') return call('revise_plan', { reason: 'Use the requested task wording', updates: [{ targetId: editable.targetId, title: 'Publish launch checklist' }] });
          return call('revise_document', { reason: 'Apply the requested report correction', updates: [{ targetId: editable.targetId, text: 'Launch readiness is confirmed for internal review.' }] });
        }
        return call('finish_work', { summary: `The selected ${active.kind} was revised in place.` });
      }
      if (context.savedResults.length) return call('finish_work', { summary: `The requested ${context.requiredArtifactKinds[0]} is ready.` });
      if (goal.includes('баннер')) {
        expect(context.requiredArtifactKinds).toEqual(['design']);
        if (!context.answers.some((answer) => answer.questionId === 'clarify_headline')) {
          expect(toolNames).toContain('ask_clarification');
          return call('ask_clarification', { id: 'clarify_headline', question: 'Какой заголовок и призыв должны быть на баннере?', purpose: 'Без пользовательского заголовка и призыва баннер не передаст нужное сообщение.' });
        }
        expect(toolNames).toContain('create_design');
        const copy = context.answers.find((answer) => answer.questionId === 'clarify_headline')!.answer;
        return call('create_design', { title: 'Баннер открытия', width: 1200, height: 628, unit: 'px', background: '#14362b', layers: [
          { type: 'shape', name: 'Accent', shape: 'rect', transform: { x: 64, y: 64, width: 16, height: 500, rotation: 0 }, fill: '#dff6b8', stroke: 'transparent', strokeWidth: 0, radius: 8, opacity: 1 },
          { type: 'text', name: 'Headline', text: copy, transform: { x: 128, y: 120, width: 900, height: 150, rotation: 0 }, color: '#ffffff', fontSize: 64, fontWeight: '700', align: 'left', lineHeight: 1.05, letterSpacing: -1 },
          { type: 'text', name: 'Details', text: 'Суббота · с 10:00', transform: { x: 132, y: 330, width: 600, height: 70, rotation: 0 }, color: '#dff6b8', fontSize: 30, fontWeight: '600', align: 'left', lineHeight: 1.2, letterSpacing: 0 },
        ] });
      }
      if (goal.includes('таблиц')) {
        expect(context.requiredArtifactKinds).toEqual(['table']);
        expect(toolNames).toContain('create_table');
        return call('create_table', { title: 'Контроль заявок', sheetName: 'Заявки', columns: [{ name: 'Клиент', kind: 'text' }, { name: 'Статус', kind: 'text' }, { name: 'Сумма', kind: 'money', currency: 'KZT' }], rows: [
          { cells: [{ value: 'Алия' }, { value: 'Новая' }, { value: 25000 }] },
          { cells: [{ value: 'Данияр' }, { value: 'Согласована' }, { value: 42000 }] },
        ] });
      }
      if (goal.includes('task schedule')) {
        expect(context.requiredArtifactKinds).toEqual(['plan']);
        expect(toolNames).toContain('create_plan');
        return call('create_plan', { title: 'Launch task schedule', timezone: 'Asia/Qyzylorda', tasks: [
          { key: 'draft', title: 'Draft launch checklist', schedule: { kind: 'unscheduled' }, dependencies: [], checklist: ['List launch owners'], linkedArtifactIds: [], evidence: [] },
          { key: 'review', title: 'Review launch checklist', schedule: { kind: 'unscheduled' }, dependencies: ['draft'], checklist: ['Record approval'], linkedArtifactIds: [], evidence: [] },
        ] });
      }
      expect(context.requiredArtifactKinds).toEqual(['document']);
      expect(toolNames).toContain('create_document');
      return call('create_document', { title: 'Launch report', paragraphs: [
        { kind: 'heading', text: 'Readiness' },
        { kind: 'paragraph', text: 'Launch readiness is reviewed against the current internal checklist.' },
        { kind: 'heading', text: 'Next step' },
        { kind: 'paragraph', text: 'Resolve the remaining checklist items before publication.' },
      ] });
    };
    const f = await setup({ gateway: formatGateway, extensions: [nativePlanExtension] });
    const goals = [
      'Сделай баннер для субботнего открытия.',
      'Создай таблицу контроля заявок с колонками клиент, статус и сумма и двумя примерами.',
      'Prepare a task schedule for launch with a draft and review dependency.',
      'Write a short launch report with readiness and next steps.',
    ];
    const artifactService = (await import('../../src/features/artifacts/server/service')).createArtifactService(pool);
    const created: { kind: 'design' | 'table' | 'plan' | 'document'; run: Awaited<ReturnType<typeof f.service.read>>; artifactId: string }[] = [];
    for (const [index, goal] of goals.entries()) {
      const input = { ...f.input, goal, inputRefs: [] };
      const started = await f.service.create(f.owner, input, randomUUID());
      let completed;
      if (index === 3) {
        const claim = await f.service.claim();
        expect(claim?.runId).toBe(started.id);
        for (let step = 0; step < 20; step++) {
          expect(await f.service.executeStep(claim!)).toBe('continue');
          completed = await f.service.read(f.owner, started.id);
          if (completed.steps.some((item) => item.toolName === 'business.create_document' && item.state === 'succeeded')) break;
        }
        if (!completed) throw new Error('DOCUMENT_CREATE_DID_NOT_RUN');
        const documentRef = completed.progress.results[0]!;
        const document = await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: documentRef.id });
        const documentExcerpt = excerptArtifact({ artifactId: documentRef.id, revision: document.artifact.currentRevision, title: document.artifact.title, content: document.content, bindings: document.artifact.bindings, sourceRefs: document.artifact.sourceRefs, lockedIds: Object.keys(document.locks ?? {}) });
        const target = documentExcerpt.targets.find((item) => item.text === 'Launch readiness is reviewed against the current internal checklist.')!;
        const resolver = createArtifactTargetResolver(document.content, document.artifact.bindings, document.locks), resolved = resolver(target.targetId)!;
        const expectedSourceRevisions = Object.fromEntries(document.sourceFreshness.filter((source) => source.currentRevision !== undefined).map((source) => [source.sourceRef.sourceId, source.currentRevision!]));
        await artifactService.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: document.viewer.authzVersion, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [documentRef.id]: document.artifact.currentRevision }, expectedSourceRevisions, commands: [{ commandId: randomUUID(), artifactId: documentRef.id, baseRevision: document.artifact.currentRevision, kind: 'document', reason: 'Concurrent human edit', expectedSourceRevisions, operations: [{ targetId: target.targetId, op: 'set', beforeHash: resolved.hash, value: { type: 'paragraph', attrs: { id: target.targetId }, content: [{ type: 'text', text: humanHeadText }] } }] }] } });
        expectExactDocumentRevision = true;
        for (let step = 0; step < 20; step++) if (await f.service.executeStep(claim!) === 'stopped') break;
        completed = await f.service.read(f.owner, started.id);
        expect(sawExactDocumentRevision).toBe(true);
        expect(completed.progress.results[0]?.revision).toBe(0);
        expect((await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: documentRef.id })).artifact.currentRevision).toBe(1);
      } else completed = await f.drain(started.id);
      if (index === 0) {
        expect(completed).toMatchObject({ state: 'waiting_input', progress: { questions: [{ id: 'clarify_headline', required: true }], answeredQuestions: [] } });
        completed = await f.service.resume(f.owner, completed.id, { expectedEpoch: completed.epoch, answers: [{ questionId: 'clarify_headline', answer: 'Открываемся в субботу — приходите!' }] }, randomUUID());
        completed = await f.drain(completed.id);
        expect(completed.progress.answeredQuestions).toEqual([{ questionId: 'clarify_headline', question: 'Какой заголовок и призыв должны быть на баннере?', answer: 'Открываемся в субботу — приходите!' }]);
      }
      expect(completed).toMatchObject({ state: 'completed', failure: null, progress: { results: [expect.objectContaining({ kind: 'artifact', revision: 0 })] } });
      const ref = completed.progress.results[0]!, loaded = await f.read(ref.id);
      const expectedKind = ['design', 'table', 'plan', 'document'][index] as 'design' | 'table' | 'plan' | 'document';
      expect(loaded.content.kind).toBe(expectedKind);
      created.push({ kind: expectedKind, run: completed, artifactId: ref.id });
    }

    for (const item of created) {
      const before = await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: item.artifactId });
      const excerpt = excerptArtifact({ artifactId: item.artifactId, revision: before.artifact.currentRevision, title: before.artifact.title, content: before.content, bindings: before.artifact.bindings, sourceRefs: before.artifact.sourceRefs, lockedIds: Object.keys(before.locks ?? {}) });
      const lockTarget = item.kind === 'design'
        ? excerpt.targets.find((target) => target.targetProperty === 'value')!
        : item.kind === 'table'
          ? excerpt.targets.at(-1)!
          : item.kind === 'plan'
            ? excerpt.targets.find((target) => target.text.includes('Review launch checklist'))!
            : excerpt.targets.find((target) => target.text === 'Launch report')!;
      const resolver = createArtifactTargetResolver(before.content, before.artifact.bindings, before.locks), originalHash = resolver(lockTarget.targetId)!.hash;
      const expectedSourceRevisions = Object.fromEntries(before.sourceFreshness.filter((source) => source.currentRevision !== undefined).map((source) => [source.sourceRef.sourceId, source.currentRevision!]));
      await artifactService.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: before.viewer.authzVersion, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [item.artifactId]: before.artifact.currentRevision }, expectedSourceRevisions, commands: [{ commandId: randomUUID(), artifactId: item.artifactId, baseRevision: before.artifact.currentRevision, kind: item.kind, reason: 'Protect approved unrelated content', expectedSourceRevisions, operations: [{ targetId: lockTarget.targetId, op: 'lock', beforeHash: originalHash, value: { locked: true, reason: 'Approved unchanged content' } }] }] } });
      const locked = await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: item.artifactId });
      const lockedHash = createArtifactTargetResolver(locked.content, locked.artifact.bindings, locked.locks)(lockTarget.targetId)!.hash;
      const followUpGoal = item.kind === 'design' ? 'Change the selected banner headline.' : item.kind === 'table' ? 'Change the selected application status.' : item.kind === 'plan' ? 'Rename the selected first task.' : 'Correct the selected report readiness sentence.';
      const continuation = await f.service.resume(f.owner, item.run.id, { expectedEpoch: item.run.epoch, goal: followUpGoal, plan: ['Apply the requested change'], currentArtifact: { id: item.artifactId, revision: locked.artifact.currentRevision } }, randomUUID());
      const revisedRun = await f.drain(continuation.id);
      if (revisedRun.state !== 'completed' || revisedRun.failure !== null) throw new Error(`NATIVE_REVISION_FAILED:${item.kind}:${revisedRun.failure ?? revisedRun.state}:${JSON.stringify(revisedRun.steps.map((step) => ({ tool: step.toolName, state: step.state, failure: step.failure })))}`);
      expect(revisedRun.steps.some((step) => step.toolName === `business.revise_${item.kind}`)).toBe(true);
      expect(revisedRun.steps.some((step) => step.toolName.startsWith('business.create_'))).toBe(false);
      const after = await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: item.artifactId });
      expect(after.content.kind).toBe(item.kind);
      expect(after.artifact.id).toBe(item.artifactId);
      expect(after.artifact.currentRevision).toBe(locked.artifact.currentRevision + 1);
      expect(after.locks?.[lockTarget.targetId]?.reason).toBe('Approved unchanged content');
      expect(createArtifactTargetResolver(after.content, after.artifact.bindings, after.locks)(lockTarget.targetId)!.hash).toBe(lockedHash);
      expect(revisedRun.progress.results).toEqual([expect.objectContaining({ id: item.artifactId, revision: after.artifact.currentRevision })]);
    }
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(4);
  }, 120_000);

  it('completes verified work when the verifier returns only non-blocking observations', async () => {
    const normal = createDecisionGateway();
    const f = await setup({ gateway: async (request) => request.operationKey === 'business_verification'
      ? { content: JSON.stringify({ verdict: 'ready', findings: [{ id: 'optional_note', text: 'A non-blocking review note.', required: false }] }), toolCalls: [] }
      : normal(request) });
    f.input.goal = 'Prepare a meeting memo from the selected sources.';
    const run = await f.service.create(f.owner, f.input, randomUUID()), completed = await f.drain(run.id);

    expect(completed).toMatchObject({ state: 'completed', failure: null, progress: { questions: [] } });
    expect(completed.steps.at(-1)).toMatchObject({ toolName: 'business.finish_work', state: 'succeeded' });
  });

  it('keeps missing capacity or price in waiting_input with one material question and no offer success', async () => {
    const missingCapacity = await setup({ availability: 'Workshop opens 2026-11-01. Team availability has not been entered.' });
    const capacityRun = await missingCapacity.service.create(missingCapacity.owner, missingCapacity.input, randomUUID()), capacityWaiting = await missingCapacity.drain(capacityRun.id);
    expect(capacityWaiting).toMatchObject({ state: 'waiting_input', failure: null }); expect(capacityWaiting.progress.questions).toHaveLength(1);
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [missingCapacity.workspaceId])).rowCount).toBe(0);
    const catalog = await missingCapacity.upload('Catalog', 'Standard and accelerated service prices are not confirmed in KZT.', false);
    const availability = await missingCapacity.upload('Availability', 'Workshop opens 2026-11-01. Available minutes before 2026-11-05: 960.', false);
    const priceInput = { ...missingCapacity.input, inputRefs: [missingCapacity.uploaded.Request!, catalog, missingCapacity.uploaded.Conditions!, availability] };
    const priceRun = await missingCapacity.service.create(missingCapacity.owner, priceInput, randomUUID()), priceWaiting = await missingCapacity.drain(priceRun.id);
    expect(priceWaiting).toMatchObject({ state: 'waiting_input', failure: null }); expect(priceWaiting.progress.questions).toHaveLength(1);
    expect(priceWaiting.progress.questions[0]!.id).toMatch(/^price_/);
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [missingCapacity.workspaceId])).rowCount).toBe(0);
  });

  it('rolls back estimate, offer and plan together when linking fails before the run receipt', async () => {
    const f = await setup({ failLinks: true });
    const run = await f.service.create(f.owner, f.input, randomUUID()), waiting = await f.drain(run.id);
    const resumed = await f.service.resume(f.owner, run.id, { expectedEpoch: waiting.epoch, selectedOptionId: 'standard', acceptedConditionIds: ['accept_conditions_standard'] }, randomUUID());
    const failed = await f.drain(resumed.id);
    expect(failed).toMatchObject({ state: 'waiting_input', failure: 'invalid_result' }); expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0); expect(failed.progress.results).toHaveLength(0);
  });

  it('denies malformed provider input, cancellation late writes and revoked access', async () => {
    let mode: 'malformed' | 'pending' | 'finish' = 'malformed';
    let finish!: (output: ModelOutput) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const f = await setup({ gateway: async (request) => {
      if (request.jsonSchema) return verified();
      if (mode === 'malformed') {
        expect(request.tools?.map((tool) => tool.name)).not.toContain('compare_decision_options');
        return { content: null, toolCalls: [{ id: 'bad', name: 'compare_decision_options', arguments: '{"options":[]}' }] };
      }
      if (mode === 'pending') { entered(); return new Promise<ModelOutput>((resolve) => { finish = resolve; }); }
      return call('finish_work', { summary: 'Not allowed' });
    } });
    const malformedRun = await f.service.create(f.owner, f.input, randomUUID()), invalid = await f.drain(malformedRun.id);
    expect(invalid).toMatchObject({ state: 'waiting_input', failure: 'invalid_result' }); expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    expect(f.complete.mock.calls.filter(([request]) => request.operationKey === 'business_decision_correction')).toHaveLength(1);
    mode = 'pending';
    const run = await f.service.create(f.owner, f.input, randomUUID()), claim = await f.service.claim();
    expect(claim?.runId).toBe(run.id); expect(await f.service.executeStep(claim!)).toBe('continue');
    const executing = f.service.executeStep(claim!); await started;
    const current = await f.service.read(f.owner, run.id); await f.service.cancel(f.owner, run.id, { expectedEpoch: current.epoch }, randomUUID());
    finish(call('create_document', { title: 'Too late', paragraphs: [{ kind: 'paragraph', text: 'Must not be saved.' }] }));
    expect(await executing).toBe('stopped'); expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    mode = 'finish';
    const second = await f.service.create(f.owner, f.input, randomUUID()), secondClaim = await f.service.claim();
    await pool.query('UPDATE identity_workspaces SET authz_version=authz_version+1 WHERE id=$1', [f.workspaceId]);
    expect(await f.service.executeStep(secondClaim!)).toBe('stopped'); expect(await f.service.read(f.owner, second.id)).toMatchObject({ state: 'failed', failure: 'access_changed' });
  }, 60_000);
});
