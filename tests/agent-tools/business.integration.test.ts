import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
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

type SetupOptions = { failLinks?: boolean; availability?: string; catalog?: string; gateway?: (request: ModelRequest) => Promise<ModelOutput> };
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
  const registration = businessRegistration(pool, { gateway: { complete }, extensions: [fixtureOperationsExtension], ...(options.failLinks ? { registerOfferLinks: async () => { throw new Error('SYNTHETIC_AFTER_ARTIFACTS_BEFORE_RECEIPT'); } } : {}) });
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
    goal: string; answers: { questionId: string; answer: string }[]; plan: string[];
    sources: { sourceRef: { sourceId: string; sourceVersionId: string; revision: number }; title: string; fragments: { id: string; text?: string; values?: string[] }[] }[];
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

describe('J1 assistant decision procedure through durable runtime and canonical persistence', () => {
  it('reads four source roles, compares trade-offs, waits for a human choice and atomically saves three editable artifacts', async () => {
    const f = await setup();
    const key = randomUUID(), response = await f.request('', f.input, key); expect(response.status).toBe(202);
    const run = RunSchema.parse(await response.json()); expect(RunSchema.parse(await (await f.request('', f.input, key)).json()).id).toBe(run.id);
    const waiting = await f.drain(run.id);
    expect(waiting).toMatchObject({ state: 'waiting_input', failure: null }); expect(waiting.progress.plan).toHaveLength(4); expect(waiting.progress.questions).toHaveLength(1);
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
    expect(JSON.stringify((await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: document.artifact.id })).content)).toContain('My own wording survives reopening.');
    expect(RunSchema.parse(await (await f.request(`/${run.id}`)).json()).progress.results.map((item) => item.id)).toEqual(done.progress.results.map((item) => item.id));
    const changedKey = randomUUID(), changedInput = { expectedEpoch: done.epoch, goal: 'Prepare a meeting memo from the selected sources.', plan: ['Extract decisions', 'Draft the memo'] };
    const changed = await f.service.resume(f.owner, done.id, changedInput, changedKey); expect((await f.service.resume(f.owner, done.id, changedInput, changedKey)).id).toBe(changed.id);
    const revised = await f.drain(changed.id); expect(revised.state).toBe('completed'); expect(revised.progress.plan).toEqual(changedInput.plan);
    expect(revised.steps.some((step) => step.toolName === 'business.create_document')).toBe(true); expect(revised.steps.some((step) => step.toolName === 'business.compare_decision_options')).toBe(false);
  }, 90_000);

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
      if (mode === 'malformed') return { content: null, toolCalls: [{ id: 'bad', name: 'compare_decision_options', arguments: '{"options":[]}' }] };
      if (mode === 'pending') { entered(); return new Promise<ModelOutput>((resolve) => { finish = resolve; }); }
      return call('finish_work', { summary: 'Not allowed' });
    } });
    const malformedRun = await f.service.create(f.owner, f.input, randomUUID()), invalid = await f.drain(malformedRun.id);
    expect(invalid).toMatchObject({ state: 'waiting_input', failure: 'invalid_result' }); expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
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
