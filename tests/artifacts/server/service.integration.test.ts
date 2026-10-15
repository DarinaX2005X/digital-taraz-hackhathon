import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArtifactCommandRequest, ArtifactSnapshot } from '../../../src/features/artifacts/contracts';
import type { JsonValue } from '../../../src/features/artifacts/domain/content-models';
import { createArtifactTargetResolver } from '../../../src/features/artifacts/domain/targets';
import { createArtifactService } from '../../../src/features/artifacts/server/service';
import { createPendingSource, publishSourceVersion } from '../../../src/features/sources/server/source-heads';
import { identityTransaction, withWorkspaceAccess } from '../../../src/features/identity/server/access';
import { artifactFixture, artifactTestPool, currentArtifactAuthz, testDocument } from './test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
const paragraph = (id: string, text: string): JsonValue => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
function command(snapshot: ArtifactSnapshot, text: string, targetId = 'p1', groupId = randomUUID()): ArtifactCommandRequest {
  const resolver = createArtifactTargetResolver(snapshot.content, snapshot.artifact.bindings, snapshot.locks);
  return { workspaceId: snapshot.viewer.workspaceId, expectedAuthzVersion: snapshot.viewer.authzVersion, group: { commandGroupId: groupId, expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision }, expectedSourceRevisions: Object.fromEntries(snapshot.sourceFreshness.filter((item) => item.currentRevision !== undefined).map((item) => [item.sourceRef.sourceId, item.currentRevision!])), commands: [{ commandId: randomUUID(), artifactId: snapshot.artifact.id, baseRevision: snapshot.artifact.currentRevision, kind: 'document', operations: [{ targetId, op: 'set', value: paragraph(targetId, text), beforeHash: resolver(targetId)!.hash }], expectedSourceRevisions: Object.fromEntries(snapshot.sourceFreshness.filter((item) => item.currentRevision !== undefined).map((item) => [item.sourceRef.sourceId, item.currentRevision!])), reason: 'Manual wording' }] } };
}
function text(snapshot: ArtifactSnapshot, id: string) { return createArtifactTargetResolver(snapshot.content)(id)?.value; }

