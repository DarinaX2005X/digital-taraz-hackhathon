import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createArtifactTargetResolver } from '../../../src/features/artifacts/domain/targets';
import { cleanupArtifactContent, retainWorkspaceEvents } from '../../../src/features/artifacts/server/maintenance';
import { createWorkspaceEventFeed } from '../../../src/features/artifacts/server/event-feed';
import { loadArtifact, loadState, loadVersion, readCursor } from '../../../src/features/artifacts/server/service-support';
import { withWorkspaceAccess } from '../../../src/features/identity/server/access';
import { artifactFixture, artifactTestPool, testDocument } from './test-fixture';

let pool: Pool;
beforeAll(() => { pool = artifactTestPool(); });
afterAll(async () => { await pool?.end(); });
async function waitForLock(pattern: string) {
  for (let i = 0; i < 100; i++) {
    const row = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='artifact-service-integration' AND wait_event_type='Lock' AND query LIKE $1 AND pid<>pg_backend_pid()", [pattern]);
    if (row.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('EXPECTED_DATABASE_LOCK_NOT_OBSERVED');
}
async function trashedFixture() {
  const f = await artifactFixture(pool), created = await f.create();
  const trashed = await f.service.trash(f.owner, randomUUID(), created.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: 0 });
  const purge = () => f.service.purge(f.owner, randomUUID(), created.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: trashed.artifact.currentRevision, confirmationTitle: created.artifact.title, immediate: true });
  return { ...f, created, trashed, purge };
}

