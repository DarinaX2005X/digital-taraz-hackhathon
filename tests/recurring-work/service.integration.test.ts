import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';
import { createRecurringWorkService } from '../../src/features/recurring-work/server/rules';
import type { RecurringRunBridge } from '../../src/features/recurring-work/server/runtime-bridge';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

const definition = (maximum = 2) => ({
  goal: 'Prepare the next saved version for review', sourceSelectors: [], contextRefs: [], capability: { id: 'business.goal', version: 1 }, procedureVersion: 1,
  trigger: { kind: 'manual' as const }, timezone: 'UTC', outputPolicy: { mode: 'new-branch' as const, baseArtifact: null, reviewRequired: true as const, externalEffects: 'forbidden' as const },
  budget: { maximumUsd: '0.25', maxOccurrencesPerDay: maximum },
});

describe('recurring work service in PostgreSQL', () => {
  it('rejects oversized new budgets and pauses a legacy oversized rule before runtime dispatch', async () => {
    const fixture = await artifactFixture(pool), authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const bridge: RecurringRunBridge = { start: vi.fn(), cancel: vi.fn() };
    const service = createRecurringWorkService(pool, bridge);
    const invalidDefinitions = ['0', '0.500000000001'].map((maximumUsd) => ({ ...definition(), budget: { ...definition().budget, maximumUsd } }));
    for (const invalid of invalidDefinitions) {
      await expect(service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: authzVersion, title: 'Invalid new rule', state: 'enabled', definition: invalid, reason: 'Must be rejected' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }

    const boundaryDefinition = { ...definition(), budget: { ...definition().budget, maximumUsd: '0.50' } };
    const created = await service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: authzVersion, title: 'Legacy rule', state: 'enabled', definition: boundaryDefinition, reason: 'Valid before legacy fixture' });
    expect(created.version.definition.budget.maximumUsd).toBe('0.50');
    for (const invalid of invalidDefinitions) {
      await expect(service.update(fixture.owner, randomUUID(), created.rule.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, expectedVersion: 1, title: 'Legacy rule', definition: invalid, reason: 'Must be rejected' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    for (const maximumUsd of ['0', '0.500000000001']) {
      await pool.query(`UPDATE work_rule_versions SET definition=jsonb_set(definition,'{budget,maximumUsd}',to_jsonb($3::text)) WHERE workspace_id=$1 AND rule_id=$2 AND version=1`, [fixture.workspaceId, created.rule.id, maximumUsd]);
      const occurrenceId = randomUUID();
      expect(await service.start(fixture.owner, { ruleId: created.rule.id, ruleVersion: 1, occurrenceId, trigger: { kind: 'manual', at: new Date().toISOString(), sourceRefs: [] } })).toMatchObject({ occurrenceId, runId: null, state: 'paused', reasonCode: 'run_budget' });
    }
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('versions rules, starts each occurrence once, and pauses honestly without a runtime bridge', async () => {
    const fixture = await artifactFixture(pool), service = createRecurringWorkService(pool), authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const created = await service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: authzVersion, title: 'Weekly review', state: 'paused', definition: definition(), reason: 'Initial workflow' });
    const updated = await service.update(fixture.owner, randomUUID(), created.rule.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, expectedVersion: 1, title: 'Weekly review', definition: definition(), reason: 'Clarify goal' });
    expect(updated.version.version).toBe(2);
    expect((await service.read(fixture.owner, fixture.workspaceId, created.rule.id, 1)).version.reason).toBe('Initial workflow');
    await service.setState(fixture.owner, randomUUID(), created.rule.id, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, expectedVersion: 2, state: 'enabled' });
    const occurrenceId = randomUUID(), start = { ruleId: created.rule.id, ruleVersion: 2, occurrenceId, trigger: { kind: 'manual' as const, at: new Date().toISOString(), sourceRefs: [] } };
    const first = await service.start(fixture.owner, start);
    expect(first).toMatchObject({ occurrenceId, state: 'paused', reused: false, reasonCode: 'runtime_bridge_unavailable' });
    expect(await service.start(fixture.owner, start)).toMatchObject({ occurrenceId, state: 'paused', reused: true, reasonCode: 'runtime_bridge_unavailable' });
    expect((await service.occurrences(fixture.owner, { workspaceId: fixture.workspaceId, ruleId: created.rule.id, limit: 20 })).occurrences.filter((item) => item.id === occurrenceId)).toHaveLength(1);
  });

  it('tracks the canonical run state and only restarts terminal occurrences that can be retried', async () => {
    const fixture = await artifactFixture(pool), authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const runId = randomUUID(), restartedRunId = randomUUID();
    const runIds = [runId, restartedRunId];
    const bridge: RecurringRunBridge = {
      start: async (request) => {
        expect(request.operationId).toBe(request.occurrence.id);
        expect(request.definition.goal).toBe('Prepare the next saved version for review');
        return { runId: runIds.shift()!, state: 'queued' };
      },
      cancel: vi.fn(async () => undefined),
    };
    const start = vi.spyOn(bridge, 'start');
    const service = createRecurringWorkService(pool, bridge);
    const created = await service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: authzVersion, title: 'Canonical run', state: 'enabled', definition: definition(), reason: 'Bridge contract' });
    for (const id of [runId, restartedRunId]) {
      const requestHash = randomUUID().replaceAll('-', '').repeat(2);
      await pool.query(`INSERT INTO agent_runs(id,workspace_id,project_id,created_by,authz_version,capability_id,capability_version,required_scope,confidential,goal,locale,input_refs,request_key_hash,input_hash)
        VALUES($1,$2,$3,$4,$5,'business.goal',1,'edit',false,'Recurring bridge run','en','[]',$6,$6)`, [id, fixture.workspaceId, fixture.projectId, fixture.owner.userId, authzVersion, requestHash]);
    }
    const occurrenceId = randomUUID(), input = { ruleId: created.rule.id, ruleVersion: 1, occurrenceId, trigger: { kind: 'manual' as const, at: new Date().toISOString(), sourceRefs: [] } };
    const transitionRun = async (id: string, state: 'running' | 'waiting_input' | 'review_ready' | 'completed' | 'failed', failureCode: string | null = null) => {
      await pool.query(`UPDATE agent_runs SET state=$2,failure_code=$3,
        finished_at=CASE WHEN $2 IN ('completed','failed') THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`, [id, state, failureCode]);
    };
    const occurrence = () => service.occurrenceSnapshot(fixture.owner, fixture.workspaceId, occurrenceId);

    expect(await service.start(fixture.owner, input)).toMatchObject({ occurrenceId, runId, state: 'queued', reused: false });
    expect(await service.start(fixture.owner, input)).toMatchObject({ occurrenceId, runId, state: 'queued', reused: true });
    expect(start).toHaveBeenCalledOnce();
    await transitionRun(runId, 'running');
    expect(await occurrence()).toMatchObject({ state: 'running', reasonCode: null, completedAt: null });
    await transitionRun(runId, 'waiting_input', 'run_deadline');
    expect(await occurrence()).toMatchObject({ state: 'waiting_input', reasonCode: 'run_deadline', completedAt: null });
    await transitionRun(runId, 'review_ready');
    expect(await occurrence()).toMatchObject({ state: 'review_ready', reasonCode: null, completedAt: null });
    await transitionRun(runId, 'failed', 'unavailable');
    expect(await occurrence()).toMatchObject({ state: 'failed', reasonCode: 'unavailable', completedAt: expect.any(String) });

    expect(await service.cancel(fixture.owner, randomUUID(), occurrenceId, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion })).toMatchObject({ state: 'failed', reasonCode: 'unavailable' });
    expect(bridge.cancel).not.toHaveBeenCalled();
    const restarted = await service.restart(fixture.owner, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, occurrenceId });
    expect(restarted).toMatchObject({ runId: restartedRunId, state: 'queued' });
    const restartedOccurrence = (await service.occurrences(fixture.owner, { workspaceId: fixture.workspaceId, ruleId: created.rule.id, limit: 20 })).occurrences.find((item) => item.restartedFrom === occurrenceId);
    expect(restartedOccurrence).toMatchObject({ runId: restartedRunId, state: 'queued', restartedFrom: occurrenceId });
    expect(start).toHaveBeenCalledTimes(2);

    await transitionRun(restartedRunId, 'completed');
    expect(await service.occurrenceSnapshot(fixture.owner, fixture.workspaceId, restartedOccurrence!.id)).toMatchObject({ state: 'completed', reasonCode: null, completedAt: expect.any(String) });
    await expect(service.restart(fixture.owner, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, occurrenceId: restartedOccurrence!.id })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('enforces the daily limit and can cancel and restart paused occurrences', async () => {
    const fixture = await artifactFixture(pool), service = createRecurringWorkService(pool), authzVersion = await currentArtifactAuthz(pool, fixture.workspaceId);
    const created = await service.create(fixture.owner, randomUUID(), { workspaceId: fixture.workspaceId, projectId: fixture.projectId, expectedAuthzVersion: authzVersion, title: 'Bounded review', state: 'enabled', definition: definition(1), reason: 'Bounded automation' });
    const trigger = () => ({ kind: 'manual' as const, at: new Date().toISOString(), sourceRefs: [] });
    const firstId = randomUUID();
    await service.start(fixture.owner, { ruleId: created.rule.id, ruleVersion: 1, occurrenceId: firstId, trigger: trigger() });
    const limited = await service.start(fixture.owner, { ruleId: created.rule.id, ruleVersion: 1, occurrenceId: randomUUID(), trigger: trigger() });
    expect(limited).toMatchObject({ state: 'paused', reasonCode: 'daily_limit' });
    const cancelled = await service.cancel(fixture.owner, randomUUID(), firstId, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion });
    expect(cancelled).toMatchObject({ state: 'cancelled', reasonCode: 'cancelled_by_user' });
    const restarted = await service.restart(fixture.owner, { workspaceId: fixture.workspaceId, expectedAuthzVersion: authzVersion, occurrenceId: firstId });
    expect(restarted).toMatchObject({ state: 'paused', reasonCode: 'daily_limit' });
  });
});
