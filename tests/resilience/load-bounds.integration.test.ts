import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createArtifactTargetResolver } from '../../src/features/artifacts/domain/targets';
import { createArtifactService } from '../../src/features/artifacts/server/service';
import { scopesForRole } from '../../src/features/identity/domain/policy';
import type { IdentityActor } from '../../src/features/identity/server/handlers';
import { createProjectCore } from '../../src/features/workspace/server/project-core';
import { createRunHandlers } from '../../src/features/runs/server/handlers';
import { createRunRegistry } from '../../src/features/runs/server/registry';
import { createRunService } from '../../src/features/runs/server/service';
import { testDocument } from '../artifacts/server/test-fixture';
import { isolatedRunPool, syntheticWorkspace } from '../runs/database';

let pool: Pool;

interface LoadTenant {
  actors: IdentityActor[];
  principal: { kind: 'session'; userId: string; sessionId: string };
  workspaceId: string;
}

beforeAll(() => { pool = isolatedRunPool(); });
afterAll(async () => { await pool?.end(); });

function registry() {
  return createRunRegistry([{
    id: 'load.synthetic',
    version: 1,
    publicStart: true,
    policy: { scope: 'edit', confidential: false },
    initialize: () => ({
      context: { load: true },
      steps: [{ tool: 'load.hold', version: 1, action: 'process', input: {} }],
    }),
  }], [{
    name: 'load.hold',
    version: 1,
    purpose: 'Stay claimed while queue and manual-work bounds are verified.',
    input: z.strictObject({}),
    output: z.strictObject({ held: z.literal(true) }),
    policy: { scope: 'edit', confidential: false },
    costClass: 'local',
    deadlineMs: 30_000,
    idempotency: 'receipt',
    execute: async (_transaction, _input, _prepared, context) => ({
      output: { held: true },
      context: context.context,
      state: 'completed',
    }),
  }]);
}

