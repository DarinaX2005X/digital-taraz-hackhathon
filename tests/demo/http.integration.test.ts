import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunEventsPageSchema, RunSchema } from '../../src/contracts/runs';
import { WorkspaceEventPageSchema } from '../../src/contracts/events';
import { ArtifactHistorySchema, ArtifactSnapshotSchema, ArtifactVersionPageSchema, CommandReceiptSchema } from '../../src/features/artifacts/contracts';
import { createArtifactTargetResolver } from '../../src/features/artifacts/domain/targets';
import { IdentityViewerSchema } from '../../src/features/identity/contracts';
import { DemoCopiedSchema, DemoRunStartedSchema, DemoSessionSchema, DemoStartedSchema } from '../../src/features/demo/contracts';
import { demoCopy } from '../../src/features/demo/locales';
import { AvailabilityHistorySchema, WorkResourceListSchema, WorkResourceResultSchema } from '../../src/features/operations/contracts';
import { planCommand } from '../../src/features/operations/domain/commands';
import { ProposeWorkPlanResultSchema } from '../../src/features/operations/domain/propose-work-plan';
import { zonedParts } from '../../src/features/operations/domain/time';
import { ProjectResultSchema } from '../../src/features/workspace/contracts';

let pool: Pool, origin: string;
const password = 'Synthetic demo account password 42';

class Client {
  cookies = new Map<string, string>();
  userId?: string;
  async request(path: string, method = 'GET', body?: unknown, key?: string) {
    const headers = new Headers();
    if (method !== 'GET') { headers.set('origin', origin); headers.set('content-type', 'application/json'); }
    if (key) headers.set('idempotency-key', key);
    if (this.userId) headers.set('x-tirlik-user-id', this.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    for (const serialized of response.headers.getSetCookie()) {
      const first = serialized.split(';')[0]!, split = first.indexOf('='), name = first.slice(0, split), value = first.slice(split + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}

async function durableCounts() {
  return (await pool.query(`SELECT
    (SELECT count(*) FROM identity_users)::int AS users,
    (SELECT count(*) FROM identity_workspaces)::int AS workspaces,
    (SELECT count(*) FROM projects)::int AS projects,
    (SELECT count(*) FROM artifacts)::int AS artifacts,
    (SELECT count(*) FROM agent_runs)::int AS runs,
    (SELECT count(*) FROM agent_run_usage)::int AS provider_usage,
    (SELECT count(*) FROM demo_execution_scopes)::int AS demo_scopes,
    (SELECT count(*) FROM demo_execution_operations)::int AS demo_operations`)).rows[0];
}

async function authenticate(client: Client) {
  const email = `demo-copy-${randomUUID()}@example.test`;
  const signup = await client.request('/api/auth/sign-up/email', 'POST', { email, password, name: 'Synthetic demo owner', locale: 'ru', returnTo: '/ru/demo' });
  expect(signup.status).toBe(200);
  expect(await signup.json()).toEqual({ status: 'account-checked', returnTo: '/ru/demo' });
  expect((await client.request('/api/identity/me')).status).toBe(200);
  await client.request('/api/auth/sign-out', 'POST', {});
  const login = await client.request('/api/auth/sign-in/email', 'POST', { email, password, returnTo: '/ru/demo' });
  expect(login.status).toBe(200);
  expect(await login.json()).toEqual({ status: 'signed-in', returnTo: '/ru/demo' });
  let viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json());
  client.userId = viewer.user.id;
  if (!viewer.workspaces.some((workspace) => workspace.scopes.includes('edit'))) {
    const created = await client.request('/api/identity/workspaces', 'POST', { name: 'Demo destination' }, randomUUID());
    expect(created.status).toBe(201);
    viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json());
  }
  return viewer;
}

beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const database = new URL(process.env.DATABASE_URL ?? '');
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/tirlik' || new URL(origin).hostname !== '127.0.0.1' || process.env.OPENROUTER_API_KEY || process.env.BREVO_API_KEY || process.env.SMTP_PASSWORD) throw new Error('ISOLATED_LOCAL_SERVICES_REQUIRED');
  pool = new Pool({ connectionString: database.href });
});
afterAll(async () => { await pool?.end(); });

