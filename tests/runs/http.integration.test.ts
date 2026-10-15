import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityViewerSchema, WorkspaceResultSchema } from '../../src/features/identity/contracts';
import { RunListPageSchema, RunSchema, type Run, type RunState } from '../../src/contracts/runs';
import { runtimeFixture } from '../../src/features/runs/server/fixture';
import { createRunRegistry } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { isolatedRunPool } from './database';

let pool: Pool;
let origin: string;
beforeAll(() => { pool = isolatedRunPool(); origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`; });
afterAll(async () => { await pool?.end(); });
class Client {
  cookies = new Map<string, string>();
  userId?: string;
  async request(path: string, method = 'GET', body?: unknown, extra: HeadersInit = {}) {
    const headers = new Headers(extra);
    if (method !== 'GET') { if (!headers.has('origin')) headers.set('origin', origin); headers.set('content-type', 'application/json'); }
    if (this.userId && !headers.has('x-tirlik-user-id')) headers.set('x-tirlik-user-id', this.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    for (const serialized of response.headers.getSetCookie()) {
      const first = serialized.split(';')[0]; if (!first) continue;
      const split = first.indexOf('='), name = first.slice(0, split), value = first.slice(split + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}
async function account() {
  const client = new Client(), email = `runtime-http-${randomUUID()}@example.test`, password = 'Synthetic runtime password 42';
  expect((await client.request('/api/auth/sign-up/email', 'POST', { email, password, name: 'Synthetic runtime owner', locale: 'en' })).status).toBe(200);
  const mailOrigin = `http://127.0.0.1:${process.env.TIRLIK_MAIL_UI_PORT}`;
  const search = new URL('/api/v1/search', mailOrigin); search.searchParams.set('query', `to:${email}`);
  const messages = await (await fetch(search)).json() as { messages: { ID: string }[] };
  let token: string | null = null;
  for (const message of messages.messages) {
    const mail = await (await fetch(`${mailOrigin}/api/v1/message/${message.ID}`)).json() as { Text: string };
    const link = mail.Text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/verify\?[^\s]+/)?.[0];
    if (link) { token = new URL(link).searchParams.get('token'); break; }
  }
  expect(token).not.toBeNull();
  expect((await client.request('/api/auth/verify-email', 'POST', { token })).status).toBe(200);
  expect((await client.request('/api/auth/sign-in/email', 'POST', { email, password })).status).toBe(200);
  const viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json()); client.userId = viewer.user.id;
  const workspace = WorkspaceResultSchema.parse(await (await client.request('/api/identity/workspaces', 'POST', { name: 'Synthetic runtime HTTP' }, { 'idempotency-key': randomUUID() })).json()).workspace;
  return { client, viewer, workspace };
}
async function waitState(client: Client, runId: string, expected: RunState): Promise<Run> {
  const deadline = Date.now() + 90_000;
  let run: Run | undefined;
  while (Date.now() < deadline) {
    const response = await client.request(`/api/runs/${runId}`); expect(response.status).toBe(200);
    run = RunSchema.parse(await response.json());
    if (run.state === expected) return run;
    if (run.failure) break;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`RUNTIME_HTTP_STATE_${run?.state ?? 'missing'}_${run?.failure ?? 'no-failure'}_EXPECTED_${expected}`);
}
describe('mounted runtime HTTP and local Workflow', () => {
  it('executes the private free fixture, observes SSE, resumes once and enforces cancellation/session boundaries', async () => {
    const { client, viewer, workspace } = await account();
    const fixture = runtimeFixture(false);
    const service = createRunService(pool, createRunRegistry([fixture.capability], fixture.tools));
    const principal = { kind: 'session' as const, userId: viewer.user.id, sessionId: viewer.session.id };
    const input = { workspaceId: workspace.workspaceId, projectId: null, capabilityId: fixture.capability.id, capabilityVersion: 1, goal: 'Synthetic private HTTP workflow', locale: 'en' as const, inputRefs: [] };
    expect((await client.request('/api/runs', 'POST', input, { 'idempotency-key': randomUUID() })).status).toBe(403);
    // Fixture creation is private test setup; the mounted app owns every Workflow execution.
    const run = await service.create(principal, input, randomUUID(), { trusted: true, privateInput: { pause: true } });
    const waiting = await waitState(client, run.id, 'waiting_input');
    expect(waiting.failure).toBeNull(); expect(waiting.steps[0]?.state).toBe('succeeded'); expect(waiting.actions.resume).toBe(true);
    expect((await pool.query('SELECT workflow_run_id,workflow_state FROM agent_runs WHERE id=$1', [run.id])).rows[0]).toMatchObject({ workflow_state: 'started', workflow_run_id: expect.any(String) });
    const stream = await client.request(`/api/runs/${run.id}/events?after=${waiting.cursor}`, 'GET', undefined, { accept: 'text/event-stream' });
    expect(stream.status).toBe(200); expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const key = randomUUID(), resume = { expectedEpoch: waiting.epoch };
    expect((await client.request(`/api/runs/${run.id}/resume`, 'POST', resume, { 'idempotency-key': key })).status).toBe(200);
    const final = await waitState(client, run.id, 'completed');
    const events = await stream.text();
    const sequences = [...events.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(sequences[0]).toBe(waiting.cursor + 1); expect(new Set(sequences).size).toBe(sequences.length);
    expect(events).toContain('event: settled'); expect(events).not.toContain('synthetic-runtime-check');
    expect(final.steps.every((step) => step.state === 'succeeded')).toBe(true);
    expect(final.budget).toMatchObject({ spentUsd: '0.000000000000', reservedUsd: '0.000000000000', requestCount: 0 });
    expect((await pool.query('SELECT count(*)::int AS count FROM agent_tool_receipts WHERE run_id=$1', [run.id])).rows[0].count).toBe(3);
    const replay = await client.request(`/api/runs/${run.id}/resume`, 'POST', resume, { 'idempotency-key': key });
    expect(replay.status).toBe(200); expect(RunSchema.parse(await replay.json()).state).toBe('completed');
    const listed = RunListPageSchema.parse(await (await client.request(`/api/runs?workspaceId=${workspace.workspaceId}`)).json());
    expect(listed.runs.some((item) => item.id === run.id)).toBe(true);
    expect((await client.request(`/app/runs?workspace=${workspace.workspaceId}`)).status).toBe(200);
    expect((await client.request(`/app/runs/${run.id}`)).status).toBe(200);
    const guest = new Client(); expect((await guest.request(`/api/runs/${run.id}`)).status).toBe(401);
    expect(await (await guest.request(`/app/runs/${run.id}`)).text()).not.toContain(input.goal);
    expect((await client.request(`/api/runs/${run.id}`, 'GET', undefined, { 'x-tirlik-user-id': randomUUID() })).status).toBe(409);
    const cancellable = await service.create(principal, input, randomUUID(), { trusted: true, privateInput: { pause: true } });
    const current = await waitState(client, cancellable.id, 'waiting_input');
    const cancelKey = randomUUID(), cancel = { expectedEpoch: current.epoch };
    expect((await client.request(`/api/runs/${current.id}/cancel`, 'POST', cancel, { 'idempotency-key': cancelKey, origin: 'https://other.invalid' })).status).toBe(403);
    expect((await client.request(`/api/runs/${current.id}/cancel`, 'POST', cancel, { 'idempotency-key': cancelKey })).status).toBe(200);
    expect((await client.request(`/api/runs/${current.id}/cancel`, 'POST', cancel, { 'idempotency-key': cancelKey })).status).toBe(200);
    expect((await waitState(client, current.id, 'cancelled')).budget.requestCount).toBe(0);
    await pool.query("UPDATE identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [viewer.session.id]);
    expect((await client.request(`/api/runs/${run.id}`)).status).toBe(401);
  }, 240_000);
});
