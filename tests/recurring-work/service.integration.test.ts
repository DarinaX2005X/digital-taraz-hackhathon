import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';
import { createRecurringWorkService } from '../../src/features/recurring-work/server/rules';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });

const definition = (maximum = 2) => ({
  goal: 'Prepare the next saved version for review', sourceSelectors: [], contextRefs: [], capability: { id: 'business.goal', version: 1 }, procedureVersion: 1,
  trigger: { kind: 'manual' as const }, timezone: 'UTC', outputPolicy: { mode: 'new-branch' as const, baseArtifact: null, reviewRequired: true as const, externalEffects: 'forbidden' as const },
  budget: { maximumUsd: '0.25', maxOccurrencesPerDay: maximum },
});

describe('recurring work service in PostgreSQL', () => {
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
