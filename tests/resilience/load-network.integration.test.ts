import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunListPageSchema } from '../../src/contracts/runs';
import { ArtifactMutationResultSchema, ArtifactSnapshotSchema, CommandReceiptSchema } from '../../src/features/artifacts/contracts';
import { createArtifactTargetResolver } from '../../src/features/artifacts/domain/targets';
import { businessRegistration } from '../../src/features/agent-tools/server/business';
import { scopesForRole } from '../../src/features/identity/domain/policy';
import { IdentityViewerSchema, WorkspaceResultSchema } from '../../src/features/identity/contracts';
import { createRunRegistry } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { ProjectResultSchema } from '../../src/features/workspace/contracts';
import { testDocument } from '../artifacts/server/test-fixture';
import { isolatedRunPool } from '../runs/database';

let origin: string;
let pool: Pool;

beforeAll(() => {
  pool = isolatedRunPool();
  origin = `http://127.0.0.1:${process.env.TIRLIK_TEST_APP_PORT}`;
});
afterAll(async () => { await pool?.end(); });

class Client {
  cookies = new Map<string, string>();
  userId?: string;

  async request(path: string, method = 'GET', body?: unknown, extra: HeadersInit = {}) {
    const headers = new Headers(extra);
    if (method !== 'GET') {
      headers.set('origin', origin);
      headers.set('content-type', 'application/json');
    }
    if (this.userId) headers.set('x-tirlik-user-id', this.userId);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    for (const serialized of response.headers.getSetCookie()) {
      const first = serialized.split(';')[0]!;
      const split = first.indexOf('=');
      const name = first.slice(0, split), value = first.slice(split + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }
}

async function account(index: number) {
  const client = new Client();
  const response = await client.request('/api/auth/sign-up/email', 'POST', {
    email: `load-network-${index}-${randomUUID()}@example.test`,
    password: 'Synthetic load password 42',
    name: `Load network user ${index + 1}`,
    locale: 'en',
  });
  expect(response.status).toBe(200);
  const viewer = IdentityViewerSchema.parse(await (await client.request('/api/identity/me')).json());
  client.userId = viewer.user.id;
  return { client, viewer };
}

describe('mounted multi-tenant load boundary', () => {
  it('serves twenty authenticated users and a manual edit over the real network while the queue is saturated', async () => {
    const accounts = await Promise.all(Array.from({ length: 20 }, (_, index) => account(index)));
    const tenants: {
      accounts: typeof accounts;
      artifactId: string;
      projectId: string;
      workspaceId: string;
    }[] = [];

    for (let tenantIndex = 0; tenantIndex < 5; tenantIndex++) {
      const members = accounts.slice(tenantIndex * 4, tenantIndex * 4 + 4);
      const owner = members[0]!;
      const workspaceResponse = await owner.client.request('/api/identity/workspaces', 'POST', {
        name: `Mounted load workspace ${tenantIndex + 1}`,
      }, { 'idempotency-key': randomUUID() });
      expect(workspaceResponse.status).toBe(201);
      const workspace = WorkspaceResultSchema.parse(await workspaceResponse.json()).workspace;
      const projectResponse = await owner.client.request('/api/projects', 'POST', {
        workspaceId: workspace.workspaceId,
        expectedAuthzVersion: workspace.authzVersion,
        title: `Mounted load project ${tenantIndex + 1}`,
      }, { 'idempotency-key': randomUUID() });
      expect(projectResponse.status).toBe(201);
      const project = ProjectResultSchema.parse(await projectResponse.json());
      const artifactResponse = await owner.client.request('/api/artifacts', 'POST', {
        workspaceId: workspace.workspaceId,
        projectId: project.project.id,
        expectedAuthzVersion: project.authzVersion,
        title: 'Manual work during mounted load',
        content: testDocument(),
      }, { 'idempotency-key': randomUUID() });
      expect(artifactResponse.status).toBe(201);
      const artifact = ArtifactMutationResultSchema.parse(await artifactResponse.json());

      for (const member of members.slice(1)) {
        await pool.query('INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,$4,$5)', [
          randomUUID(), workspace.workspaceId, member.viewer.user.id, 'editor', scopesForRole('editor'),
        ]);
        await pool.query('INSERT INTO identity_project_grants(workspace_id,project_id,user_id,scopes) VALUES($1,$2,$3,$4)', [
          workspace.workspaceId, project.project.id, member.viewer.user.id, scopesForRole('editor'),
        ]);
      }
      tenants.push({ accounts: members, artifactId: artifact.artifact.id, projectId: project.project.id, workspaceId: workspace.workspaceId });
    }

    const registration = businessRegistration(pool, { gateway: { complete: async () => ({ content: null, toolCalls: [] }) } });
    const service = createRunService(pool, createRunRegistry([registration.capability], registration.tools));
    const runs: { id: string; owner: (typeof accounts)[number] }[] = [];
    try {
      for (const tenant of tenants) {
        const owner = tenant.accounts[0]!;
        const principal = { kind: 'session' as const, userId: owner.viewer.user.id, sessionId: owner.viewer.session.id };
        for (let index = 0; index < 6; index++) {
          const run = await service.create(principal, {
            workspaceId: tenant.workspaceId,
            projectId: tenant.projectId,
            capabilityId: 'business.goal',
            capabilityVersion: 1,
            goal: `Mounted bounded work ${index + 1}`,
            locale: 'en',
            inputRefs: [],
          }, randomUUID());
          runs.push({ id: run.id, owner });
        }
      }
      const claims = await Promise.all(Array.from({ length: 20 }, () => service.claim()));
      expect(claims.filter(Boolean)).toHaveLength(8);
      expect((await pool.query("SELECT count(*)::int AS count FROM agent_runs WHERE state='queued'")).rows[0].count).toBe(22);

      for (const tenant of tenants) {
        expect((await tenant.accounts[0]!.client.request(`/api/runs?workspaceId=${tenant.workspaceId}`)).status).toBe(200);
      }
      const readers = tenants.flatMap((tenant) => tenant.accounts.map((account) => ({ account, tenant })));
      expect(readers).toHaveLength(20);
      const measurements = await Promise.all(readers.map(async ({ account: reader, tenant }) => {
        const started = performance.now();
        const response = await reader.client.request(`/api/runs?workspaceId=${tenant.workspaceId}`);
        const body = await response.text();
        return {
          body,
          bytes: Buffer.byteLength(body),
          durationMs: performance.now() - started,
          status: response.status,
        };
      }));
      expect(measurements.every((measurement) => measurement.status === 200)).toBe(true);
      expect(measurements.every((measurement) => measurement.bytes < 1_048_576)).toBe(true);
      expect(measurements.every((measurement) => RunListPageSchema.parse(JSON.parse(measurement.body)).runs.length === 6)).toBe(true);
      const networkDurations = measurements.map((measurement) => measurement.durationMs).sort((left, right) => left - right);
      const networkP95 = networkDurations[Math.ceil(networkDurations.length * 0.95) - 1]!;
      expect(networkP95).toBeLessThan(500);

      const manualTenant = tenants[0]!, owner = manualTenant.accounts[0]!;
      const artifactUrl = `/api/artifacts/${manualTenant.artifactId}?workspaceId=${manualTenant.workspaceId}`;
      const snapshot = ArtifactSnapshotSchema.parse(await (await owner.client.request(artifactUrl)).json());
      const target = createArtifactTargetResolver(snapshot.content)('p1')!;
      const groupId = randomUUID();
      const editStarted = performance.now();
      const editedResponse = await owner.client.request('/api/artifacts/commands', 'POST', {
        workspaceId: manualTenant.workspaceId,
        expectedAuthzVersion: snapshot.viewer.authzVersion,
        group: {
          commandGroupId: groupId,
          expectedArtifactRevisions: { [manualTenant.artifactId]: snapshot.artifact.currentRevision },
          expectedSourceRevisions: {},
          commands: [{
            commandId: randomUUID(),
            artifactId: manualTenant.artifactId,
            baseRevision: snapshot.artifact.currentRevision,
            kind: 'document',
            expectedSourceRevisions: {},
            reason: 'Manual network edit while background work is saturated',
            operations: [{
              targetId: 'p1',
              op: 'set',
              beforeHash: target.hash,
              value: { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Manual network work remains available.' }] },
            }],
          }],
        },
      }, { 'idempotency-key': groupId });
      const editDurationMs = performance.now() - editStarted;
      expect(editedResponse.status).toBe(200);
      expect(CommandReceiptSchema.parse(await editedResponse.json()).committedRevisionVector[manualTenant.artifactId]).toBe(1);
      expect(editDurationMs).toBeLessThan(1_000);
      console.info('LOAD_NETWORK_METRICS', JSON.stringify({
        active: 8,
        queued: 22,
        runsPerWorkspace: 6,
        readP95Ms: Math.round(networkP95 * 100) / 100,
        maxResponseBytes: Math.max(...measurements.map((measurement) => measurement.bytes)),
        editAckMs: Math.round(editDurationMs * 100) / 100,
      }));
    } finally {
      for (const run of runs) {
        const principal = { kind: 'session' as const, userId: run.owner.viewer.user.id, sessionId: run.owner.viewer.session.id };
        const current = await service.read(principal, run.id).catch(() => null);
        if (current && ['queued', 'running', 'waiting_input', 'review_ready'].includes(current.state)) {
          await service.cancel(principal, run.id, { expectedEpoch: current.epoch }, randomUUID()).catch(() => undefined);
        }
      }
    }
  }, 240_000);
});
