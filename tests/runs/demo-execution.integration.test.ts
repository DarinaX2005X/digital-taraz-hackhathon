import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDemoExecutionScopeService, DemoExecutionError } from '@/features/demo/server/execution-scope';
import { createArtifactTargetResolver } from '@/features/artifacts/domain/targets';
import { businessRegistration } from '@/features/agent-tools/server/business';
import { createRunRegistry } from '@/features/runs/server/registry';
import { createRunService } from '@/features/runs/server/service';

let pool: Pool;
beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (database.hostname !== '127.0.0.1' || database.pathname !== '/tirlik' || process.env.OPENROUTER_API_KEY) throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
  pool = new Pool({ connectionString: database.href });
});
afterAll(async () => pool?.end());

async function destination() {
  const userId = randomUUID(), workspaceId = randomUUID(), sessionId = randomUUID();
  await pool.query('BEGIN');
  try {
    await pool.query('INSERT INTO identity_users(id,name,email,email_verified) VALUES($1,$2,$3,false)', [userId, 'Copy owner', `${userId}@example.test`]);
    await pool.query('INSERT INTO identity_sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval \'1 day\')', [sessionId, userId, randomUUID()]);
    await pool.query('INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,$2,$3)', [workspaceId, 'Destination', userId]);
    await pool.query("INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,'owner',ARRAY['read','edit','approve','export','manage-members','read-confidential'])", [randomUUID(), workspaceId, userId]);
    await pool.query('COMMIT');
  } catch (error) { await pool.query('ROLLBACK'); throw error; }
  return { principal: { kind: 'session' as const, userId, sessionId }, workspaceId };
}

async function planArtifactId(workspaceId: string, projectId: string) {
  const row = (await pool.query<{ id: string }>("SELECT id FROM artifacts WHERE workspace_id=$1 AND project_id=$2 AND kind='plan'", [workspaceId, projectId])).rows[0];
  if (!row) throw new Error('DEMO_PLAN_REQUIRED');
  return row.id;
}

