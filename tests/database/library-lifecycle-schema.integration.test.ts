import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../src/server/db/migrate';

let admin: Pool;
let pool: Pool;
let schema: string;
let directory: string;

interface Fixture {
  userId: string;
  otherUserId: string;
  workspaceId: string;
  otherWorkspaceId: string;
  projectId: string;
  otherProjectId: string;
  sourceId: string;
  sourceVersionId: string;
  trashedSourceId: string;
  collectionId: string;
}

beforeEach(async () => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/tirlik') throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
  schema = `test_${randomUUID().replaceAll('-', '')}`;
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
  directory = await mkdtemp(path.join(os.tmpdir(), 'tirlik-library-lifecycle-'));
  const migrationNames = (await readdir(path.join(process.cwd(), 'migrations')))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name) && name < '0021_library_lifecycle.sql')
    .sort();
  for (const name of migrationNames) {
    await copyFile(path.join(process.cwd(), 'migrations', name), path.join(directory, name));
  }
  await migrateDatabase(pool, { directory });
});

afterEach(async () => {
  if (pool) await pool.end();
  if (admin) {
    if (/^test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
  if (directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('tirlik-library-lifecycle-')) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function seedBeforeLifecycleMigration(): Promise<Fixture> {
  const fixture: Fixture = {
    userId: randomUUID(), otherUserId: randomUUID(), workspaceId: randomUUID(), otherWorkspaceId: randomUUID(),
    projectId: randomUUID(), otherProjectId: randomUUID(), sourceId: randomUUID(), sourceVersionId: randomUUID(),
    trashedSourceId: randomUUID(), collectionId: randomUUID(),
  };
  await pool.query("INSERT INTO identity_users(id,name,email,email_verified) VALUES($1,'Lifecycle owner',$2,false),($3,'Other owner',$4,false)", [fixture.userId, `${fixture.userId}@example.test`, fixture.otherUserId, `${fixture.otherUserId}@example.test`]);
  await pool.query('BEGIN');
  try {
    await pool.query("INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,'Lifecycle workspace',$2),($3,'Other workspace',$4)", [fixture.workspaceId, fixture.userId, fixture.otherWorkspaceId, fixture.otherUserId]);
    await pool.query(
      "INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,'owner',ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[]),($4,$5,$6,'owner',ARRAY['read','edit','approve','export','manage-members','read-confidential']::text[])",
      [randomUUID(), fixture.workspaceId, fixture.userId, randomUUID(), fixture.otherWorkspaceId, fixture.otherUserId],
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  await pool.query("INSERT INTO projects(id,workspace_id,title,created_by,creation_key,creation_body_hash) VALUES($1,$2,'Current project',$3,$4,$5),($6,$7,'Other project',$8,$9,$5)", [fixture.projectId, fixture.workspaceId, fixture.userId, randomUUID(), 'a'.repeat(64), fixture.otherProjectId, fixture.otherWorkspaceId, fixture.otherUserId, randomUUID()]);
  await pool.query('BEGIN');
  try {
    await pool.query("INSERT INTO sources(id,workspace_id,project_id,access_class,state,created_by) VALUES($1,$2,$3,'internal','pending',$4),($5,$2,$3,'internal','trashed',$4)", [fixture.sourceId, fixture.workspaceId, fixture.projectId, fixture.userId, fixture.trashedSourceId]);
    await pool.query("INSERT INTO source_details(source_id,workspace_id,title) VALUES($1,$2,'Supplier price list'),($3,$2,'Old removed note')", [fixture.sourceId, fixture.workspaceId, fixture.trashedSourceId]);
    await pool.query('INSERT INTO source_versions(id,workspace_id,source_id,revision,snapshot_hash,created_by) VALUES($1,$2,$3,1,$4,$5)', [fixture.sourceVersionId, fixture.workspaceId, fixture.sourceId, 'b'.repeat(64), fixture.userId]);
    await pool.query("UPDATE sources SET state='ready',current_version_id=$3,current_revision=1 WHERE workspace_id=$1 AND id=$2", [fixture.workspaceId, fixture.sourceId, fixture.sourceVersionId]);
    await pool.query("INSERT INTO material_collections(id,workspace_id,project_id,title,kind,access_class,revision,record_count,created_by) VALUES($1,$2,$3,'Confirmed prices','prices','internal',7,12,$4)", [fixture.collectionId, fixture.workspaceId, fixture.projectId, fixture.userId]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  return fixture;
}

async function applyLifecycleMigration() {
  await pool.query(await readFile(new URL('../../migrations/0021_library_lifecycle.sql', import.meta.url), 'utf8'));
}

describe('library lifecycle metadata schema', () => {
  it('backfills existing objects and keeps metadata revisions independent from immutable content revisions', async () => {
    const fixture = await seedBeforeLifecycleMigration();
    await applyLifecycleMigration();

    expect((await pool.query('SELECT metadata_revision,lifecycle_state,source_state,trashed_at FROM library_source_lifecycle WHERE workspace_id=$1 AND source_id=$2', [fixture.workspaceId, fixture.sourceId])).rows[0]).toMatchObject({
      metadata_revision: 1, lifecycle_state: 'active', source_state: 'ready', trashed_at: null,
    });
    expect((await pool.query('SELECT lifecycle_state,restore_state,source_state,trashed_at FROM library_source_lifecycle WHERE workspace_id=$1 AND source_id=$2', [fixture.workspaceId, fixture.trashedSourceId])).rows[0]).toMatchObject({
      lifecycle_state: 'trashed', restore_state: 'active', source_state: 'unavailable', trashed_at: expect.any(Date),
    });
    expect((await pool.query('SELECT metadata_revision,lifecycle_state FROM library_collection_lifecycle WHERE workspace_id=$1 AND collection_id=$2', [fixture.workspaceId, fixture.collectionId])).rows[0]).toEqual({ metadata_revision: 1, lifecycle_state: 'active' });

    await pool.query('BEGIN');
    try {
      expect((await pool.query("UPDATE library_source_lifecycle SET metadata_revision=metadata_revision+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND source_id=$2 AND metadata_revision=1 RETURNING metadata_revision", [fixture.workspaceId, fixture.sourceId, fixture.userId])).rows[0]?.metadata_revision).toBe(2);
      await pool.query('UPDATE source_details SET title=$3 WHERE workspace_id=$1 AND source_id=$2', [fixture.workspaceId, fixture.sourceId, 'Renamed price list']);
      expect((await pool.query("UPDATE library_collection_lifecycle SET metadata_revision=metadata_revision+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND collection_id=$2 AND metadata_revision=1 RETURNING metadata_revision", [fixture.workspaceId, fixture.collectionId, fixture.userId])).rows[0]?.metadata_revision).toBe(2);
      await pool.query('UPDATE material_collections SET title=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [fixture.workspaceId, fixture.collectionId, 'Renamed confirmed prices']);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    expect((await pool.query('SELECT current_revision FROM sources WHERE id=$1', [fixture.sourceId])).rows[0]?.current_revision).toBe(1);
    expect((await pool.query('SELECT revision FROM material_collections WHERE id=$1', [fixture.collectionId])).rows[0]?.revision).toBe(7);
    expect((await pool.query('SELECT count(*)::int AS count,snapshot_hash FROM source_versions WHERE source_id=$1 GROUP BY snapshot_hash', [fixture.sourceId])).rows[0]).toEqual({ count: 1, snapshot_hash: 'b'.repeat(64) });
    expect((await pool.query('UPDATE library_source_lifecycle SET metadata_revision=3 WHERE workspace_id=$1 AND source_id=$2 AND metadata_revision=1 RETURNING metadata_revision', [fixture.workspaceId, fixture.sourceId])).rowCount).toBe(0);
    await expect(pool.query("UPDATE source_versions SET snapshot_hash=$2 WHERE id=$1", [fixture.sourceVersionId, 'c'.repeat(64)])).rejects.toThrow();
  });

  it('enforces legal trash state, tenant/project identity, and automatic lifecycle rows for new objects', async () => {
    const fixture = await seedBeforeLifecycleMigration();
    await applyLifecycleMigration();

    await expect(pool.query("UPDATE library_source_lifecycle SET lifecycle_state='trashed' WHERE workspace_id=$1 AND source_id=$2", [fixture.workspaceId, fixture.sourceId])).rejects.toThrow();
    await pool.query("UPDATE library_source_lifecycle SET lifecycle_state='trashed',restore_state='active',trashed_at=now(),metadata_revision=2 WHERE workspace_id=$1 AND source_id=$2", [fixture.workspaceId, fixture.sourceId]);
    await expect(pool.query("UPDATE library_source_lifecycle SET lifecycle_state='unknown' WHERE workspace_id=$1 AND source_id=$2", [fixture.workspaceId, fixture.sourceId])).rejects.toThrow();
    await expect(pool.query('UPDATE sources SET project_id=$2 WHERE workspace_id=$1 AND id=$3', [fixture.workspaceId, fixture.otherProjectId, fixture.sourceId])).rejects.toThrow();
    await expect(pool.query('INSERT INTO library_source_lifecycle(workspace_id,source_id,source_state,updated_by) VALUES($1,$2,\'ready\',$3)', [fixture.otherWorkspaceId, fixture.sourceId, fixture.otherUserId])).rejects.toThrow();

    const createdSourceId = randomUUID();
    await pool.query("INSERT INTO sources(id,workspace_id,project_id,access_class,state,created_by) VALUES($1,$2,$3,'internal','pending',$4)", [createdSourceId, fixture.workspaceId, fixture.projectId, fixture.userId]);
    expect((await pool.query('SELECT metadata_revision,lifecycle_state,source_state FROM library_source_lifecycle WHERE workspace_id=$1 AND source_id=$2', [fixture.workspaceId, createdSourceId])).rows[0]).toEqual({ metadata_revision: 1, lifecycle_state: 'active', source_state: 'pending' });
    await pool.query("UPDATE sources SET state='unavailable' WHERE workspace_id=$1 AND id=$2", [fixture.workspaceId, createdSourceId]);
    expect((await pool.query('SELECT source_state FROM library_source_lifecycle WHERE workspace_id=$1 AND source_id=$2', [fixture.workspaceId, createdSourceId])).rows[0]?.source_state).toBe('unavailable');

    const createdCollectionId = randomUUID();
    await pool.query("INSERT INTO material_collections(id,workspace_id,project_id,title,kind,access_class,created_by) VALUES($1,$2,$3,'New collection','general','internal',$4)", [createdCollectionId, fixture.workspaceId, fixture.projectId, fixture.userId]);
    expect((await pool.query('SELECT metadata_revision,lifecycle_state FROM library_collection_lifecycle WHERE workspace_id=$1 AND collection_id=$2', [fixture.workspaceId, createdCollectionId])).rows[0]).toEqual({ metadata_revision: 1, lifecycle_state: 'active' });
  });

  it('stores deterministic actor-scoped receipts and rejects mismatched objects, operations, hashes, and expiry', async () => {
    const fixture = await seedBeforeLifecycleMigration();
    await applyLifecycleMigration();
    const operationId = randomUUID();
    const values = [fixture.workspaceId, fixture.userId, operationId, fixture.sourceId, 'd'.repeat(64), JSON.stringify({ changed: true })];
    await pool.query(`INSERT INTO library_lifecycle_operations(workspace_id,actor_id,operation_id,object_kind,source_id,operation,body_hash,result)
      VALUES($1,$2,$3,'source',$4,'source.rename',$5,$6)`, values);
    const receipt = (await pool.query('SELECT operation,body_hash,result,expires_at>created_at AS valid_expiry FROM library_lifecycle_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', values.slice(0, 3))).rows[0];
    expect(receipt).toEqual({ operation: 'source.rename', body_hash: 'd'.repeat(64), result: { changed: true }, valid_expiry: true });
    await expect(pool.query(`INSERT INTO library_lifecycle_operations(workspace_id,actor_id,operation_id,object_kind,source_id,operation,body_hash,result)
      VALUES($1,$2,$3,'source',$4,'source.move',$5,$6)`, values)).rejects.toThrow();
    await expect(pool.query(`INSERT INTO library_lifecycle_operations(workspace_id,actor_id,operation_id,object_kind,source_id,operation,body_hash,result)
      VALUES($1,$2,$3,'collection',$4,'source.rename',$5,$6)`, [fixture.workspaceId, fixture.userId, randomUUID(), fixture.sourceId, 'd'.repeat(64), '{}'])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO library_lifecycle_operations(workspace_id,actor_id,operation_id,object_kind,source_id,operation,body_hash,result)
      VALUES($1,$2,$3,'source',$4,'source.rename','bad', '{}')`, [fixture.workspaceId, fixture.userId, randomUUID(), fixture.sourceId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO library_lifecycle_operations(workspace_id,actor_id,operation_id,object_kind,source_id,operation,body_hash,result,expires_at)
      VALUES($1,$2,$3,'source',$4,'source.rename',$5,'{}',now())`, [fixture.workspaceId, fixture.userId, randomUUID(), fixture.sourceId, 'e'.repeat(64)])).rejects.toThrow();
  });
});