describe('isolated K5 public demo over real HTTP and PostgreSQL', () => {
  it.each(['ru', 'kk', 'en'] as const)('serves the %s case without creating any records before explicit start', async (locale) => {
    const before = await durableCounts();
    const response = await fetch(`${origin}/${locale}/demo`, { headers: { 'Accept-Language': locale }, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(`lang="${locale}"`); expect(html).toContain(demoCopy[locale].title); expect(html).toContain(demoCopy[locale].scopeBody); expect(html).toContain(demoCopy[locale].start); expect(html).not.toContain('id="__next_error__"');
    expect(await durableCounts()).toEqual(before);
  }, 75_000);

  it('redirects the app entry by locale without starting a scope', async () => {
    const before = await durableCounts();
    const response = await fetch(`${origin}/app/demo`, { headers: { 'Accept-Language': 'kk' }, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    expect(response.status).toBe(307); expect(response.headers.get('location')).toBe('/kk/demo'); await response.body?.cancel();
    expect(await durableCounts()).toEqual(before);
  });

  it('starts one bounded scope, runs through the shared business runtime and copies only after authenticated confirmation', async () => {
    const client = new Client(), startKey = randomUUID();
    const startedResponse = await client.request('/api/demo/sessions', 'POST', { locale: 'ru' }, startKey);
    expect(startedResponse.status).toBe(201);
    const cookieHeader = startedResponse.headers.getSetCookie().find((value) => value.startsWith('tirlik-demo-')) ?? '';
    expect(cookieHeader).toMatch(/HttpOnly/i); expect(cookieHeader).toMatch(/SameSite=Lax/i); expect(cookieHeader).toMatch(/Max-Age=86400/i);
    const started = DemoStartedSchema.parse(await startedResponse.json());
    expect(cookieHeader).toContain(`Path=/api/demo/sessions/${started.sessionId}`);

    const replay = await client.request('/api/demo/sessions', 'POST', { locale: 'ru' }, startKey);
    expect(replay.status).toBe(201); expect(DemoStartedSchema.parse(await replay.json())).toEqual(started);
    const scope = DemoSessionSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}`)).json());
    expect(scope.inputRefs).toEqual(started.inputRefs); expect(scope.runIds).toEqual([]); expect(scope.results).toEqual([]);

    const briefRef = scope.inputRefs[0]!;
    const briefResponse = await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/${briefRef.id}?workspaceId=${scope.workspaceId}`);
    expect(briefResponse.status).toBe(200);
    const brief = ArtifactSnapshotSchema.parse(await briefResponse.json());
    expect(brief).toMatchObject({ viewer: { userId: scope.actorId, workspaceId: scope.workspaceId, authzVersion: 1 }, artifact: { id: briefRef.id, projectId: scope.projectId, currentRevision: 0, kind: 'document' } });
    expect(JSON.stringify(brief.content)).toContain('Сары-Арқа'); expect(JSON.stringify(brief.content)).not.toContain('кофейн');

    const target = createArtifactTargetResolver(brief.content)('fact-7')!, commandGroupId = randomUUID();
    const command = { workspaceId: scope.workspaceId, expectedAuthzVersion: 1, group: { commandGroupId, expectedArtifactRevisions: { [briefRef.id]: 0 }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: briefRef.id, baseRevision: 0, kind: 'document', expectedSourceRevisions: {}, reason: 'Saved edit from the public workspace', operations: [{ targetId: 'fact-7', op: 'set', beforeHash: target.hash, value: { type: 'paragraph', attrs: { id: 'fact-7' }, content: [{ type: 'text', text: 'Подготовьте только жизнеспособную первую очередь. Клиенту ничего не отправляйте.' }] } }] }] } };
    const commandResponse = await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/commands`, 'POST', command, commandGroupId);
    expect(commandResponse.status).toBe(200);
    expect(CommandReceiptSchema.parse(await commandResponse.json()).committedRevisionVector[briefRef.id]).toBe(1);
    const history = ArtifactHistorySchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/${briefRef.id}/history?workspaceId=${scope.workspaceId}`)).json());
    expect(history.groups[0]?.commandGroupId).toBe(commandGroupId);
    const versions = ArtifactVersionPageSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/${briefRef.id}/versions?workspaceId=${scope.workspaceId}&limit=10`)).json());
    expect(versions.versions.map((item) => item.revision)).toEqual([1, 0]);
    const events = WorkspaceEventPageSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}/workspace-events?workspaceId=${scope.workspaceId}&cursor=${encodeURIComponent(brief.cursor)}&limit=100`)).json());
    expect(events.workspaceId).toBe(scope.workspaceId); expect(events.events.some((event) => event.objectId === briefRef.id)).toBe(true);

    const resourcesResponse = await client.request(`/api/demo/sessions/${started.sessionId}/operations/resources?workspaceId=${scope.workspaceId}&status=active&limit=50`);
    expect(resourcesResponse.status).toBe(200);
    const resources = WorkResourceListSchema.parse(await resourcesResponse.json());
    expect(resources.viewer).toMatchObject({ userId: scope.actorId, workspaceId: scope.workspaceId, authzVersion: 1 });
    expect(resources.resources.map((resource) => resource.displayName).sort()).toEqual(['Prepress and installation team', 'Wide-format printer']);
    for (const resource of resources.resources) {
      const readResponse = await client.request(`/api/demo/sessions/${started.sessionId}/operations/resources/${resource.id}?workspaceId=${scope.workspaceId}`);
      expect(readResponse.status).toBe(200);
      expect(WorkResourceResultSchema.parse(await readResponse.json()).resource.id).toBe(resource.id);
      const availabilityResponse = await client.request(`/api/demo/sessions/${started.sessionId}/operations/resources/${resource.id}/availability?workspaceId=${scope.workspaceId}`);
      expect(availabilityResponse.status).toBe(200);
      const availability = AvailabilityHistorySchema.parse(await availabilityResponse.json());
      expect(availability.versions[0]?.id).toBe(resource.currentAvailabilityVersionId);
    }

    const planRef = scope.inputRefs[1]!;
    const planResponse = await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/${planRef.id}?workspaceId=${scope.workspaceId}`);
    expect(planResponse.status).toBe(200);
    const planSnapshot = ArtifactSnapshotSchema.parse(await planResponse.json());
    if (planSnapshot.content.kind !== 'plan') throw new Error('DEMO_PLAN_INPUT_REQUIRED');
    const qadam = planSnapshot.content.entries.find((entry) => entry.id === 'qadam-market')!;
    expect(zonedParts(qadam.startAt!, planSnapshot.content.timezone).hour).toBe(9);
    expect(zonedParts(qadam.endAt!, planSnapshot.content.timezone).hour).toBe(17);
    const firstRelease = planSnapshot.content.entries.filter((entry) => entry.id === 'sary-arqa-pharmacy' || entry.id === 'sary-arqa-pharmacy-release-finish');
    expect(firstRelease.map((entry) => entry.durationMinutes).reduce<number>((sum, minutes) => sum + (minutes ?? 0), 0)).toBe(540);
    expect(firstRelease.map((entry) => entry.notes).join(' ')).toMatch(/960-minute.*18 m².*11 m²|960 minutes.*18 m².*11 m²/);
    const lockedEntryIds = Object.keys(planSnapshot.locks ?? {}).sort();
    expect(lockedEntryIds).toEqual(['orda-logistics', 'qadam-market']);
    const proposalResponse = await client.request(`/api/demo/sessions/${started.sessionId}/operations/plan-proposals`, 'POST', {
      workspaceId: scope.workspaceId,
      expectedAuthzVersion: 1,
      input: {
        plan: planSnapshot.content,
        resourceRefs: resources.resources.flatMap((resource) => resource.currentAvailabilityVersionId ? [{ id: resource.id, revision: resource.revision, availabilityVersionId: resource.currentAvailabilityVersionId }] : []),
        window: { start: new Date(Date.now() - 7 * 86_400_000).toISOString(), end: new Date(Date.now() + 21 * 86_400_000).toISOString() },
        lockedEntryIds, materialConstraints: [], objective: 'earliest-finish',
      },
    });
    expect(proposalResponse.status).toBe(200);
    const proposal = ProposeWorkPlanResultSchema.parse(await proposalResponse.json());
    expect(['feasible', 'partial']).toContain(proposal.status);
    expect(proposal.changedEntryIds).toContain('sary-arqa-pharmacy');
    expect(proposal.changedEntryIds).toContain('sary-arqa-pharmacy-release-finish');
    const proposedFirst = proposal.candidate.entries.find((entry) => entry.id === 'sary-arqa-pharmacy')!;
    const proposedFinish = proposal.candidate.entries.find((entry) => entry.id === 'sary-arqa-pharmacy-release-finish')!;
    expect(Date.parse(proposedFirst.endAt!)).toBeLessThanOrEqual(Date.parse(proposedFinish.startAt!));
    const proposalCommand = await planCommand(planSnapshot, proposal.candidate, 'Apply scoped demo plan proposal');
    expect(proposalCommand).not.toBeNull();
    const proposalCommandGroupId = randomUUID();
    const proposalGroup = { ...proposalCommand!, commandGroupId: proposalCommandGroupId, commands: proposalCommand!.commands.map((command) => ({ ...command, commandId: randomUUID() })) };
    const applyProposalResponse = await client.request(`/api/demo/sessions/${started.sessionId}/artifacts/commands`, 'POST', { workspaceId: scope.workspaceId, expectedAuthzVersion: 1, group: proposalGroup }, proposalCommandGroupId);
    expect(applyProposalResponse.status).toBe(200);
    expect(CommandReceiptSchema.parse(await applyProposalResponse.json()).committedRevisionVector[planRef.id]).toBe(planSnapshot.artifact.currentRevision + 1);

    const editedScope = DemoSessionSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}`)).json());
    expect(editedScope).toMatchObject({ revision: 2, inputRefs: expect.arrayContaining([expect.objectContaining({ id: briefRef.id, revision: 1 }), expect.objectContaining({ id: planRef.id, revision: planSnapshot.artifact.currentRevision + 1 })]) });

    const exportResponse = await client.request(`/api/demo/sessions/${started.sessionId}/exports`, 'POST', { workspaceId: scope.workspaceId, expectedAuthzVersion: 1, locale: 'ru', items: [{ artifactId: briefRef.id, revision: 1, formats: ['pdf'] }] }, randomUUID());
    expect(exportResponse.status).toBe(201);
    const exportJob = await exportResponse.json() as { id: string };
    const renderResponse = await client.request(`/api/demo/sessions/${started.sessionId}/exports/${exportJob.id}/render`, 'POST', { workspaceId: scope.workspaceId, expectedAuthzVersion: 1 });
    expect(renderResponse.status).toBe(200);
    const rendered = await renderResponse.json() as { status: string; files: { id: string; status: string; format: string }[] };
    expect(rendered).toMatchObject({ status: 'ready', files: [expect.objectContaining({ status: 'ready', format: 'pdf' })] });
    const download = await client.request(`/api/demo/sessions/${started.sessionId}/exports/${exportJob.id}/files/${rendered.files[0]!.id}?workspaceId=${scope.workspaceId}`);
    expect(download.status).toBe(200); expect(download.headers.get('content-type')).toBe('application/pdf'); expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(500);

    const foreign = new Client();
    expect((await foreign.request(`/api/demo/sessions/${started.sessionId}`)).status).toBe(404);
    const foreignStarted = DemoStartedSchema.parse(await (await foreign.request('/api/demo/sessions', 'POST', { locale: 'kk' }, randomUUID())).json());
    expect(foreignStarted.sessionId).not.toBe(started.sessionId);
    expect((await foreign.request(`/api/demo/sessions/${started.sessionId}`)).status).toBe(404);
    expect((await foreign.request(`/api/demo/sessions/${started.sessionId}/operations/resources?workspaceId=${scope.workspaceId}`)).status).toBe(404);

    const runResponse = await client.request(`/api/demo/sessions/${started.sessionId}/runs`, 'POST', { goal: demoCopy.ru.goal, inputRefs: editedScope.inputRefs, expectedRevision: editedScope.revision }, randomUUID());
    expect(runResponse.status).toBe(202);
    const createdRun = DemoRunStartedSchema.parse(await runResponse.json());
    const runReadResponse = await client.request(`/api/demo/sessions/${started.sessionId}/runs/${createdRun.runId}`);
    expect(runReadResponse.status).toBe(200);
    const initialRun = RunSchema.parse(await runReadResponse.json());
    expect(initialRun).toMatchObject({ id: createdRun.runId, capabilityId: 'business.goal', capabilityVersion: 1 });
    const eventResponse = await client.request(`/api/demo/sessions/${started.sessionId}/runs/${createdRun.runId}/events?after=0`);
    expect(eventResponse.status).toBe(200);
    expect(RunEventsPageSchema.parse(await eventResponse.json()).runId).toBe(createdRun.runId);

    const changedGoal = `${demoCopy.ru.goal} Новое условие: открытие перенесено на понедельник.`;
    const changedResponse = await client.request(`/api/demo/sessions/${started.sessionId}/runs/${createdRun.runId}/resume`, 'POST', { expectedEpoch: initialRun.epoch, goal: changedGoal }, randomUUID());
    expect(changedResponse.status).toBe(202);
    const changedRun = RunSchema.parse(await changedResponse.json());
    expect(changedRun.id).not.toBe(createdRun.runId); expect(changedRun.goal).toBe(changedGoal);
    expect((await pool.query('SELECT reason FROM agent_run_continuations WHERE parent_run_id=$1 AND child_run_id=$2', [createdRun.runId, changedRun.id])).rows[0]).toEqual({ reason: 'goal-change' });

    await pool.query(`UPDATE agent_runs SET state='failed',failure_code='provider',execution_epoch=execution_epoch+1,lease_owner=NULL,lease_until=NULL,finished_at=now(),updated_at=now() WHERE id=$1`, [changedRun.id]);
    const restartScope = DemoSessionSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}`)).json());
    const restartResponse = await client.request(`/api/demo/sessions/${started.sessionId}/runs`, 'POST', { goal: changedGoal, inputRefs: restartScope.inputRefs, expectedRevision: restartScope.revision }, randomUUID());
    expect(restartResponse.status).toBe(202);
    const restarted = DemoRunStartedSchema.parse(await restartResponse.json());
    expect(restarted.runId).not.toBe(changedRun.id);
    const restartedRun = RunSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}/runs/${restarted.runId}`)).json());
    expect(restartedRun.progress.parentRunId).toBeNull();

    const authority = (await pool.query<{ capability_id: string; capability_version: number; execution_authority: { kind?: string; sessionId?: string } | null }>(`SELECT r.capability_id,r.capability_version,c.state->'executionAuthority' AS execution_authority FROM agent_runs r JOIN agent_run_contexts c ON c.run_id=r.id WHERE r.id=$1`, [createdRun.runId])).rows[0]!;
    expect(authority.capability_id).toBe('business.goal'); expect(authority.capability_version).toBe(1);
    expect(authority.execution_authority).toMatchObject({ kind: 'demo', sessionId: started.sessionId });

    const resultRef = { kind: 'artifact', id: editedScope.inputRefs[0]!.id, revision: editedScope.inputRefs[0]!.revision, title: 'Canonical demo result' };
    await pool.query(`UPDATE agent_runs SET state='review_ready',failure_code=NULL,execution_epoch=execution_epoch+1,lease_owner=NULL,lease_until=NULL,finished_at=NULL,updated_at=now() WHERE id=$1`, [changedRun.id]);
    await pool.query(`UPDATE agent_run_steps SET state='skipped',retryable=false,finished_at=now() WHERE run_id=$1 AND state IN ('planned','claimed')`, [changedRun.id]);
    await pool.query(`UPDATE agent_run_contexts SET state=jsonb_set(state,'{results}',$2::jsonb),revision=revision+1,updated_at=now() WHERE run_id=$1`, [changedRun.id, JSON.stringify([resultRef])]);
    const refreshed = DemoSessionSchema.parse(await (await client.request(`/api/demo/sessions/${started.sessionId}`)).json());
    expect(refreshed.results).toContainEqual({ kind: 'artifact', id: resultRef.id, revision: resultRef.revision });
    expect(refreshed.runIds).toEqual(expect.arrayContaining([createdRun.runId, changedRun.id]));

    const copyBodyWithoutAuth = { expectedRevision: refreshed.revision, artifactIds: [resultRef.id], destinationWorkspaceId: randomUUID() };
    expect((await client.request(`/api/demo/sessions/${started.sessionId}/copy`, 'POST', copyBodyWithoutAuth, randomUUID())).status).toBe(401);

    const viewer = await authenticate(client), destination = viewer.workspaces.find((workspace) => workspace.scopes.includes('edit'))!;
    expect(destination).toBeDefined();
    const copyBody = { expectedRevision: refreshed.revision, artifactIds: [resultRef.id], destinationWorkspaceId: destination.workspaceId };
    const copyKey = randomUUID(), beforeCopy = await pool.query<{ projects: number; artifacts: number }>('SELECT (SELECT count(*)::int FROM projects WHERE workspace_id=$1) projects,(SELECT count(*)::int FROM artifacts WHERE workspace_id=$1) artifacts', [destination.workspaceId]);
    const copiedResponse = await client.request(`/api/demo/sessions/${started.sessionId}/copy`, 'POST', copyBody, copyKey);
    expect(copiedResponse.status).toBe(201);
    const copied = DemoCopiedSchema.parse(await copiedResponse.json()); expect(copied.artifacts).toHaveLength(1);
    const reopenedProjectResponse = await client.request(`/api/projects/${copied.projectId}?workspaceId=${destination.workspaceId}`);
    expect(reopenedProjectResponse.status).toBe(200);
    const reopenedProject = ProjectResultSchema.parse(await reopenedProjectResponse.json());
    expect(reopenedProject.project).toMatchObject({ id: copied.projectId, workspaceId: destination.workspaceId, title: 'Sary-Arqa #12 signage decision' });
    const reopenedArtifactResponse = await client.request(`/api/artifacts/${copied.artifacts[0]!.id}?workspaceId=${destination.workspaceId}`);
    expect(reopenedArtifactResponse.status).toBe(200);
    const reopenedArtifact = ArtifactSnapshotSchema.parse(await reopenedArtifactResponse.json());
    expect(reopenedArtifact.artifact).toMatchObject({ id: copied.artifacts[0]!.id, projectId: copied.projectId, currentRevision: copied.artifacts[0]!.revision, title: 'Sary-Arqa #12 order, costs and supplier change' });
    expect(reopenedArtifact.content.kind).toBe('document');
    const afterCopy = (await pool.query<{ projects: number; artifacts: number }>('SELECT (SELECT count(*)::int FROM projects WHERE workspace_id=$1) projects,(SELECT count(*)::int FROM artifacts WHERE workspace_id=$1) artifacts', [destination.workspaceId])).rows[0]!;
    expect(afterCopy).toEqual({ projects: beforeCopy.rows[0]!.projects + 1, artifacts: beforeCopy.rows[0]!.artifacts + 1 });
    const repeated = await client.request(`/api/demo/sessions/${started.sessionId}/copy`, 'POST', copyBody, copyKey);
    expect(repeated.status).toBe(201); expect(DemoCopiedSchema.parse(await repeated.json())).toEqual(copied);
    expect((await pool.query('SELECT count(*)::int AS count FROM projects WHERE workspace_id=$1', [destination.workspaceId])).rows[0].count).toBe(afterCopy.projects);
    expect((await client.request(`/api/demo/sessions/${started.sessionId}/copy`, 'POST', copyBody, randomUUID())).status).toBe(409);
  }, 220_000);

  it('rejects cross-origin starts and expires the capability without manufacturing a result', async () => {
    const before = await durableCounts();
    const csrf = await fetch(`${origin}/api/demo/sessions`, { method: 'POST', headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ locale: 'en' }), signal: AbortSignal.timeout(120_000) });
    expect(csrf.status).toBe(403); expect((await csrf.json()).code).toBe('FORBIDDEN'); expect(await durableCounts()).toEqual(before);

    const client = new Client();
    const started = DemoStartedSchema.parse(await (await client.request('/api/demo/sessions', 'POST', { locale: 'en' }, randomUUID())).json());
    await pool.query("UPDATE demo_execution_scopes SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1", [started.sessionId]);
    const expired = await client.request(`/api/demo/sessions/${started.sessionId}`);
    expect(expired.status).toBe(410); expect((await expired.json()).code).toBe('DEMO_EXPIRED');
  }, 120_000);
});
