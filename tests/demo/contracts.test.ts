import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoClient, DemoRequestError } from '../../src/features/demo/client';
import {
  CopyDemoSchema,
  DEMO_TTL_HOURS,
  DemoRunStartedSchema,
  DemoSessionSchema,
  DemoStartedSchema,
  StartDemoRunSchema,
} from '../../src/features/demo/contracts';
import { demoCopy } from '../../src/features/demo/locales';
import { demoDecisionResumeInput } from '../../src/features/demo/decision';
import { createOperationsClient } from '../../src/features/operations/client/transport';

const sessionId = '152973d6-2600-4aef-99e1-6c0a9a57c659';
const runId = '252973d6-2600-4aef-99e1-6c0a9a57c650';
const workspaceId = '352973d6-2600-4aef-99e1-6c0a9a57c651';
const artifactId = '452973d6-2600-4aef-99e1-6c0a9a57c652';
const actorId = '552973d6-2600-4aef-99e1-6c0a9a57c653';
const projectId = '652973d6-2600-4aef-99e1-6c0a9a57c654';
const inputRefs = [{ kind: 'artifact' as const, id: artifactId, revision: 0 }];
const scope = { sessionId, expiresAt: '2026-10-17T10:00:00.000Z', revision: 0, locale: 'ru' as const, actorId, workspaceId, projectId, inputRefs };

afterEach(() => vi.unstubAllGlobals());