async function rewindPlanToLegacy(scope: { sessionId: string; workspaceId: string; projectId: string }) {
  const artifactId = await planArtifactId(scope.workspaceId, scope.projectId);
  const version = (await pool.query<{ content_id: string; content_hash: string }>('SELECT content_id,content_hash FROM artifact_versions WHERE workspace_id=$1 AND artifact_id=$2 AND revision=0', [scope.workspaceId, artifactId])).rows[0]!;
  const groups = (await pool.query<{ group_id: string }>('DELETE FROM artifact_commands WHERE workspace_id=$1 AND artifact_id=$2 RETURNING group_id', [scope.workspaceId, artifactId])).rows.map((row) => row.group_id);
  if (groups.length) await pool.query('DELETE FROM artifact_command_groups WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [scope.workspaceId, groups]);
  await pool.query('UPDATE artifacts SET current_revision=0,content_id=$3,content_hash=$4 WHERE workspace_id=$1 AND id=$2', [scope.workspaceId, artifactId, version.content_id, version.content_hash]);
  await pool.query('DELETE FROM artifact_versions WHERE workspace_id=$1 AND artifact_id=$2 AND revision>0', [scope.workspaceId, artifactId]);
  const row = (await pool.query<{ input_refs: { kind: string; id: string; revision?: number }[] }>('SELECT input_refs FROM demo_execution_scopes WHERE id=$1', [scope.sessionId])).rows[0]!;
  const inputRefs = row.input_refs.map((ref) => ref.kind === 'artifact' && ref.id === artifactId ? { ...ref, revision: 0 } : ref);
  await pool.query('UPDATE demo_execution_scopes SET input_refs=$2 WHERE id=$1', [scope.sessionId, JSON.stringify(inputRefs)]);
  return artifactId;
}

describe('K5 isolated execution scope', () => {
  it('repairs locks only for the untouched canonical legacy plan and preserves later human choices', async () => {
    const business = businessRegistration(pool), registry = createRunRegistry([business.capability], business.tools), runtime = { service: createRunService(pool, registry) };
    const service = createDemoExecutionScopeService({ pool, secret: 'test-demo-secret-that-is-at-least-thirty-two-bytes', runtime, wake: async () => undefined });

    const legacy = await service.create('en', randomUUID()), legacyPlanId = await rewindPlanToLegacy(legacy.scope);
    const beforeRepair = await service.artifactSnapshot(legacy.scope.sessionId, legacy.capabilityToken, legacyPlanId);
    expect(beforeRepair).toMatchObject({ artifact: { currentRevision: 0 }, locks: {} });
    const repaired = await service.read(legacy.scope.sessionId, legacy.capabilityToken);
    expect(repaired.inputRefs).toContainEqual(expect.objectContaining({ id: legacyPlanId, revision: 1 }));
    expect((await service.artifactSnapshot(legacy.scope.sessionId, legacy.capabilityToken, legacyPlanId)).locks).toEqual(expect.objectContaining({ 'qadam-market': expect.any(Object), 'orda-logistics': expect.any(Object) }));
    await service.read(legacy.scope.sessionId, legacy.capabilityToken);
    expect((await pool.query('SELECT count(*)::int AS count FROM artifact_commands WHERE workspace_id=$1 AND artifact_id=$2', [legacy.scope.workspaceId, legacyPlanId])).rows[0].count).toBe(1);

    const edited = await service.create('en', randomUUID()), editedPlanId = await rewindPlanToLegacy(edited.scope);
    const editedSnapshot = await service.artifactSnapshot(edited.scope.sessionId, edited.capabilityToken, editedPlanId);
    if (editedSnapshot.content.kind !== 'plan') throw new Error('DEMO_PLAN_REQUIRED');
    const entry = editedSnapshot.content.entries.find((item) => item.id === 'sary-arqa-pharmacy')!;
    const target = createArtifactTargetResolver(editedSnapshot.content)('sary-arqa-pharmacy')!;
    await service.applyArtifactCommand(edited.scope.sessionId, edited.capabilityToken, { workspaceId: edited.scope.workspaceId, expectedAuthzVersion: 1, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [editedPlanId]: 0 }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: editedPlanId, baseRevision: 0, kind: 'plan', expectedSourceRevisions: {}, reason: 'Human changed the legacy demo plan', operations: [{ targetId: entry.id, op: 'set', beforeHash: target.hash, value: { ...entry, notes: 'Human plan choice must remain untouched.' } }] }] } });
    await service.read(edited.scope.sessionId, edited.capabilityToken);
    expect((await service.artifactSnapshot(edited.scope.sessionId, edited.capabilityToken, editedPlanId)).locks).toEqual({});

    const unlocked = await service.create('en', randomUUID()), unlockedPlanId = await planArtifactId(unlocked.scope.workspaceId, unlocked.scope.projectId);
    const lockedSnapshot = await service.artifactSnapshot(unlocked.scope.sessionId, unlocked.capabilityToken, unlockedPlanId);
    const lockedTargets = createArtifactTargetResolver(lockedSnapshot.content, lockedSnapshot.artifact.bindings, lockedSnapshot.locks);
    await service.applyArtifactCommand(unlocked.scope.sessionId, unlocked.capabilityToken, { workspaceId: unlocked.scope.workspaceId, expectedAuthzVersion: 1, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [unlockedPlanId]: lockedSnapshot.artifact.currentRevision }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: unlockedPlanId, baseRevision: lockedSnapshot.artifact.currentRevision, kind: 'plan', expectedSourceRevisions: {}, reason: 'Human removed the demo locks', operations: ['qadam-market', 'orda-logistics'].map((targetId) => ({ targetId, op: 'lock' as const, beforeHash: lockedTargets(targetId)!.hash, value: { locked: false } })) }] } });
    await service.read(unlocked.scope.sessionId, unlocked.capabilityToken);
    expect((await service.artifactSnapshot(unlocked.scope.sessionId, unlocked.capabilityToken, unlockedPlanId)).locks).toEqual({});
  });

  it('seeds one capability-bound workspace, runs through the canonical runtime, and copies explicitly once', async () => {
    const business = businessRegistration(pool), registry = createRunRegistry([business.capability], business.tools), runtime = { service: createRunService(pool, registry) };
    let wakes = 0;
    const service = createDemoExecutionScopeService({ pool, secret: 'test-demo-secret-that-is-at-least-thirty-two-bytes', runtime, wake: async () => { wakes++; } });
    const startKey = randomUUID(), created = await service.create('en', startKey);
    expect(created.scope).toMatchObject({ revision: 0, locale: 'en', inputRefs: expect.arrayContaining([expect.objectContaining({ kind: 'artifact', revision: 0 })]), results: [], runIds: [] });
    expect(created.scope.inputRefs).toHaveLength(2);
    expect((await pool.query<{ email_verified: boolean }>('SELECT email_verified FROM identity_users WHERE id=$1', [created.scope.actorId])).rows[0]).toEqual({ email_verified: false });
    const repeated = await service.create('en', startKey);
    expect(repeated).toEqual(created);
    expect((await pool.query('SELECT count(*)::int AS count FROM demo_execution_scopes WHERE id=$1', [created.scope.sessionId])).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM work_resources WHERE workspace_id=$1', [created.scope.workspaceId])).rows[0].count).toBe(2);
    await expect(service.read(created.scope.sessionId, 'a'.repeat(43))).rejects.toEqual(expect.objectContaining<Partial<DemoExecutionError>>({ code: 'DEMO_NOT_FOUND' }));

    const briefRef = created.scope.inputRefs[0]!, brief = await service.artifactSnapshot(created.scope.sessionId, created.capabilityToken, briefRef.id);
    expect(JSON.stringify(brief.content)).toContain('Arman Print'); expect(JSON.stringify(brief.content)).not.toContain('café');
    expect((await service.artifactAccess(created.scope.sessionId, created.capabilityToken, { workspaceId: created.scope.workspaceId, artifactIds: [briefRef.id] })).editableArtifactIds).toEqual([briefRef.id]);
    const target = createArtifactTargetResolver(brief.content)('fact-7')!;
    const commandGroupId = randomUUID();
    const edited = await service.applyArtifactCommand(created.scope.sessionId, created.capabilityToken, { workspaceId: created.scope.workspaceId, expectedAuthzVersion: 1, group: { commandGroupId, expectedArtifactRevisions: { [briefRef.id]: 0 }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: briefRef.id, baseRevision: 0, kind: 'document', expectedSourceRevisions: {}, reason: 'Keep the demo decision in the saved input', operations: [{ targetId: 'fact-7', op: 'set', beforeHash: target.hash, value: { type: 'paragraph', attrs: { id: 'fact-7' }, content: [{ type: 'text', text: 'Prepare only the viable first release; send nothing to the customer.' }] } }] }] } });
    expect(edited.committedRevisionVector[briefRef.id]).toBe(1);
    expect((await service.artifactHistory(created.scope.sessionId, created.capabilityToken, briefRef.id)).groups[0]?.commandGroupId).toBe(commandGroupId);
    expect((await service.artifactVersions(created.scope.sessionId, created.capabilityToken, briefRef.id, undefined, 10)).versions.map((item) => item.revision)).toEqual([1, 0]);
    expect((await service.artifactVersion(created.scope.sessionId, created.capabilityToken, briefRef.id, 1)).content).toEqual((await service.artifactSnapshot(created.scope.sessionId, created.capabilityToken, briefRef.id)).content);
    const editedScope = await service.read(created.scope.sessionId, created.capabilityToken);
    expect(editedScope).toMatchObject({ revision: 1, inputRefs: expect.arrayContaining([expect.objectContaining({ id: briefRef.id, revision: 1 })]) });
    const undone = await service.artifactHistoryAction(created.scope.sessionId, created.capabilityToken, 'undo', { workspaceId: created.scope.workspaceId, expectedAuthzVersion: 1, commandGroupId: randomUUID(), targetCommandGroupId: commandGroupId, expectedArtifactRevisions: { [briefRef.id]: 1 }, expectedSourceRevisions: {} });
    expect(undone.committedRevisionVector[briefRef.id]).toBe(2);
    const scopeAfterUndo = await service.read(created.scope.sessionId, created.capabilityToken);
    expect(scopeAfterUndo).toMatchObject({ revision: 2, inputRefs: expect.arrayContaining([expect.objectContaining({ id: briefRef.id, revision: 2 })]) });
    const job = await service.createExport(created.scope.sessionId, created.capabilityToken, { workspaceId: created.scope.workspaceId, expectedAuthzVersion: 1, locale: 'en', items: [{ artifactId: briefRef.id, revision: 2, formats: ['pdf'] }] }, randomUUID());
    const rendered = await service.renderExport(created.scope.sessionId, created.capabilityToken, job.id);
    expect(rendered).toMatchObject({ status: 'ready', files: [expect.objectContaining({ status: 'ready', format: 'pdf' })] });
    const exported = await service.downloadExport(created.scope.sessionId, created.capabilityToken, job.id, rendered.files[0]!.id);
    expect(exported.mediaType).toBe('application/pdf'); expect(exported.bytes.byteLength).toBeGreaterThan(500);

    const runKey = randomUUID(), runInput = { goal: 'Check the dated order and create editable work materials.', inputRefs: scopeAfterUndo.inputRefs, expectedRevision: 2 };
    const started = await service.createRun(created.scope.sessionId, created.capabilityToken, runInput, runKey);
    expect(await service.createRun(created.scope.sessionId, created.capabilityToken, runInput, runKey)).toEqual(started);
    expect(wakes).toBe(2);
    const afterRun = await service.read(created.scope.sessionId, created.capabilityToken);
    expect(afterRun).toMatchObject({ revision: 3, runIds: [started.id] });
    expect((await service.readRun(created.scope.sessionId, created.capabilityToken, started.id)).state).toBe('queued');
    await expect(service.createRun(created.scope.sessionId, created.capabilityToken, { ...runInput, expectedRevision: 3, inputRefs: [scopeAfterUndo.inputRefs[0]] }, randomUUID())).rejects.toEqual(expect.objectContaining<Partial<DemoExecutionError>>({ code: 'DEMO_FORBIDDEN' }));

    const copySource = created.scope.inputRefs[0]!;
    await pool.query(`UPDATE agent_run_contexts SET state=jsonb_set(state,'{results}',$2::jsonb),revision=revision+1 WHERE run_id=$1`, [started.id, JSON.stringify([{ kind: 'artifact', id: copySource.id, revision: copySource.revision, title: 'Checked demo result' }])]);
    const destinationScope = await destination(), copyKey = randomUUID();
    const copied = await service.copy(created.scope.sessionId, created.capabilityToken, destinationScope.principal, { expectedRevision: 3, artifactIds: [copySource.id], destinationWorkspaceId: destinationScope.workspaceId }, copyKey);
    expect(copied.artifacts).toHaveLength(1);
    expect(await service.copy(created.scope.sessionId, created.capabilityToken, destinationScope.principal, { expectedRevision: 3, artifactIds: [copySource.id], destinationWorkspaceId: destinationScope.workspaceId }, copyKey)).toEqual(copied);
    expect((await pool.query('SELECT count(*)::int AS count FROM artifacts WHERE workspace_id=$1 AND project_id=$2', [destinationScope.workspaceId, copied.projectId])).rows[0].count).toBe(1);
    expect((await service.read(created.scope.sessionId, created.capabilityToken)).revision).toBe(4);
  });
});