describe('bounded multi-tenant load', () => {
  it('keeps fair queue limits, bounded HTTP reads, and manual editing available under saturation', async () => {
    const service = createRunService(pool, registry());
    const tenants: LoadTenant[] = [];
    const runs: { id: string; tenant: LoadTenant }[] = [];

    for (let index = 0; index < 5; index++) {
      const transaction = await pool.connect();
      try {
        await transaction.query('BEGIN');
        const scope = await syntheticWorkspace(transaction);
        const actors: IdentityActor[] = [{
          user: { id: scope.userId, name: `Load owner ${index + 1}`, email: `${scope.userId}@example.test`, locale: 'en' },
          session: { id: scope.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) },
        }];
        for (let member = 0; member < 3; member++) {
          const userId = randomUUID(), sessionId = randomUUID();
          await transaction.query('INSERT INTO identity_users(id,name,email,email_verified) VALUES($1,$2,$3,false)', [userId, `Load reader ${index + 1}.${member + 1}`, `${userId}@example.test`]);
          await transaction.query('INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,$4,$5)', [randomUUID(), scope.workspaceId, userId, 'editor', scopesForRole('editor')]);
          await transaction.query("INSERT INTO identity_sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [sessionId, userId, randomUUID()]);
          actors.push({
            user: { id: userId, name: `Load reader ${index + 1}.${member + 1}`, email: `${userId}@example.test`, locale: 'en' },
            session: { id: sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) },
          });
        }
        await transaction.query('COMMIT');
        const tenant = {
          workspaceId: scope.workspaceId,
          principal: { kind: 'session' as const, userId: scope.userId, sessionId: scope.sessionId },
          actors,
        };
        tenants.push(tenant);
      } catch (error) {
        await transaction.query('ROLLBACK');
        throw error;
      } finally {
        transaction.release();
      }
    }

    try {
      for (const tenant of tenants) {
        for (let index = 0; index < 6; index++) {
          const run = await service.create(tenant.principal, {
            workspaceId: tenant.workspaceId,
            projectId: null,
            capabilityId: 'load.synthetic',
            capabilityVersion: 1,
            goal: `Bounded queue item ${index + 1}`,
            locale: 'en',
            inputRefs: [],
          }, randomUUID());
          runs.push({ id: run.id, tenant });
        }
      }
      expect(runs).toHaveLength(30);

      const claims = await Promise.all(Array.from({ length: 20 }, () => service.claim()));
      expect(claims.filter(Boolean)).toHaveLength(8);
      const queue = await pool.query<{ workspace_id: string; state: 'queued' | 'running'; count: number }>(
        "SELECT workspace_id,state,count(*)::int AS count FROM agent_runs WHERE state IN ('queued','running') GROUP BY workspace_id,state",
      );
      expect(queue.rows.filter((row) => row.state === 'running').reduce((sum, row) => sum + row.count, 0)).toBe(8);
      expect(queue.rows.filter((row) => row.state === 'queued').reduce((sum, row) => sum + row.count, 0)).toBe(22);
      const activeByWorkspace = new Map(queue.rows.filter((row) => row.state === 'running').map((row) => [row.workspace_id, row.count]));
      expect(activeByWorkspace.size).toBe(5);
      expect([...activeByWorkspace.values()].every((count) => count <= 2)).toBe(true);

      const concurrentReaders = tenants.flatMap((tenant) => tenant.actors.map((actor) => ({ actor, tenant })));
      expect(concurrentReaders).toHaveLength(20);
      const actors = new Map(concurrentReaders.map(({ actor }) => [actor.user.id, actor]));
      const handler = createRunHandlers({
        pool,
        service,
        registry: registry(),
        origin: 'http://127.0.0.1:3000',
        getActor: async (headers) => actors.get(headers.get('x-tirlik-user-id') ?? '')!,
        wake: async () => undefined,
      });
      const request = (tenant: LoadTenant, actor: IdentityActor) => new Request(
        `http://127.0.0.1:3000/api/runs?workspaceId=${tenant.workspaceId}`,
        { headers: { 'x-tirlik-user-id': actor.user.id } },
      );
      for (const tenant of tenants) expect((await handler(request(tenant, tenant.actors[0]!))).status).toBe(200);

      const reads = await Promise.all(concurrentReaders.map(async ({ tenant, actor }) => {
        const started = performance.now();
        const response = await handler(request(tenant, actor));
        const body = await response.text();
        return { status: response.status, durationMs: performance.now() - started, bytes: Buffer.byteLength(body), body };
      }));
      expect(reads.every((read) => read.status === 200)).toBe(true);
      expect(reads.every((read) => read.bytes < 1_048_576)).toBe(true);
      expect(reads.every((read) => (JSON.parse(read.body) as { runs: unknown[] }).runs.length === 6)).toBe(true);
      const durations = reads.map((read) => read.durationMs).sort((left, right) => left - right);
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
      expect(p95).toBeLessThan(500);

      const editorTenant = tenants[0]!;
      const project = await createProjectCore(pool).create(editorTenant.principal, randomUUID(), {
        workspaceId: editorTenant.workspaceId,
        expectedAuthzVersion: 1,
        title: 'Manual work during queue saturation',
      });
      const artifacts = createArtifactService(pool);
      const created = await artifacts.create(editorTenant.principal, randomUUID(), {
        workspaceId: editorTenant.workspaceId,
        projectId: project.project.id,
        expectedAuthzVersion: 1,
        title: 'Available manual editor',
        content: testDocument(),
      });
      const snapshot = await artifacts.read(editorTenant.principal, { workspaceId: editorTenant.workspaceId, artifactId: created.artifact.id });
      const target = createArtifactTargetResolver(snapshot.content)('p1')!;
      const editStarted = performance.now();
      const receipt = await artifacts.apply(editorTenant.principal, {
        workspaceId: editorTenant.workspaceId,
        expectedAuthzVersion: 1,
        group: {
          commandGroupId: randomUUID(),
          expectedArtifactRevisions: { [created.artifact.id]: 0 },
          expectedSourceRevisions: {},
          commands: [{
            commandId: randomUUID(),
            artifactId: created.artifact.id,
            baseRevision: 0,
            kind: 'document',
            expectedSourceRevisions: {},
            reason: 'Manual correction while background work is queued',
            operations: [{
              targetId: 'p1',
              op: 'set',
              beforeHash: target.hash,
              value: { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Manual work remains available.' }] },
            }],
          }],
        },
      });
      expect(receipt.committedRevisionVector[created.artifact.id]).toBe(1);
      const editDurationMs = performance.now() - editStarted;
      expect(editDurationMs).toBeLessThan(1_000);

      const cancelledClaim = claims.find((claim) => claim !== null)!;
      const cancelledRun = runs.find((run) => run.id === cancelledClaim.runId)!;
      const active = await service.read(cancelledRun.tenant.principal, cancelledRun.id);
      await service.cancel(cancelledRun.tenant.principal, cancelledRun.id, { expectedEpoch: active.epoch }, randomUUID());
      const replacement = await service.claim();
      expect(replacement).not.toBeNull();
      const replenished = await pool.query<{ workspace_id: string; count: number }>(
        "SELECT workspace_id,count(*)::int AS count FROM agent_runs WHERE state='running' GROUP BY workspace_id",
      );
      expect(replenished.rows.reduce((sum, row) => sum + row.count, 0)).toBe(8);
      expect(replenished.rows).toHaveLength(5);
      expect(replenished.rows.every((row) => row.count <= 2)).toBe(true);
      process.stdout.write(`LOAD_BOUNDS_METRICS ${JSON.stringify({
        active: 8,
        queued: 22,
        activePerWorkspace: [...activeByWorkspace.values()].sort((left, right) => left - right),
        readP95Ms: Math.round(p95 * 100) / 100,
        maxResponseBytes: Math.max(...reads.map((read) => read.bytes)),
        editAckMs: Math.round(editDurationMs * 100) / 100,
      })}\n`);
    } finally {
      for (const run of runs) {
        const current = await service.read(run.tenant.principal, run.id).catch(() => null);
        if (current && ['queued', 'running', 'waiting_input', 'review_ready'].includes(current.state)) {
          await service.cancel(run.tenant.principal, run.id, { expectedEpoch: current.epoch }, randomUUID()).catch(() => undefined);
        }
      }
    }
  }, 120_000);
});