describe('durable artifacts in real PostgreSQL', () => {
  it('commits creation and AI commands only with the caller transaction, without a second connection', async () => {
    const f = await artifactFixture(pool), operationId = randomUUID();
    const input = { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1, title: 'Atomic run result', content: testDocument() };
    const tx = await pool.connect();
    const checkout = vi.spyOn(pool, 'connect').mockImplementation(() => { throw new Error('NESTED_POOL_CHECKOUT'); });
    let artifactId = '';
    try {
      await tx.query('BEGIN');
      const created = await f.service.createInTransaction(tx, { kind: 'job', userId: f.owner.userId, authzVersion: 1 }, operationId, input);
      artifactId = created.artifact.id;
      const snapshot: ArtifactSnapshot = { ...created, content: input.content, permissions: { edit: true, rename: true, duplicate: true, move: true, archive: true, trash: true, restore: false, purge: false }, sourceFreshness: [], history: [] };
      const applied = await f.service.applyInTransaction(tx, { kind: 'job', userId: f.owner.userId, authzVersion: 1 }, command(snapshot, 'Generated result'), 'ai');
      expect(applied.committedRevisionVector).toEqual({ [artifactId]: 1 });
      expect((await tx.query('SELECT count(*)::int AS count FROM artifact_operation_receipts WHERE workspace_id=$1', [f.workspaceId])).rows[0]?.count).toBe(2);
      // A failed run checkpoint must be able to roll back both artifact effects.
      await tx.query('ROLLBACK');
    } finally { checkout.mockRestore(); await tx.query('ROLLBACK'); tx.release(); }
    for (const table of ['artifacts', 'artifact_versions', 'artifact_chunks', 'artifact_commands', 'artifact_command_groups', 'artifact_operation_receipts']) {
      expect((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE workspace_id=$1`, [f.workspaceId])).rows[0]?.count).toBe(0);
    }
    expect((await pool.query("SELECT cursor FROM workspace_events WHERE workspace_id=$1 AND kind LIKE 'artifact.%'", [f.workspaceId])).rowCount).toBe(0);
    const committed = await identityTransaction(pool, (transaction) => f.service.createInTransaction(transaction, f.owner, operationId, input));
    const replay = await f.service.create(f.owner, operationId, input);
    expect(replay.artifact.id).toBe(committed.artifact.id);
    const change = command(await f.read(committed.artifact.id), 'Accepted generated result');
    const receipt = await identityTransaction(pool, (transaction) => f.service.applyInTransaction(transaction, f.owner, change, 'ai'));
    expect(await f.service.apply(f.owner, change, 'ai')).toEqual(receipt);
    expect((await f.read(committed.artifact.id)).artifact.currentRevision).toBe(1);
    expect((await pool.query("SELECT cursor FROM workspace_events WHERE workspace_id=$1 AND kind='artifact.changed'", [f.workspaceId])).rowCount).toBe(1);
  });
  it('enforces job epochs and project ACL inside caller-owned artifact transactions', async () => {
    const f = await artifactFixture(pool), created = await f.create();
    const input = { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1, title: 'Forbidden run result', content: testDocument() };
    await expect(identityTransaction(pool, (tx) => f.service.createInTransaction(tx, { kind: 'job', userId: f.owner.userId, authzVersion: 2 }, randomUUID(), input))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(identityTransaction(pool, (tx) => f.service.createInTransaction(tx, f.member, randomUUID(), input))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const change = command(await f.read(created.artifact.id), 'Forbidden change');
    await expect(identityTransaction(pool, (tx) => f.service.applyInTransaction(tx, { kind: 'job', userId: f.owner.userId, authzVersion: 2 }, change, 'ai'))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(identityTransaction(pool, (tx) => f.service.applyInTransaction(tx, f.member, change, 'ai'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.read(created.artifact.id)).artifact.currentRevision).toBe(0);
  });
  it('paginates the authorized project catalog without exposing confidential or foreign results', async () => {
    const f = await artifactFixture(pool), foreign = await artifactFixture(pool);
    const first = await f.create(testDocument(), 'Terms 100%'), second = await f.create(testDocument(), 'Terms second');
    await f.service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1, title: 'Private costs', content: testDocument(), accessClass: 'confidential' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    const input = { workspaceId: f.workspaceId, projectId: f.projectId, limit: 1 };
    const page = await f.service.list(f.member, input);
    expect(page.artifacts).toHaveLength(1); expect(page.nextAfter).not.toBeNull();
    const next = await f.service.list(f.member, { ...input, after: page.nextAfter! });
    expect(next.artifacts).toHaveLength(1); expect(next.nextAfter).toBeNull();
    expect(new Set([...page.artifacts, ...next.artifacts].map((item) => item.id))).toEqual(new Set([first.artifact.id, second.artifact.id]));
    expect((await f.service.list(f.member, { ...input, query: '%' })).artifacts.map((item) => item.title)).toEqual(['Terms 100%']);
    await expect(f.service.list(f.member, { ...input, after: page.nextAfter!, query: 'changed' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.service.list(foreign.owner, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.service.list(f.owner, { ...input, projectId: foreign.projectId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: null, expectedAuthzVersion: 2 });
    await expect(f.service.list(f.member, { ...input, after: page.nextAfter! })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('returns capabilities matching a trashed material and an archived project', async () => {
    const f = await artifactFixture(pool), created = await f.create();
    await pool.query("UPDATE projects SET status='archived' WHERE id=$1", [f.projectId]);
    expect((await f.read(created.artifact.id)).permissions).toEqual({ edit: false, rename: false, duplicate: false, move: false, archive: false, trash: true, restore: false, purge: false });
    const trashed = await f.service.trash(f.owner, randomUUID(), created.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: 0 });
    expect(trashed.artifact.status).toBe('trashed');
    expect((await f.read(created.artifact.id)).permissions).toMatchObject({ duplicate: false, purge: true, restore: false });
    await pool.query("UPDATE projects SET status='active' WHERE id=$1", [f.projectId]);
    expect((await f.read(created.artifact.id)).permissions).toMatchObject({ duplicate: false, restore: true });
  });
  it('creates exactly once for simultaneous retries, keeps immutable versions and reopens from stored chunks', async () => {
    const f = await artifactFixture(pool), key = randomUUID(), body = { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1, title: 'Terms', content: testDocument() };
    const [first, retry] = await Promise.all([f.service.create(f.owner, key, body), f.service.create(f.owner, key, body)]);
    expect(first.artifact.id).toBe(retry.artifact.id);
    await expect(f.service.create(f.owner, key, { ...body, title: 'Changed retry' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await pool.query('SELECT id FROM artifacts WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(1);
    expect((await pool.query('SELECT id FROM artifact_versions WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(1);
    const opened = await f.read(first.artifact.id);
    expect(opened.content).toEqual(body.content);
    const secondPool = artifactTestPool();
    try { expect((await createArtifactService(secondPool).readRoute(f.owner, { projectId: f.projectId, artifactId: first.artifact.id })).content).toEqual(body.content); }
    finally { await secondPool.end(); }
    await expect(pool.query('UPDATE artifact_versions SET reason=$2 WHERE id=$1', [first.version.id, 'Tampered'])).rejects.toMatchObject({ code: '23514', constraint: 'artifact_content_immutable' });
  });
  it('serializes two writers at one base and replays a committed group without creating a second effect', async () => {
    const f = await artifactFixture(pool), created = await f.create();
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 1 });
    const initial = await f.read(created.artifact.id), a = command(initial, 'Owner revision'), b = command(initial, 'Editor revision', 'p2');
    const outcomes = await Promise.allSettled([f.service.apply(f.owner, a), f.service.apply(f.member, b)]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected').map((result) => result.reason)).toMatchObject([{ code: 'CONFLICT' }]);
    const winner = outcomes[0]!.status === 'fulfilled' ? { principal: f.owner, input: a, result: outcomes[0].value } : { principal: f.member, input: b, result: (outcomes[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof f.service.apply>>>).value };
    const replay = await Promise.all([f.service.apply(winner.principal, winner.input), f.service.apply(winner.principal, winner.input)]);
    expect(replay).toEqual([winner.result, winner.result]);
    const altered = structuredClone(winner.input); altered.group.commands[0]!.reason = 'Different retry';
    await expect(f.service.apply(winner.principal, altered)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read(created.artifact.id)).artifact.currentRevision).toBe(1);
    expect((await pool.query('SELECT id FROM artifact_command_groups WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(1);
    expect((await pool.query("SELECT cursor FROM workspace_events WHERE workspace_id=$1 AND kind='artifact.changed'", [f.workspaceId])).rowCount).toBe(1);
  });
  it('rolls an entire two-artifact group back on one stale target with no receipt, event or revision', async () => {
    const f = await artifactFixture(pool), one = await f.create(), two = await f.create();
    const a = command(await f.read(one.artifact.id), 'Would change first'), b = command(await f.read(two.artifact.id), 'Must reject second');
    a.group.commands.push(b.group.commands[0]!); a.group.expectedArtifactRevisions[two.artifact.id] = 0;
    a.group.commands[1]!.operations[0]!.beforeHash = '0'.repeat(64);
    const before = await pool.query('SELECT count(*)::int AS count FROM artifact_chunks WHERE workspace_id=$1', [f.workspaceId]);
    await expect(f.service.apply(f.owner, a)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read(one.artifact.id)).artifact.currentRevision).toBe(0); expect((await f.read(two.artifact.id)).artifact.currentRevision).toBe(0);
    expect((await pool.query('SELECT id FROM artifact_command_groups WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM artifact_chunks WHERE workspace_id=$1', [f.workspaceId])).rows).toEqual(before.rows);
    expect((await pool.query('SELECT operation_id FROM artifact_operation_receipts WHERE workspace_id=$1 AND operation_id=$2', [f.workspaceId, a.group.commandGroupId])).rowCount).toBe(0);
  });
  it('undoes/redoes a complete group while keeping another target; any later target conflict aborts the whole inverse', async () => {
    const f = await artifactFixture(pool), one = await f.create(), two = await f.create();
    const a = command(await f.read(one.artifact.id), 'First accepted'), b = command(await f.read(two.artifact.id), 'Second accepted');
    a.group.commands.push(b.group.commands[0]!); a.group.expectedArtifactRevisions[two.artifact.id] = 0;
    await f.service.apply(f.owner, a);
    await f.service.apply(f.owner, command(await f.read(one.artifact.id), 'Later independent delivery', 'p2'));
    const action = { workspaceId: f.workspaceId, expectedAuthzVersion: 1, commandGroupId: randomUUID(), targetCommandGroupId: a.group.commandGroupId, expectedArtifactRevisions: { [one.artifact.id]: 2, [two.artifact.id]: 1 }, expectedSourceRevisions: {} };
    const undone = await f.service.undo(f.owner, action);
    expect(text(await f.read(one.artifact.id), 'p1')).toEqual(paragraph('p1', 'Original first condition'));
    expect(text(await f.read(one.artifact.id), 'p2')).toEqual(paragraph('p2', 'Later independent delivery'));
    expect((await f.service.history(f.owner, { workspaceId: f.workspaceId, artifactId: two.artifact.id })).groups[0]).toMatchObject({ commandGroupId: a.group.commandGroupId, state: 'undone', canRedo: true });
    const redone = await f.service.redo(f.owner, { ...action, commandGroupId: randomUUID(), expectedArtifactRevisions: undone.committedRevisionVector });
    expect(text(await f.read(two.artifact.id), 'p1')).toEqual(paragraph('p1', 'Second accepted'));
    await f.service.apply(f.owner, command(await f.read(two.artifact.id), 'Later protected change'));
    await expect(f.service.undo(f.owner, { ...action, commandGroupId: randomUUID(), expectedArtifactRevisions: { ...redone.committedRevisionVector, [two.artifact.id]: redone.committedRevisionVector[two.artifact.id]! + 1 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(text(await f.read(one.artifact.id), 'p1')).toEqual(paragraph('p1', 'First accepted'));
  });
  it('keeps a durable last-100 undo window and all retained versions across a new service instance', async () => {
    const f = await artifactFixture(pool), created = await f.create(); let firstGroup = '';
    const snapshot = await f.read(created.artifact.id);
    for (let i = 0; i < 103; i++) {
      const input = command(snapshot, `Revision ${i}`);
      if (!i) firstGroup = input.group.commandGroupId;
      const accepted = await f.service.apply(f.owner, input);
      snapshot.artifact.currentRevision = accepted.committedRevisionVector[created.artifact.id]!;
      snapshot.content = testDocument(`Revision ${i}`);
    }
    const reopened = createArtifactService(pool), history = await reopened.history(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id });
    expect(history.groups).toHaveLength(100); expect(history.groups.some((group) => group.commandGroupId === firstGroup)).toBe(false);
    expect((await pool.query('SELECT id FROM artifact_versions WHERE artifact_id=$1', [created.artifact.id])).rowCount).toBe(104);
    await expect(reopened.undo(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, commandGroupId: randomUUID(), targetCommandGroupId: firstGroup, expectedArtifactRevisions: { [created.artifact.id]: 103 }, expectedSourceRevisions: {} })).rejects.toMatchObject({ code: 'CONFLICT' });
    const old = await reopened.version(f.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id, revision: 0 });
    expect(old.headRevision).toBe(103); expect(old.content).toEqual(testDocument());
  }, 60000);
  it('archives, moves, branches, restores as new versions, and refuses purge while another branch retains a parent', async () => {
    const f = await artifactFixture(pool), created = await f.create(), target = await f.projects.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, title: 'Second project', expectedAuthzVersion: 1 });
    const mutation = { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: 0 };
    const archived = await f.service.archive(f.owner, randomUUID(), created.artifact.id, mutation);
    expect((await f.read(created.artifact.id)).permissions.edit).toBe(false);
    await expect(f.service.apply(f.owner, command(await f.read(created.artifact.id), 'Blocked edit'))).rejects.toMatchObject({ code: 'CONFLICT' });
    const restored = await f.service.restore(f.owner, randomUUID(), created.artifact.id, { ...mutation, baseRevision: archived.artifact.currentRevision });
    const moved = await f.service.move(f.owner, randomUUID(), created.artifact.id, { ...mutation, baseRevision: restored.artifact.currentRevision, projectId: target.project.id });
    expect(moved.artifact.projectId).toBe(target.project.id);
    await expect(f.service.readRoute(f.owner, { projectId: f.projectId, artifactId: created.artifact.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.service.readRoute(f.owner, { projectId: target.project.id, artifactId: created.artifact.id })).artifact.projectId).toBe(target.project.id);
    const branch = await f.service.branch(f.owner, randomUUID(), created.artifact.id, { ...mutation, baseRevision: moved.artifact.currentRevision, parentRevision: 0, title: 'Alternative wording', projectId: f.projectId, content: testDocument('Branch first condition') });
    expect(branch.version.branchParent).toMatchObject({ artifactId: created.artifact.id, revision: 0 });
    expect(text(await f.read(branch.artifact.id), 'p1')).toEqual(paragraph('p1', 'Branch first condition'));
    const trash = await f.service.trash(f.owner, randomUUID(), created.artifact.id, { ...mutation, baseRevision: moved.artifact.currentRevision });
    await expect(f.service.purge(f.owner, randomUUID(), created.artifact.id, { ...mutation, baseRevision: trash.artifact.currentRevision, confirmationTitle: trash.artifact.title, immediate: true })).rejects.toMatchObject({ code: 'CONFLICT', messageKey: 'artifacts.errors.inUse' });
    const branchTrash = await f.service.trash(f.owner, randomUUID(), branch.artifact.id, mutation);
    await f.service.purge(f.owner, randomUUID(), branch.artifact.id, { ...mutation, baseRevision: branchTrash.artifact.currentRevision, confirmationTitle: branch.artifact.title, immediate: true });
    const deleted = await f.service.purge(f.owner, randomUUID(), created.artifact.id, { ...mutation, baseRevision: trash.artifact.currentRevision, confirmationTitle: trash.artifact.title, immediate: true });
    expect(deleted.cleanupPending).toBe(true);
    await expect(f.read(created.artifact.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await pool.query('SELECT cleanup_state FROM artifact_tombstones WHERE artifact_id=$1', [created.artifact.id])).rows[0]).toEqual({ cleanup_state: 'pending' });
  });
  it('enforces foreign/project/confidential ACL, current replay authority and revoked job fences', async () => {
    const f = await artifactFixture(pool), foreign = await artifactFixture(pool), created = await f.create();
    await expect(f.service.read(foreign.owner, { workspaceId: f.workspaceId, artifactId: created.artifact.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.read(created.artifact.id, f.member)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 1 });
    const privateArtifact = await f.service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 2, title: 'Confidential costs', content: testDocument(), accessClass: 'confidential' });
    await expect(f.read(privateArtifact.artifact.id, f.member)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const pending = command(await f.read(created.artifact.id, f.member), 'Member change'), committed = await f.service.apply(f.member, pending);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 2 });
    expect(await f.service.apply(f.member, pending)).toEqual(committed);
    const freshAction = command(await f.read(created.artifact.id, f.member), 'Not committed'); freshAction.expectedAuthzVersion = 2;
    await expect(f.service.apply(f.member, freshAction)).rejects.toMatchObject({ code: 'CONFLICT', recovery: 'reload' });
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: null, expectedAuthzVersion: 3 });
    await expect(f.service.apply(f.member, pending)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.service.apply({ kind: 'job', userId: f.member.userId, authzVersion: 2 }, pending, 'ai')).rejects.toMatchObject({ code: 'CONFLICT' });
    const access = await f.service.access(f.owner, { workspaceId: f.workspaceId, artifactIds: [created.artifact.id, privateArtifact.artifact.id, randomUUID()] });
    expect(access.authorizedArtifactIds).toHaveLength(2); expect(access.unavailableArtifactIds).toHaveLength(1); expect(access.editableArtifactIds).toHaveLength(2);
  });
  it('marks a changed fixture price as stale without rewriting manual text and validates expected source heads', async () => {
    const f = await artifactFixture(pool), sourceId = randomUUID(), versionId = randomUUID();
    const hashes = await Promise.all(['../../../fixtures/business/homegoods/catalog.csv', '../../../fixtures/business/changes/homegoods/catalog-new-price.csv'].map(async (path) => createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex')));
    await withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, projectId: f.projectId, scope: 'edit' }, async (tx, access) => { await createPendingSource(tx, access, { sourceId, projectId: f.projectId, accessClass: 'internal' }); await publishSourceVersion(tx, access, { sourceId, versionId, expectedRevision: 0, snapshotHash: hashes[0]! }); });
    const created = await f.service.create(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, expectedAuthzVersion: 1, title: 'Price terms', content: testDocument('Agreed special price'), sourceRefs: [{ sourceId, sourceVersionId: versionId, revision: 1 }] });
    const old = await f.read(created.artifact.id), oldCommand = command(old, 'Manual note');
    await withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, projectId: f.projectId, scope: 'edit' }, (tx, access) => publishSourceVersion(tx, access, { sourceId, versionId: randomUUID(), expectedRevision: 1, snapshotHash: hashes[1]! }));
    const stale = await f.read(created.artifact.id);
    expect(stale.sourceFreshness[0]).toMatchObject({ status: 'stale', currentRevision: 2 }); expect(text(stale, 'p1')).toEqual(paragraph('p1', 'Agreed special price'));
    await expect(f.service.apply(f.owner, oldCommand)).rejects.toMatchObject({ code: 'CONFLICT', conflictRefs: [{ kind: 'source', reason: 'source-changed' }] });
    await f.service.apply(f.owner, command(stale, 'Conscious manual note'));
    expect(text(await f.read(created.artifact.id), 'p1')).toEqual(paragraph('p1', 'Conscious manual note'));
    expect(await currentArtifactAuthz(pool, f.workspaceId)).toBe(1);
  });
});
