import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { businessRegistration } from '../../src/features/agent-tools/server/business';
import { createRunRegistry } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { createRunHandlers } from '../../src/features/runs/server/handlers';
import type { ModelOutput, ModelRequest } from '../../src/features/runs/server/gateway';
import { createSourceService } from '../../src/features/sources/server/service';
import { LocalSourceStorage } from '../../src/features/sources/server/storage';
import { InitSourceUploadSchema } from '../../src/contracts/sources';
import { RunSchema } from '../../src/contracts/runs';
import { createArtifactTargetResolver } from '../../src/features/artifacts/domain/targets';
import { artifactFixture, artifactTestPool } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
const call = (name: string, args: unknown, id = name): ModelOutput => ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const verified = (): ModelOutput => ({ content: JSON.stringify({ verdict: 'ready', findings: [] }), toolCalls: [] });
async function setup(complete: (request: ModelRequest) => Promise<ModelOutput>, options: { failLinks?: boolean } = {}) {
  const fixture = await artifactFixture(pool);
  const registration = businessRegistration(pool, { gateway: { complete }, ...(options.failLinks ? { registerOfferLinks: async () => { throw new Error('SYNTHETIC_AFTER_ARTIFACTS_BEFORE_RECEIPT'); } } : {}) });
  const registry = createRunRegistry([registration.capability], registration.tools), service = createRunService(pool, registry);
  const input = { workspaceId: fixture.workspaceId, projectId: fixture.projectId, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Prepare a custom proposal for 2 units in KZT; delivery timing is unknown.', locale: 'en' as const, inputRefs: [] as { kind: 'source'; id: string; revision: number }[] };
  const handle = createRunHandlers({ pool, service, registry, origin: 'http://localhost:3000', wake: async () => undefined, getActor: async () => ({ user: { id: fixture.owner.userId, name: 'Synthetic owner', email: 'synthetic@example.test', emailVerified: true, locale: 'en' }, session: { id: fixture.owner.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } }) });
  const request = (suffix: string, body?: unknown, key = randomUUID()) => handle(new Request(`http://localhost:3000/api/runs${suffix}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:3000', 'X-Tirlik-User-Id': fixture.owner.userId, 'Idempotency-Key': key, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const upload = async () => {
    const source = createSourceService(pool, new LocalSourceStorage(path.join(process.env.TIRLIK_DATA_DIR!, 'business-tests', randomUUID()))), bytes = Buffer.from('service,price,currency\nCustom work,1250,KZT');
    const initialized = await source.init(fixture.owner, randomUUID(), InitSourceUploadSchema.parse({ workspaceId: fixture.workspaceId, projectId: fixture.projectId, title: 'Actual synthetic price file', fileName: 'prices.csv', format: 'csv', size: bytes.length }));
    await source.put(fixture.owner, fixture.workspaceId, initialized.upload.id, initialized.token!, new Blob([new Uint8Array(bytes)]).stream());
    const completed = await source.finalize(fixture.owner, fixture.workspaceId, initialized.upload.id);
    input.inputRefs.push({ kind: 'source', id: completed.upload.sourceId, revision: 1 });
  };
  const drain = async (runId: string) => {
    const claim = await service.claim(); expect(claim?.runId).toBe(runId);
    for (let i = 0; i < 30; i++) if (await service.executeStep(claim!) === 'stopped') return service.read(fixture.owner, runId);
    throw new Error('SYNTHETIC_STEP_BOUND');
  };
  return { ...fixture, registry, service, input, request, upload, drain };
}
function offerResponse(request: ModelRequest) {
  const context = JSON.parse(request.messages[1]!.content!) as { sources: { sourceRef: { sourceId: string }; fragments: { id: string; values?: string[] }[] }[] };
  const source = context.sources[0]!, fragment = source.fragments.find((item) => item.values?.includes('1250'))!;
  return call('prepare_offer', { title: 'Custom work proposal', currency: 'KZT', introduction: 'Prepared from the selected price file.', lines: [{ label: 'Custom work', unit: 'unit', quantity: { value: '2', evidence: { origin: 'goal', sourceId: null, fragmentId: null, raw: '2', decimalSeparator: '.', groupSeparator: 'none' } }, price: { value: '1250', evidence: { origin: 'source', sourceId: source.sourceRef.sourceId, fragmentId: fragment.id, raw: '1250', decimalSeparator: '.', groupSeparator: 'none' } } }], discountRate: null, taxRate: null, terms: ['Delivery timing needs confirmation.'], requirements: [{ text: 'Two units of custom work', status: 'answered', response: 'Included in this estimate.' }, { text: 'Delivery timing', status: 'question', response: 'Please confirm the required date.' }] });
}

describe('real public business capability through HTTP and canonical persistence', () => {
  it('reads the uploaded file, chooses typed tools, saves linked editable artifacts and reopens a manual edit', async () => {
    let decisions = 0;
    const complete = vi.fn(async (request: ModelRequest) => {
      if (request.jsonSchema) return verified();
      if (decisions++ === 0) return offerResponse(request);
      expect(request.messages.some((message) => message.role === 'tool' && message.toolCallId === 'prepare_offer')).toBe(true);
      return call('finish_work', { summary: 'The estimate and proposal are ready. Delivery timing remains open.' });
    });
    const f = await setup(complete); await f.upload();
    expect(f.registry.list()).toEqual([{ id: 'business.goal', version: 1 }]);
    const key = randomUUID(), response = await f.request('', f.input, key); expect(response.status).toBe(202);
    const run = RunSchema.parse(await response.json());
    expect(RunSchema.parse(await (await f.request('', f.input, key)).json()).id).toBe(run.id);
    const done = await f.drain(run.id); expect(done.state).toBe('completed'); expect(done.progress.results).toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(3);
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(2);
    const loaded = await Promise.all(done.progress.results.map((ref) => f.read(ref.id))), table = loaded.find((item) => item.content.kind === 'table')!, document = loaded.find((item) => item.content.kind === 'document')!;
    expect(JSON.stringify(table.content)).toContain('2500.00'); expect(JSON.stringify(document.content)).toContain('2500.00 KZT');
    expect(document.artifact.bindings.length).toBeGreaterThan(0);
    expect(table.permissions.edit && document.permissions.edit).toBe(true);
    expect((await f.service.events(f.owner, run.id)).events.some((event) => event.resultRefs.length === 2)).toBe(true);
    await expect(f.service.read(f.member, run.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    if (document.content.kind !== 'document') throw new Error('document missing');
    const paragraph = document.content.document.content!.find((node) => node.type === 'paragraph')!, targetId = String(paragraph.attrs!.id), resolver = createArtifactTargetResolver(document.content, document.artifact.bindings, document.locks);
    const sources = Object.fromEntries(document.sourceFreshness.filter((item) => item.currentRevision !== undefined).map((item) => [item.sourceRef.sourceId, item.currentRevision!]));
    expect(await f.service.receipt(f.owner, run.id, done.steps.find((step) => step.toolName === 'business.prepare_offer')!.id, `step_${done.steps.find((step) => step.toolName === 'business.prepare_offer')!.id}`)).not.toBeNull();
    const artifactService = (await import('../../src/features/artifacts/server/service')).createArtifactService(pool);
    await artifactService.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: document.viewer.authzVersion, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [document.artifact.id]: document.artifact.currentRevision }, expectedSourceRevisions: sources, commands: [{ commandId: randomUUID(), artifactId: document.artifact.id, baseRevision: document.artifact.currentRevision, kind: 'document', reason: 'Personal wording', expectedSourceRevisions: sources, operations: [{ targetId, op: 'set', beforeHash: resolver(targetId)!.hash, value: { ...paragraph, content: [{ type: 'text', text: 'My own wording survives reopening.' }] } }] }] } });
    expect(JSON.stringify((await artifactService.readRoute(f.owner, { projectId: f.projectId, artifactId: document.artifact.id })).content)).toContain('My own wording survives reopening.');
    expect(RunSchema.parse(await (await f.request(`/${run.id}`)).json()).progress.results.map((item) => item.id)).toEqual(done.progress.results.map((item) => item.id));
  });
  it('rolls back both result artifacts when the linked effect fails before its run receipt', async () => {
    const f = await setup(async (request) => offerResponse(request), { failLinks: true }); await f.upload();
    const run = await f.service.create(f.owner, f.input, randomUUID()), failed = await f.drain(run.id);
    expect(failed).toMatchObject({ state: 'waiting_input', failure: 'invalid_result' });
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    expect(failed.progress.results).toHaveLength(0);
  });
  it('accepts answers and creates one linked continuation after the immutable deadline', async () => {
    const f = await setup(async (request) => {
      if (request.jsonSchema) return verified();
      const context = JSON.parse(request.messages[1]!.content!) as { answers: { answer: string }[]; savedResults: unknown[] };
      if (!context.answers.length) return call('ask_user', { questions: [{ id: 'deadline', text: 'When is delivery needed?', required: true }] });
      if (!context.savedResults.length) return call('create_document', { title: 'Delivery plan', paragraphs: [{ kind: 'paragraph', text: `Confirmed delivery: ${context.answers[0]!.answer}` }] });
      return call('finish_work', { summary: 'The delivery plan is saved.' });
    });
    const run = await f.service.create(f.owner, f.input, randomUUID()), paused = await f.drain(run.id);
    expect(paused.progress.questions).toHaveLength(1);
    await expect(f.service.resume(f.owner, run.id, { expectedEpoch: paused.epoch }, randomUUID())).rejects.toMatchObject({ failure: 'conflict' });
    await pool.query("UPDATE agent_runs SET started_at=now()-interval '20 minutes',deadline_at=now()-interval '10 minutes' WHERE id=$1", [run.id]);
    const before = (await pool.query('SELECT deadline_at FROM agent_runs WHERE id=$1', [run.id])).rows[0].deadline_at;
    const key = randomUUID(), input = { expectedEpoch: paused.epoch, answers: [{ questionId: 'deadline', answer: 'Friday afternoon' }] };
    const child = await f.service.resume(f.owner, run.id, input, key);
    expect(child.id).not.toBe(run.id); expect(child.progress.parentRunId).toBe(run.id);
    expect((await f.service.resume(f.owner, run.id, input, key)).id).toBe(child.id);
    expect((await pool.query('SELECT deadline_at FROM agent_runs WHERE id=$1', [run.id])).rows[0].deadline_at).toEqual(before);
    expect((await f.drain(child.id)).state).toBe('completed');
    expect((await f.service.read(f.owner, run.id)).progress.continuationRunId).toBe(child.id);
  });
  it('fences cancellation while a model response is in flight and rechecks revoked access', async () => {
    let finish!: (output: ModelOutput) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const f = await setup(async () => { entered(); return new Promise<ModelOutput>((resolve) => { finish = resolve; }); });
    const run = await f.service.create(f.owner, f.input, randomUUID()), claim = await f.service.claim();
    expect(claim?.runId).toBe(run.id); expect(await f.service.executeStep(claim!)).toBe('continue');
    const executing = f.service.executeStep(claim!); await started;
    const current = await f.service.read(f.owner, run.id); await f.service.cancel(f.owner, run.id, { expectedEpoch: current.epoch }, randomUUID());
    finish(call('create_document', { title: 'Too late', paragraphs: [{ kind: 'paragraph', text: 'Must not be saved.' }] }));
    expect(await executing).toBe('stopped');
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    const revoked = await setup(async () => call('finish_work', { summary: 'Not allowed' }));
    const second = await revoked.service.create(revoked.owner, revoked.input, randomUUID()), secondClaim = await revoked.service.claim();
    await pool.query('UPDATE identity_workspaces SET authz_version=authz_version+1 WHERE id=$1', [revoked.workspaceId]);
    expect(await revoked.service.executeStep(secondClaim!)).toBe('stopped');
    expect(await revoked.service.read(revoked.owner, second.id)).toMatchObject({ state: 'failed', failure: 'access_changed' });
  });
});
