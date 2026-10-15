import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandGroupInput } from '@/contracts/commands';
import { createCommandGrouping, type CommandGroupDraft } from '@/features/artifacts/client/grouping';
import { createArtifactService } from '@/features/artifacts/server/service';
import { createOperationsService } from '@/features/operations/server/service';
import { createOperationsHandlers } from '@/features/operations/server/handlers';
import { operationsBusinessTools } from '@/features/operations/server/ai-business-tool';
import { businessContext, initialBusinessContext } from '@/features/agent-tools/server/context';
import { identityTransaction } from '@/features/identity/server/access';
import { planCommand } from '@/features/operations/domain/commands';
import { updateEntry, type OperationalPlanContent } from '@/features/operations/domain/model';
import { artifactFixture, artifactTestPool, currentArtifactAuthz } from '../artifacts/server/test-fixture';

let pool: Pool;
beforeAll(async () => {
  pool = artifactTestPool();
  const present = (await pool.query<{ name: string | null }>("SELECT to_regclass('work_resources')::text AS name")).rows[0]?.name;
  if (!present) await pool.query(await readFile(new URL('../../migrations/0017_operations.sql', import.meta.url), 'utf8'));
});
afterAll(async () => { await pool?.end(); });

describe('operations persistence and canonical plan history', () => {
  it('stores an employee without an account, immutable availability, and rejects stale/closed access', async () => {
    const f = await artifactFixture(pool), service = createOperationsService(pool);
    const authz = await currentArtifactAuthz(pool, f.workspaceId);
    const created = await service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: authz, displayName: 'Aruzhan', kind: 'person', timezone: 'Asia/Qyzylorda', accessClass: 'internal' });
    expect(created.resource.membershipId).toBeNull();
    expect((await service.read(f.member, f.workspaceId, created.resource.id)).resource.displayName).toBe('Aruzhan');
    const origin = 'http://127.0.0.1:59676', handler = createOperationsHandlers({ pool, origin, getActor: async () => ({ user: { id: f.owner.userId, name: 'Synthetic owner', email: 'owner@example.test', emailVerified: true, locale: 'en' }, session: { id: f.owner.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } }) });
    const response = await handler(new Request(`${origin}/api/operations/resources/${created.resource.id}?workspaceId=${f.workspaceId}`, { headers: { 'X-Tirlik-User-Id': f.owner.userId } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: { id: created.resource.id, membershipId: null, displayName: 'Aruzhan' } });
    const availability = await service.createAvailability(f.owner, randomUUID(), created.resource.id, {
      workspaceId: f.workspaceId, expectedAuthzVersion: authz, expectedResourceRevision: 1, timezone: 'Asia/Qyzylorda', effectiveFrom: '2026-01-01', effectiveTo: null,
      weekdays: [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }], exceptions: [{ date: '2026-01-12', intervals: [], label: 'Unavailable' }], sourceRefs: [], verifiedAt: '2026-01-01T00:00:00.000Z', note: 'Entered by the owner',
    });
    expect(availability.version).toMatchObject({ revision: 1, exceptions: [{ date: '2026-01-12', intervals: [], label: 'Unavailable' }] });
    expect((await service.availabilityHistory(f.owner, f.workspaceId, created.resource.id)).versions).toHaveLength(1);
    await expect(service.update(f.owner, randomUUID(), created.resource.id, { workspaceId: f.workspaceId, expectedAuthzVersion: authz, expectedRevision: 1, displayName: 'Stale name' })).rejects.toMatchObject({ code: 'CONFLICT' });

    const confidential = await service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: authz, displayName: 'Restricted specialist', kind: 'person', timezone: 'Asia/Qyzylorda', accessClass: 'confidential' });
    await expect(service.read(f.member, f.workspaceId, confidential.resource.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('saves, reopens, rejects a stale edit, and undoes one plan command group', async () => {
    const f = await artifactFixture(pool), initial: OperationalPlanContent = { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{ id: 'task_a', title: 'Prepare', description: 'Initial', status: 'todo', startDate: '2026-02-02', endDate: '2026-02-02', durationMinutes: 60, resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: [], checklist: [] }] };
    const created = await f.create(initial, 'Operational plan'), snapshot = await f.read(created.artifact.id);
    const desired = updateEntry(initial, 'task_a', { title: 'Prepare materials', status: 'in-progress', description: 'Checked direct edit' });
    const draft = await planCommand(snapshot, desired, 'Edit work plan');
    expect(draft).not.toBeNull();
    const group = commandGroup(draft!);
    const request = { workspaceId: f.workspaceId, expectedAuthzVersion: snapshot.viewer.authzVersion, group };
    const applied = await f.service.apply(f.owner, request);
    expect(applied.committedRevisionVector[created.artifact.id]).toBe(1);

    const reopenedService = createArtifactService(pool), reopened = await reopenedService.read(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id });
    expect(reopened.content.kind === 'plan' && reopened.content.entries[0]).toMatchObject({ title: 'Prepare materials', status: 'in-progress', description: 'Checked direct edit' });
    const staleDesired = updateEntry(initial, 'task_a', { title: 'Stale overwrite' }), staleDraft = await planCommand(snapshot, staleDesired, 'Stale edit');
    await expect(reopenedService.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: reopened.viewer.authzVersion, group: commandGroup(staleDraft!) })).rejects.toMatchObject({ code: 'CONFLICT' });

    await reopenedService.undo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: reopened.viewer.authzVersion, commandGroupId: randomUUID(), targetCommandGroupId: group.commandGroupId, expectedArtifactRevisions: { [created.artifact.id]: 1 }, expectedSourceRevisions: {} });
    const undone = await reopenedService.read(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id });
    expect(undone.content.kind === 'plan' && undone.content.entries[0]).toMatchObject({ title: 'Prepare', status: 'todo', description: 'Initial' });
  });

  it('returns a business-assistant decision DTO from saved resource availability without a provider call', async () => {
    const f = await artifactFixture(pool), service = createOperationsService(pool), authzVersion = await currentArtifactAuthz(pool, f.workspaceId);
    const resource = await service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: authzVersion, displayName: 'Aruzhan', kind: 'person', timezone: 'Asia/Qyzylorda', accessClass: 'internal' });
    const availability = await service.createAvailability(f.owner, randomUUID(), resource.resource.id, { workspaceId: f.workspaceId, expectedAuthzVersion: authzVersion, expectedResourceRevision: resource.resource.revision, timezone: 'Asia/Qyzylorda', effectiveFrom: '2026-01-01', effectiveTo: null, weekdays: [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }], exceptions: [], sourceRefs: [], verifiedAt: '2026-01-01T00:00:00.000Z' });
    const state = initialBusinessContext({ workspaceId: f.workspaceId, projectId: f.projectId, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Can we deliver on 5 January 2026?', locale: 'en', inputRefs: [] });
    const tool = operationsBusinessTools({ context: businessContext, saveArtifact: async () => { throw new Error('NOT_USED'); }, readArtifact: async () => { throw new Error('NOT_USED'); } } as never).find((item) => item.name === 'assess_delivery_date')!;
    const runId = randomUUID(), stepId = randomUUID();
    const context = { fence: { runId, stepId, epoch: 0, leaseOwner: randomUUID() }, workspaceId: f.workspaceId, projectId: f.projectId, userId: f.owner.userId, authzVersion, context: state, signal: new AbortController().signal, checkpoint: async () => { throw new Error('NOT_USED'); } } as never;
    const assessmentInput = {
      assessmentId: 'capacity_check', optionId: 'deliver_standard', requestedDate: '2026-01-05', requestedDateEvidence: { origin: 'goal', sourceId: null, artifactId: null, fragmentId: null, raw: '5 January 2026' },
      openingDate: '2026-01-05', openingDateEvidence: { origin: 'goal', sourceId: null, artifactId: null, fragmentId: null, raw: '5 January 2026' }, availabilitySourceIds: [], planArtifact: null,
      planDraft: { timezone: 'Asia/Qyzylorda', tasks: [{ id: 'prepare', title: 'Prepare order', durationMinutes: 60, effortMinutes: 60, resourceIds: [resource.resource.id], dependencies: [], sourceRefs: [], startDate: null, endDate: null, startAt: '2026-01-05T04:00:00.000Z', endAt: '2026-01-05T05:00:00.000Z' }] },
    };
    const outcome = await identityTransaction(pool, (tx) => tool.effect(tx, assessmentInput, context, state, undefined));
    expect(outcome.output).toMatchObject({ assessmentId: 'capacity_check', optionId: 'deliver_standard', verdict: 'can-meet-with-conditions', reasons: [], planDraft: { content: { kind: 'plan' } } });
    expect((outcome.output as { capacity: { evidence: unknown }[] }).capacity[0]?.evidence).toEqual({ origin: 'manual', resourceId: resource.resource.id, availabilityVersionId: availability.version.id, verifiedAt: '2026-01-01T00:00:00.000Z', sourceRefs: [] });
    expect((outcome.context as typeof state).operations).toHaveLength(1);
    const invented = initialBusinessContext({ workspaceId: f.workspaceId, projectId: f.projectId, capabilityId: 'business.goal', capabilityVersion: 1, goal: 'Can we deliver this order?', locale: 'en', inputRefs: [] });
    const inventedContext = { fence: { runId, stepId, epoch: 0, leaseOwner: randomUUID() }, workspaceId: f.workspaceId, projectId: f.projectId, userId: f.owner.userId, authzVersion, context: invented, signal: new AbortController().signal, checkpoint: async () => { throw new Error('NOT_USED'); } } as never;
    await expect(identityTransaction(pool, (tx) => tool.effect(tx, assessmentInput, inventedContext, invented, undefined))).rejects.toMatchObject({ failure: 'invalid_result' });
  });
});

function commandGroup(draft: CommandGroupDraft) {
  let group: CommandGroupInput | undefined;
  const grouping = createCommandGrouping({ createId: randomUUID, onReady(value) { group = value; } });
  grouping.stage(draft, 'format'); grouping.dispose();
  if (!group) throw new Error('COMMAND_GROUP_MISSING');
  return group;
}