describe('artifact retention and concurrent cleanup in real PostgreSQL', () => {
  it('retains an in-flight snapshot during purge/GC and reuses chunks still referenced by an independent copy', async () => {
    const f = await artifactFixture(pool), created = await f.create();
    const duplicate = await f.service.duplicate(f.owner, randomUUID(), created.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: 0, projectId: f.projectId, title: 'Independent copy' });
    const snapshot = await f.read(created.artifact.id), beforeHash = createArtifactTargetResolver(snapshot.content)('p1')!.hash;
    await f.service.apply(f.owner, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, group: { commandGroupId: randomUUID(), expectedArtifactRevisions: { [created.artifact.id]: 0 }, expectedSourceRevisions: {}, commands: [{ commandId: randomUUID(), artifactId: created.artifact.id, kind: 'document', baseRevision: 0, reason: 'Unique changed content', expectedSourceRevisions: {}, operations: [{ targetId: 'p1', op: 'set', beforeHash, value: { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Only in deleted material' }] } }] }] } });
    const trashed = await f.service.trash(f.owner, randomUUID(), created.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: 1 });
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { entered = resolve; });
    const reading = withWorkspaceAccess(pool, f.owner, { workspaceId: f.workspaceId, scope: 'read' }, async (tx, access) => {
      const cursor = await readCursor(tx, access), { row } = await loadArtifact(tx, access, created.artifact.id);
      entered(); await held;
      return { cursor, version: await loadVersion(tx, row), ...(await loadState(tx, row)) };
    });
    await ready;
    const purging = f.service.purge(f.owner, randomUUID(), created.artifact.id, { workspaceId: f.workspaceId, expectedAuthzVersion: 1, baseRevision: trashed.artifact.currentRevision, confirmationTitle: trashed.artifact.title, immediate: true });
    await waitForLock('%FROM artifacts%FOR UPDATE%');
    const cleanup = cleanupArtifactContent(pool, f.owner, { workspaceId: f.workspaceId });
    try { await waitForLock('%pg_advisory_xact_lock(hashtextextended%'); }
    finally { release(); }
    const [read, deleted, cleaned] = await Promise.all([reading, purging, cleanup]);
    expect(read.version.revision).toBe(2);
    expect(read.state.content).toEqual(testDocument('Only in deleted material'));
    expect(deleted.artifactId).toBe(created.artifact.id);
    expect(cleaned.cleanedArtifacts).toBe(1); expect(cleaned.removedChunks).toBeGreaterThan(0);
    expect((await f.read(duplicate.artifact.id)).content).toEqual(testDocument());
    expect((await pool.query('SELECT cleanup_state FROM artifact_tombstones WHERE artifact_id=$1', [created.artifact.id])).rows[0]).toEqual({ cleanup_state: 'complete' });
  });
  it('leaves durable tombstones and bounded retry state on GC failure, then completes a later retry', async () => {
    const f = await trashedFixture(); await f.purge();
    const suffix = randomUUID().replaceAll('-', ''), trigger = `test_gc_${suffix}`;
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.workspace_id='${f.workspaceId}'::uuid THEN RAISE EXCEPTION 'synthetic cleanup failure'; END IF; RETURN OLD; END $$`);
    await pool.query(`CREATE TRIGGER ${trigger} BEFORE DELETE ON artifact_chunks FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    try {
      await expect(cleanupArtifactContent(pool, f.owner, { workspaceId: f.workspaceId })).rejects.toThrow('synthetic cleanup failure');
      expect((await pool.query('SELECT cleanup_state,cleanup_attempts FROM artifact_tombstones WHERE artifact_id=$1', [f.created.artifact.id])).rows[0]).toEqual({ cleanup_state: 'pending', cleanup_attempts: 1 });
      expect((await pool.query('SELECT id FROM artifact_content_manifests WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBeGreaterThan(0);
    } finally { await pool.query(`DROP TRIGGER ${trigger} ON artifact_chunks`); await pool.query(`DROP FUNCTION ${trigger}()`); }
    await pool.query("UPDATE artifact_tombstones SET cleanup_after=now()-interval '1 second' WHERE artifact_id=$1", [f.created.artifact.id]);
    expect((await cleanupArtifactContent(pool, f.owner, { workspaceId: f.workspaceId })).cleanedArtifacts).toBe(1);
    expect((await pool.query('SELECT hash FROM artifact_chunks WHERE workspace_id=$1', [f.workspaceId])).rowCount).toBe(0);
    expect((await cleanupArtifactContent(pool, f.owner, { workspaceId: f.workspaceId })).cleanedArtifacts).toBe(0);
  });
  it('bounds event pages, hides closed projects and resets an expired or old-authority cursor', async () => {
    const f = await artifactFixture(pool), created = await f.create(), feed = createWorkspaceEventFeed(pool);
    const first = await feed(f.owner, { workspaceId: f.workspaceId, limit: 1 }); expect(first.events).toHaveLength(1); expect(first.hasMore).toBe(true);
    const next = await feed(f.owner, { workspaceId: f.workspaceId, cursor: first.cursor }); expect(next.events.some((event) => event.objectId === created.artifact.id)).toBe(true);
    const member = await feed(f.member, { workspaceId: f.workspaceId }); expect(member.events).toEqual([]); expect(member.hasMore).toBe(false);
    await f.projects.setGrant(f.owner, randomUUID(), { workspaceId: f.workspaceId, projectId: f.projectId, userId: f.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    expect((await feed(f.owner, { workspaceId: f.workspaceId, cursor: first.cursor })).resetRequired).toBe(true);
    const current = await feed(f.owner, { workspaceId: f.workspaceId });
    await pool.query("UPDATE workspace_events SET created_at=now()-interval '8 days' WHERE workspace_id=$1", [f.workspaceId]);
    expect((await retainWorkspaceEvents(pool, f.owner, f.workspaceId)).removedEvents).toBeGreaterThan(0);
    expect((await feed(f.owner, { workspaceId: f.workspaceId, cursor: current.events[0]!.cursor })).resetRequired).toBe(true);
    expect((await feed(f.owner, { workspaceId: f.workspaceId, cursor: current.cursor })).events).toEqual([]);
    await expect(cleanupArtifactContent(pool, f.member, { workspaceId: f.workspaceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
