import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandGroupInput } from '@/contracts/commands';
import { createCommandGrouping, type CommandGroupDraft } from '@/features/artifacts/client/grouping';
import { createArtifactService } from '@/features/artifacts/server/service';
import { createOperationsService, loadPlanCapacityContextInTransaction, resolveExportResourcesInTransaction } from '@/features/operations/server/service';
import { createOperationsHandlers } from '@/features/operations/server/handlers';
import { operationsBusinessTools } from '@/features/operations/server/ai-business-tool';
import { businessContext, initialBusinessContext } from '@/features/agent-tools/server/context';
import { identityTransaction, withWorkspaceAccess } from '@/features/identity/server/access';
import { entryLockCommand, planCommand } from '@/features/operations/domain/commands';
import { assessPlanCapacity } from '@/features/operations/domain/capacity';
import { updateEntry, type OperationalPlanContent } from '@/features/operations/domain/model';
import { operationsExportAdapter } from '@/features/operations/server/exports';
import { parsePlanCalendar } from '@/features/operations/icalendar';
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
    const origin = 'http://127.0.0.1:59676', handler = createOperationsHandlers({ pool, origin, getActor: async () => ({ user: { id: f.owner.userId, name: 'Synthetic owner', email: 'owner@example.test', locale: 'en' }, session: { id: f.owner.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } }) });
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
    const locked = await entryLockCommand(undone, 'task_a', true, 'Keep the approved task fixed while planning');
    await reopenedService.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: undone.viewer.authzVersion, group: commandGroup(locked) });
    expect((await reopenedService.read(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id })).locks?.task_a).toMatchObject({ reason: 'Keep the approved task fixed while planning', actorId: f.owner.userId });
  });

  it('builds a read-only plan candidate from exact saved resource revisions through the HTTP boundary', async () => {
    const f = await artifactFixture(pool), service = createOperationsService(pool), authz = await currentArtifactAuthz(pool, f.workspaceId);
    const created = await service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, expectedAuthzVersion: authz, displayName: 'Planning specialist', kind: 'person', timezone: 'Asia/Qyzylorda', accessClass: 'internal' });
    const available = await service.createAvailability(f.owner, randomUUID(), created.resource.id, {
      workspaceId: f.workspaceId, expectedAuthzVersion: authz, expectedResourceRevision: created.resource.revision, timezone: 'Asia/Qyzylorda', effectiveFrom: '2026-01-01', effectiveTo: null,
      weekdays: [{ weekday: 1, intervals: [{ startMinute: 540, endMinute: 1020 }] }], exceptions: [], sourceRefs: [], verifiedAt: '2026-01-01T00:00:00.000Z',
    });
    const request = {
      workspaceId: f.workspaceId,
      expectedAuthzVersion: authz,
      input: {
        plan: { kind: 'plan' as const, schemaVersion: 1 as const, timezone: 'Asia/Qyzylorda', entries: [{ id: 'prepare', title: 'Prepare order', status: 'todo' as const, durationMinutes: 60, effort: { decimal: '1', unit: 'person-hours' }, resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: [], checklist: [] }] },
        resourceRefs: [{ id: available.resource.id, revision: available.resource.revision, availabilityVersionId: available.version.id }],
        window: { start: '2026-01-05T00:00:00.000Z', end: '2026-01-06T00:00:00.000Z' },
        lockedEntryIds: [], materialConstraints: [], objective: 'earliest-finish' as const,
      },
    };
    const direct = await service.propose(f.owner, request);
    expect(direct).toMatchObject({ status: 'feasible', changedEntryIds: ['prepare'], candidate: { entries: [{ startAt: '2026-01-05T04:00:00.000Z', resourceIds: [created.resource.id] }] } });
    const origin = 'http://127.0.0.1:59676';
    const handler = createOperationsHandlers({ pool, origin, getActor: async () => ({ user: { id: f.owner.userId, name: 'Synthetic owner', email: 'owner@example.test', locale: 'en' }, session: { id: f.owner.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } }) });
    const response = await handler(new Request(`${origin}/api/operations/plan-proposals`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Tirlik-User-Id': f.owner.userId }, body: JSON.stringify(request) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'feasible', checkReceipt: { algorithmVersion: 'k2-interval-search-v1', inputRevisionVector: { [created.resource.id]: available.resource.revision, [available.version.id]: available.version.revision } } });

    const artifact = await f.create(request.input.plan, 'Checked delivery plan'), base = await f.read(artifact.artifact.id);
    const applyDraft = await planCommand(base, direct.candidate, 'Apply checked schedule');
    expect(applyDraft).not.toBeNull();
    await f.service.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: base.viewer.authzVersion, group: commandGroup(applyDraft!) });
    const reopened = await f.read(artifact.artifact.id);
    expect(reopened.content).toEqual(direct.candidate);
    expect(reopened.content.kind === 'plan' && reopened.content.entries[0]?.assignments?.[0]).toEqual({
      resourceId: created.resource.id,
      resourceRevision: available.resource.revision,
      availabilityVersionId: available.version.id,
      effort: { decimal: '1', unit: 'person-hours' },
    });

    const archived = await service.update(f.owner, randomUUID(), created.resource.id, { workspaceId: f.workspaceId, expectedAuthzVersion: authz, expectedRevision: available.resource.revision, status: 'archived' });
    expect(archived.resource.revision).toBe(available.resource.revision + 1);
    const afterArchive = await f.read(artifact.artifact.id);
    expect(afterArchive.content).toEqual(direct.candidate);
    const current = await withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, scope: 'read' }, async (tx, access) => ({
      capacity: await loadPlanCapacityContextInTransaction(tx, access, direct.candidate),
      fixedExport: await resolveExportResourcesInTransaction(tx, access, direct.candidate),
    }));
    expect(current.fixedExport.resources[0]).toMatchObject({ resourceId: created.resource.id, resourceRevision: available.resource.revision, displayName: 'Planning specialist', availability: { id: available.version.id } });
    expect(assessPlanCapacity({ plan: direct.candidate, ...current.capacity })).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'conflict', affectedEntryIds: ['prepare'], reasons: expect.arrayContaining(['resource-archived']) })]));

    const exportInput = {
      content: reopened.content, artifactId: reopened.artifact.id, title: 'Checked delivery plan', locale: 'en' as const,
      options: { layout: { pageSize: 'A4' as const, orientation: 'portrait' as const, marginMm: 20, pageNumbers: true }, scale: 1, transparent: false, replaceUnsupportedFonts: false, fontAssets: {} },
      privateFieldsPolicy: 'exclude-internal' as const, historicalDraft: false, revision: reopened.artifact.currentRevision,
      createdAt: '2026-01-05T00:00:00.000Z', assets: { image: async () => { throw new Error('UNEXPECTED_IMAGE'); } }, planResources: current.fixedExport,
    };
    const calendarFile = await operationsExportAdapter.render({ ...exportInput, format: 'ics' });
    const calendarText = new TextDecoder().decode(calendarFile.bytes);
    expect(calendarText).toContain(`X-TIRLIK-REVISION:${reopened.artifact.currentRevision}`);
    expect(parsePlanCalendar(calendarFile.bytes, direct.candidate.timezone)[0]).toMatchObject({ startAt: direct.candidate.entries[0]!.startAt, endAt: direct.candidate.entries[0]!.endAt });

    const pdfFile = await operationsExportAdapter.render({ ...exportInput, format: 'pdf' });
    const loading = getDocument({ data: new Uint8Array(pdfFile.bytes), useSystemFonts: false, disableFontFace: true });
    try {
      const pdf = await loading.promise, text = await (await pdf.getPage(1)).getTextContent();
      const rendered = text.items.map((item) => 'str' in item ? item.str : '').join(' ');
      expect(rendered).toContain(`Revision: ${reopened.artifact.currentRevision}`);
      expect(rendered).toContain('Prepare order');
      expect(rendered).toContain('Planning specialist');
    } finally { await loading.destroy(); }
  });

  it('rejects candidate writes and proposal HTTP requests after access is revoked without changing the plan', async () => {
    const f = await artifactFixture(pool), initial: OperationalPlanContent = { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{ id: 'task_a', title: 'Approved work', status: 'todo', startDate: '2026-02-02', endDate: '2026-02-02', durationMinutes: 60, resourceIds: [], availabilityVersionIds: [], assignments: [], dependencies: [], checklist: [] }] };
    const created = await f.create(initial, 'Permission-safe plan');
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: await currentArtifactAuthz(pool, f.workspaceId) });
    const memberSnapshot = await f.read(created.artifact.id, f.member);
    expect(memberSnapshot.permissions.edit).toBe(true);
    const desired = updateEntry(initial, 'task_a', { title: 'Revoked overwrite' }), draft = await planCommand(memberSnapshot, desired, 'Apply checked schedule');
    expect(draft).not.toBeNull();
    await pool.query("UPDATE identity_memberships SET state='revoked',revoked_at=now() WHERE workspace_id=$1 AND user_id=$2", [f.workspaceId, f.member.userId]);
    await pool.query('UPDATE identity_workspaces SET authz_version=authz_version+1 WHERE id=$1', [f.workspaceId]);

    await expect(f.service.apply(f.member, { workspaceId: f.workspaceId, expectedAuthzVersion: memberSnapshot.viewer.authzVersion, group: commandGroup(draft!) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const origin = 'http://127.0.0.1:59676';
    const handler = createOperationsHandlers({ pool, origin, getActor: async () => ({ user: { id: f.member.userId, name: 'Revoked member', email: 'revoked@example.test', locale: 'en' }, session: { id: f.member.sessionId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } }) });
    const proposalRequest = { workspaceId: f.workspaceId, expectedAuthzVersion: memberSnapshot.viewer.authzVersion, input: { plan: initial, resourceRefs: [], window: { start: '2026-02-02T00:00:00.000Z', end: '2026-02-03T00:00:00.000Z' }, lockedEntryIds: [], materialConstraints: [], objective: 'earliest-finish' as const } };
    const response = await handler(new Request(`${origin}/api/operations/plan-proposals`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Tirlik-User-Id': f.member.userId }, body: JSON.stringify(proposalRequest) }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.read(created.artifact.id)).content).toEqual(initial);
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