describe('K5 public demo wire contracts', () => {
  it('keeps the 24-hour scope and matching complete RU/KK/EN copy', () => {
    expect(DEMO_TTL_HOURS).toBe(24);
    expect(Object.keys(demoCopy).sort()).toEqual(['en', 'kk', 'ru']);
    const shape = (value: unknown): unknown => Array.isArray(value) ? value.map(shape) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]))
      : typeof value;
    expect(shape(demoCopy.en)).toEqual(shape(demoCopy.ru));
    expect(shape(demoCopy.kk)).toEqual(shape(demoCopy.ru));
    expect(demoCopy.ru.title).toContain('Срочный заказ');
    expect(demoCopy.ru.scopeBody).toContain('не создают личный проект');
  });

  it('composes the public journey from the canonical session and artifact workspace', async () => {
    const source = await readFile(new URL('../../src/features/demo/ui/demo-page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<AssistantSession');
    expect(source).toContain('<ArtifactWorkspacePage');
    expect(source).toContain('createArtifactClient({ resolvePath })');
    expect(source).toContain('createOperationsClient({ resolvePath })');
    expect(source).toContain('mode="scoped"');
    expect(source).not.toContain('function DecisionOption');
    expect(source).not.toContain('<DocumentEditor');
    expect(source).not.toContain('<SheetEditor');
  });

  it('threads scoped operations through the canonical plan editor instead of account APIs', async () => {
    const [workspace, editor, drawer] = await Promise.all([
      readFile(new URL('../../src/features/workspace/ui/artifact-page.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/features/operations/ui/plan-editor.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/features/operations/ui/resource-drawer.tsx', import.meta.url), 'utf8'),
    ]);
    expect(workspace).toContain('transport={transport?.operations}');
    expect(editor).toContain('const client = transport ?? operationsClient');
    expect(editor).toContain('<ResourceDrawer transport={client}');
    expect(drawer).toContain('transport.list');
    expect(drawer).not.toContain('operationsClient.');
  });

  it('resolves canonical operations requests inside the temporary demo capability', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: 'unknown',
      candidate: { kind: 'plan', schemaVersion: 1, timezone: 'UTC', entries: [] },
      changedEntryIds: [], unresolved: [], conflicts: [],
      checkReceipt: { algorithmVersion: 'k2-interval-search-v1', visitedNodes: 0, searchLimit: 50_000, capacityAssessments: [], inputRevisionVector: {} },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createOperationsClient({ fetcher, resolvePath: (path) => `/api/demo/sessions/${sessionId}${path.slice(4)}` });
    await client.propose({
      workspaceId, expectedAuthzVersion: 1,
      input: { plan: { kind: 'plan', schemaVersion: 1, timezone: 'UTC', entries: [] }, resourceRefs: [], window: { start: '2026-10-17T00:00:00.000Z', end: '2026-10-18T00:00:00.000Z' }, lockedEntryIds: [], materialConstraints: [], objective: 'earliest-finish' },
    }, { userId: actorId });
    expect(fetcher).toHaveBeenCalledWith(`/api/demo/sessions/${sessionId}/operations/plan-proposals`, expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
  });

  it('requires pinned input revisions and explicit copy destinations', () => {
    expect(DemoStartedSchema.parse(scope).inputRefs).toEqual(inputRefs);
    expect(StartDemoRunSchema.safeParse({ goal: 'Check order', inputRefs, expectedRevision: 0 }).success).toBe(true);
    expect(StartDemoRunSchema.safeParse({ goal: 'Check order', inputRefs: [], expectedRevision: 0 }).success).toBe(false);
    expect(CopyDemoSchema.safeParse({ expectedRevision: 1, artifactIds: [artifactId], destinationWorkspaceId: workspaceId }).success).toBe(true);
    expect(CopyDemoSchema.safeParse({ expectedRevision: 1, artifactIds: [artifactId, artifactId], destinationWorkspaceId: workspaceId }).success).toBe(false);
    expect(DemoSessionSchema.safeParse({ ...scope, revision: 1, results: [], runIds: [runId] }).success).toBe(true);
    expect(DemoRunStartedSchema.parse({ runId, cursor: 0 })).toEqual({ runId, cursor: 0 });
  });

  it('continues commercial and work decisions only with explicit valid controls', () => {
    const commercial = { options: [{ id: 'standard', outcome: 'conditional' as const }, { id: 'unsafe', outcome: 'not_confirmed' as const }] };
    const questions = [{ id: 'select_option', required: true }, { id: 'accept_conditions_standard', required: true }];
    const base = { expectedEpoch: 3, selectedOptionId: 'standard', acceptedConditionIds: [] as string[], questions, decision: commercial };
    expect(demoDecisionResumeInput(base)).toBeNull();
    expect(demoDecisionResumeInput({ ...base, acceptedConditionIds: ['accept_conditions_standard'] })).toEqual({ expectedEpoch: 3, selectedOptionId: 'standard', acceptedConditionIds: ['accept_conditions_standard'] });
    expect(demoDecisionResumeInput({ ...base, selectedOptionId: 'unsafe', acceptedConditionIds: [] })).toBeNull();
    expect(demoDecisionResumeInput({ ...base, decision: null, workDecision: { options: [{ id: 'precise' }, { id: 'bold' }] }, selectedOptionId: 'bold' })).toEqual({ expectedEpoch: 3, selectedOptionId: 'bold' });
  });

  it('uses only explicit K5 endpoints, credentials and idempotency keys', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(scope), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId, cursor: 0 }), { status: 202, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: runId, workspaceId, projectId, createdBy: artifactId, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Changed deadline', locale: 'ru', state: 'queued', failure: null, epoch: 1, cursor: 0, steps: [], progress: { plan: [], summary: '', questions: [], results: [], parentRunId: null, continuationRunId: null }, budget: { limitUsd: '0.5', reservedUsd: '0', spentUsd: '0', requestCount: 0, requestLimit: 12 }, actions: { resume: false, cancel: true, revise: false, retryStepIds: [] }, createdAt: '2026-10-17T10:00:00.000Z', updatedAt: '2026-10-17T10:00:00.000Z', startedAt: null, deadlineAt: null }), { status: 202, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ projectId: workspaceId, artifacts: [{ id: artifactId, revision: 0 }] }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await demoClient.start('ru');
    await demoClient.startRun(sessionId, { goal: 'Check order', inputRefs, expectedRevision: 0 }, 'run-key');
    await demoClient.resumeRun(sessionId, runId, { expectedEpoch: 0, goal: 'Changed deadline' }, 'resume-key');
    await demoClient.copy(sessionId, { expectedRevision: 1, artifactIds: [artifactId], destinationWorkspaceId: workspaceId }, 'copy-key');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/demo/sessions',
      `/api/demo/sessions/${sessionId}/runs`,
      `/api/demo/sessions/${sessionId}/runs/${runId}/resume`,
      `/api/demo/sessions/${sessionId}/copy`,
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ 'Idempotency-Key': 'run-key' });
    expect((fetchMock.mock.calls[2]![1] as RequestInit).headers).toMatchObject({ 'Idempotency-Key': 'resume-key' });
    expect((fetchMock.mock.calls[3]![1] as RequestInit).headers).toMatchObject({ 'Idempotency-Key': 'copy-key' });
  });

  it('exposes rate and expiry failures without manufacturing success', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'RATE_LIMITED', retryAfterSeconds: 40 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'DEMO_EXPIRED' }), { status: 410 })));
    await expect(demoClient.start('ru')).rejects.toEqual(expect.objectContaining<Partial<DemoRequestError>>({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 40 }));
    await expect(demoClient.session(sessionId)).rejects.toEqual(expect.objectContaining<Partial<DemoRequestError>>({ status: 410, code: 'DEMO_EXPIRED' }));
  });
});
