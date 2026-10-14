import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopesForRole } from '../../../src/features/identity/domain/policy';
import { identityTransaction, withWorkspaceAccess, type SessionPrincipal } from '../../../src/features/identity/server/access';
import { createProjectCore } from '../../../src/features/workspace/server/project-core';
import { createPendingSource, markSourceUnavailable, publishSourceVersion, readSourceFreshness } from '../../../src/features/sources/server/source-heads';
import { appendWorkspaceEvents, decodeWorkspaceCursor } from '../../../src/features/artifacts/server/workspace-events';

let pool: Pool;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/tirlik' || process.env.OPENROUTER_API_KEY || process.env.BREVO_API_KEY || process.env.SMTP_PASSWORD) throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
  pool = new Pool({ connectionString: url.href, application_name: 'artifact-core-integration', max: 8 });
});
afterAll(async () => { await pool?.end(); });

async function fixture() {
  const owner: SessionPrincipal = { kind: 'session', userId: randomUUID(), sessionId: randomUUID() };
  const member: SessionPrincipal = { kind: 'session', userId: randomUUID(), sessionId: randomUUID() };
  const workspaceId = randomUUID();
  await identityTransaction(pool, async (transaction) => {
    for (const principal of [owner, member]) {
      await transaction.query('INSERT INTO identity_users(id,name,email,email_verified) VALUES($1,$2,$3,true)', [principal.userId, 'Synthetic fixture account', `${principal.userId}@example.test`]);
      await transaction.query("INSERT INTO identity_sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [principal.sessionId, principal.userId, randomUUID()]);
    }
    await transaction.query('INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,$2,$3)', [workspaceId, 'Synthetic source workspace', owner.userId]);
    await transaction.query("INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,'owner',$4),($5,$2,$6,'editor',$7)", [randomUUID(), workspaceId, owner.userId, scopesForRole('owner'), randomUUID(), member.userId, scopesForRole('editor')]);
  });
  const projects = createProjectCore(pool);
  const result = await projects.create(owner, randomUUID(), { workspaceId, title: 'Synthetic business project', expectedAuthzVersion: 1 });
  return { owner, member, workspaceId, projectId: result.project.id, projects };
}

async function currentAuthz(workspaceId: string): Promise<number> {
  return (await pool.query<{ authz_version: number }>('SELECT authz_version FROM identity_workspaces WHERE id=$1', [workspaceId])).rows[0]!.authz_version;
}

async function waitForLock(queryPattern: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='artifact-core-integration' AND wait_event_type='Lock' AND query LIKE $1 AND pid<>pg_backend_pid()", [queryPattern]);
    if (waiting.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('EXPECTED_DATABASE_LOCK_NOT_OBSERVED');
}

describe('canonical projects and source heads in real PostgreSQL', () => {
  it('creates projects once, checks actual project existence and intersects explicit grants', async () => {
    const context = await fixture(); const foreign = await fixture();
    const body = { workspaceId: context.workspaceId, title: 'Synthetic quotation', expectedAuthzVersion: 1 };
    const key = randomUUID();
    const results = await Promise.all([context.projects.create(context.owner, key, body), context.projects.create(context.owner, key, body)]);
    expect(results[0]!.project.id).toBe(results[1]!.project.id);
    expect((await pool.query('SELECT id FROM projects WHERE workspace_id=$1 AND creation_key=$2', [context.workspaceId, key])).rowCount).toBe(1);
    expect((await pool.query('SELECT cursor FROM workspace_events WHERE workspace_id=$1 AND object_id=$2', [context.workspaceId, results[0]!.project.id])).rowCount).toBe(1);
    await expect(context.projects.create(context.owner, key, { ...body, title: 'Changed retry body' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(context.projects.read(context.owner, context.workspaceId, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(context.projects.read(context.owner, context.workspaceId, foreign.projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(context.projects.read(context.member, context.workspaceId, context.projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const grant = await context.projects.setGrant(context.owner, randomUUID(), { workspaceId: context.workspaceId, projectId: context.projectId, userId: context.member.userId, scopes: ['read'], expectedAuthzVersion: 1 });
    expect(grant.authzVersion).toBe(2);
    expect((await context.projects.read(context.member, context.workspaceId, context.projectId)).project.id).toBe(context.projectId);
    await expect(withWorkspaceAccess(pool, context.member, { workspaceId: context.workspaceId, projectId: context.projectId, scope: 'edit' }, async () => true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(pool.query("INSERT INTO identity_project_grants(workspace_id,project_id,user_id,scopes) VALUES($1,$2,$3,ARRAY['read'])", [context.workspaceId, foreign.projectId, context.member.userId])).rejects.toMatchObject({ code: '23503' });
    const own = await context.projects.create(context.member, randomUUID(), { workspaceId: context.workspaceId, title: 'Editor own work', expectedAuthzVersion: 2 });
    expect(own.authzVersion).toBe(3);
    expect((await context.projects.read(context.member, context.workspaceId, own.project.id)).project.id).toBe(own.project.id);
  });

  it('compares actual old/new price hashes, never promotes pending input, and keeps unresolved fact identity unknown', async () => {
    const context = await fixture(); const sourceId = randomUUID(); const version1 = randomUUID(); const version2 = randomUUID();
    const beforeHash = hash(await readFile(new URL('../../../fixtures/business/homegoods/catalog.csv', import.meta.url)));
    const afterHash = hash(await readFile(new URL('../../../fixtures/business/changes/homegoods/catalog-new-price.csv', import.meta.url)));
    expect(afterHash).not.toBe(beforeHash);
    const ref = { sourceId, sourceVersionId: version1, revision: 1 };
    const write = <T>(effect: Parameters<typeof withWorkspaceAccess<T>>[3]) => withWorkspaceAccess(pool, context.owner, { workspaceId: context.workspaceId, projectId: context.projectId, scope: 'edit' }, effect);
    await write((transaction, access) => createPendingSource(transaction, access, { sourceId, projectId: context.projectId, accessClass: 'internal' }));
    expect((await write((transaction, access) => readSourceFreshness(transaction, access, [ref])))[0]).toEqual({ sourceRef: ref, status: 'unknown', sourceStatus: 'unknown' });
    await write((transaction, access) => publishSourceVersion(transaction, access, { sourceId, versionId: version1, expectedRevision: 0, snapshotHash: beforeHash }));
    expect((await write((transaction, access) => readSourceFreshness(transaction, access, [ref])))[0]?.status).toBe('current');
    await write((transaction, access) => publishSourceVersion(transaction, access, { sourceId, versionId: version2, expectedRevision: 1, snapshotHash: afterHash }));
    const stale = (await write((transaction, access) => readSourceFreshness(transaction, access, [ref])))[0]!;
    expect(stale).toMatchObject({ status: 'stale', currentVersionId: version2, currentRevision: 2 });
    await write((transaction, access) => publishSourceVersion(transaction, access, { sourceId, versionId: version1, expectedRevision: 0, snapshotHash: beforeHash }));
    expect((await pool.query('SELECT current_version_id FROM sources WHERE id=$1', [sourceId])).rows[0].current_version_id).toBe(version2);
    await expect(write((transaction, access) => publishSourceVersion(transaction, access, { sourceId, versionId: version1, expectedRevision: 0, snapshotHash: afterHash }))).rejects.toMatchObject({ code: 'CONFLICT' });
    const factRef = { sourceId, sourceVersionId: version2, revision: 2, collectionId: randomUUID(), recordId: randomUUID(), fieldId: 'priceKzt', factRevision: 2 };
    expect((await write((transaction, access) => readSourceFreshness(transaction, access, [factRef])))[0]).toMatchObject({ status: 'unknown', sourceStatus: 'current', factStatus: 'unknown' });
    await write((transaction, access) => markSourceUnavailable(transaction, access, sourceId));
    expect((await write((transaction, access) => readSourceFreshness(transaction, access, [ref])))[0]).toEqual({ sourceRef: ref, status: 'unknown', sourceStatus: 'unknown' });
    await expect(pool.query('UPDATE source_versions SET snapshot_hash=$2 WHERE id=$1', [version1, afterHash])).rejects.toMatchObject({ code: '23514', constraint: 'artifact_content_immutable' });
  });

  it('hides closed sources and fences a previously authorized job after project-grant revocation', async () => {
    const context = await fixture(); const sourceId = randomUUID(); const versionId = randomUUID();
    await withWorkspaceAccess(pool, context.owner, { workspaceId: context.workspaceId, projectId: context.projectId, scope: 'edit', confidential: true }, async (transaction, access) => {
      await createPendingSource(transaction, access, { sourceId, projectId: context.projectId, accessClass: 'confidential' });
      await publishSourceVersion(transaction, access, { sourceId, versionId, expectedRevision: 0, snapshotHash: hash('synthetic private cost') });
    });
    const granted = await context.projects.setGrant(context.owner, randomUUID(), { workspaceId: context.workspaceId, projectId: context.projectId, userId: context.member.userId, scopes: ['read', 'edit'], expectedAuthzVersion: 1 });
    const ref = { sourceId, sourceVersionId: versionId, revision: 1 };
    const output = await withWorkspaceAccess(pool, context.member, { workspaceId: context.workspaceId, projectId: context.projectId, scope: 'read' }, (transaction, access) => readSourceFreshness(transaction, access, [ref]));
    expect(output).toEqual([{ sourceRef: ref, status: 'unknown', sourceStatus: 'unknown' }]);
    const key = randomUUID(); const body = { workspaceId: context.workspaceId, projectId: context.projectId, userId: context.member.userId, scopes: null, expectedAuthzVersion: granted.authzVersion };
    const removed = await context.projects.setGrant(context.owner, key, body);
    expect(removed.authzVersion).toBe(granted.authzVersion + 1);
    expect(await context.projects.setGrant(context.owner, key, body)).toEqual(removed);
    expect(await currentAuthz(context.workspaceId)).toBe(removed.authzVersion);
    await expect(withWorkspaceAccess(pool, { kind: 'job', userId: context.member.userId, authzVersion: granted.authzVersion }, { workspaceId: context.workspaceId, scope: 'read' }, async () => true)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(context.projects.read(context.member, context.workspaceId, context.projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('holds source freshness stable until the command transaction ends', async () => {
    const context = await fixture(); const sourceId = randomUUID(); const first = randomUUID();
    const request = { workspaceId: context.workspaceId, projectId: context.projectId, scope: 'edit' as const };
    await withWorkspaceAccess(pool, context.owner, request, async (transaction, access) => {
      await createPendingSource(transaction, access, { sourceId, projectId: context.projectId, accessClass: 'internal' });
      await publishSourceVersion(transaction, access, { sourceId, versionId: first, expectedRevision: 0, snapshotHash: hash('price1') });
    });
    let release!: () => void; let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }); const ready = new Promise<void>((resolve) => { entered = resolve; });
    const reader = withWorkspaceAccess(pool, context.owner, request, async (transaction, access) => {
      const freshness = await readSourceFreshness(transaction, access, [{ sourceId, sourceVersionId: first, revision: 1 }]);
      entered(); await held; return freshness;
    });
    await ready;
    const publishing = withWorkspaceAccess(pool, context.owner, request, (transaction, access) => publishSourceVersion(transaction, access, { sourceId, versionId: randomUUID(), expectedRevision: 1, snapshotHash: hash('price2') }));
    try {
      await waitForLock('%FROM sources%FOR UPDATE%');
      expect((await pool.query('SELECT current_revision FROM sources WHERE id=$1', [sourceId])).rows[0].current_revision).toBe(1);
    } finally { release(); }
    expect((await reader)[0]?.status).toBe('current');
    expect((await publishing).revision).toBe(2);
  });

  it('publishes workspace cursors in commit order and reuses an aborted cursor without a gap', async () => {
    const context = await fixture(); const request = { workspaceId: context.workspaceId, projectId: context.projectId, scope: 'edit' as const };
    let release!: () => void; let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }); const ready = new Promise<void>((resolve) => { entered = resolve; });
    const aborted = withWorkspaceAccess(pool, context.owner, request, async (transaction, access) => {
      const cursor = await appendWorkspaceEvents(transaction, access, [{ projectId: context.projectId, accessClass: 'internal', kind: 'project.changed', objectId: context.projectId, revision: 2, payload: {} }]);
      expect(decodeWorkspaceCursor(cursor)?.position).toBe('2'); entered(); await held; throw new Error('SYNTHETIC_TRANSACTION_ABORT');
    });
    const rejected = expect(aborted).rejects.toThrow('SYNTHETIC_TRANSACTION_ABORT');
    await ready;
    const committed = withWorkspaceAccess(pool, context.owner, request, (transaction, access) => appendWorkspaceEvents(transaction, access, [{ projectId: context.projectId, accessClass: 'internal', kind: 'project.changed', objectId: context.projectId, revision: 3, payload: {} }]));
    try {
      await waitForLock('%workspace_event_heads%');
      expect((await pool.query('SELECT max(cursor)::text AS cursor FROM workspace_events WHERE workspace_id=$1', [context.workspaceId])).rows[0].cursor).toBe('1');
    } finally { release(); }
    await rejected;
    expect(decodeWorkspaceCursor(await committed)?.position).toBe('2');
    expect((await pool.query('SELECT revision FROM workspace_events WHERE workspace_id=$1 ORDER BY cursor', [context.workspaceId])).rows.map((row) => row.revision)).toEqual([1, 3]);
  });

  it('keeps immutable retained content and prevents cross-workspace references and unsafe purge', async () => {
    const context = await fixture(); const foreign = await fixture();
    const artifactId = randomUUID(); const contentId = randomUUID(); const versionId = randomUUID();
    const manual = JSON.parse(await readFile(new URL('../../../fixtures/business/changes/homegoods/manual-edit.json', import.meta.url), 'utf8')) as { manualField: { value: string } };
    const data = { type: 'paragraph', attrs: { id: 'offer-introduction' }, content: [{ type: 'text', text: manual.manualField.value }] };
    const encoded = JSON.stringify(data); const contentHash = hash(encoded);
    await identityTransaction(pool, async (transaction) => {
      await transaction.query('INSERT INTO artifact_chunks(workspace_id,hash,data,byte_size) VALUES($1,$2,$3,$4)', [context.workspaceId, contentHash, encoded, Buffer.byteLength(encoded)]);
      await transaction.query('INSERT INTO artifact_content_manifests(id,workspace_id,root_hash) VALUES($1,$2,$3)', [contentId, context.workspaceId, contentHash]);
      await transaction.query("INSERT INTO artifacts(id,workspace_id,project_id,kind,schema_version,current_revision,title,content_id,content_hash,created_by) VALUES($1,$2,$3,'document',1,0,'Synthetic retained proposal',$4,$5,$6)", [artifactId, context.workspaceId, context.projectId, contentId, contentHash, context.owner.userId]);
      await transaction.query("INSERT INTO artifact_versions(id,workspace_id,artifact_id,revision,content_id,content_hash,snapshot_hash,project_id,title,status,schema_version,reason,author_id,input_revisions) VALUES($1,$2,$3,0,$4,$5,$5,$6,'Synthetic retained proposal','draft',1,'Synthetic saved version',$7,'{}')", [versionId, context.workspaceId, artifactId, contentId, contentHash, context.projectId, context.owner.userId]);
      await transaction.query("INSERT INTO artifact_version_pins(id,workspace_id,artifact_id,revision,kind,retainer_id) VALUES($1,$2,$3,0,'export',$4)", [randomUUID(), context.workspaceId, artifactId, randomUUID()]);
    });
    await expect(pool.query("UPDATE artifact_chunks SET data='{}' WHERE workspace_id=$1 AND hash=$2", [context.workspaceId, contentHash])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query("UPDATE artifact_versions SET title='Rewritten' WHERE id=$1", [versionId])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('DELETE FROM artifacts WHERE id=$1', [artifactId])).rejects.toMatchObject({ code: '23503' });
    await expect(pool.query('INSERT INTO artifact_content_manifests(id,workspace_id,root_hash) VALUES($1,$2,$3)', [randomUUID(), foreign.workspaceId, contentHash])).rejects.toMatchObject({ code: '23503' });
    await expect(pool.query("UPDATE artifacts SET status='trashed',trashed_at=now() WHERE id=$1", [artifactId])).rejects.toMatchObject({ code: '23514' });
    expect((await pool.query('SELECT data FROM artifact_chunks WHERE workspace_id=$1 AND hash=$2', [context.workspaceId, contentHash])).rows[0].data.content[0].text).toBe(manual.manualField.value);
  });
});
