import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopesForRole } from '../../../src/features/identity/domain/policy';

let pool: Pool;
beforeAll(() => {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/tirlik') throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
  pool = new Pool({ connectionString: url.href });
});
afterAll(async () => { await pool?.end(); });

async function ownedWorkspace(client: PoolClient) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await client.query('INSERT INTO identity_users(id,name,email,email_verified) VALUES($1,$2,$3,true)', [userId, 'Synthetic owner', `${userId}@example.test`]);
  await client.query('INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,$2,$3)', [workspaceId, 'Synthetic workspace', userId]);
  await client.query('INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,$4,$5)', [randomUUID(), workspaceId, userId, 'owner', scopesForRole('owner')]);
  return { userId, workspaceId };
}

describe('workspace database invariants', () => {
  it('accepts atomic workspace/owner creation but rejects losing its last owner', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { workspaceId } = await ownedWorkspace(client);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await expect(client.query("UPDATE identity_memberships SET state='revoked',revoked_at=now() WHERE workspace_id=$1", [workspaceId])).rejects.toMatchObject({ code: '23514', constraint: 'identity_workspace_owner_required' });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  it('permits immediate access closure only with an explicit retained deletion tombstone', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { userId, workspaceId } = await ownedWorkspace(client);
      await client.query("UPDATE identity_workspaces SET status='deletion-pending',deletion_requested_at=now(),cleanup_after=now()+interval '30 days' WHERE id=$1", [workspaceId]);
      await client.query("UPDATE identity_memberships SET state='revoked',revoked_at=now() WHERE workspace_id=$1", [workspaceId]);
      await client.query('INSERT INTO identity_deletion_requests(id,user_id,cleanup_after) VALUES($1,$2,now()+interval \'30 days\')', [randomUUID(), userId]);
      await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).resolves.toBeDefined();
      expect((await client.query('SELECT status,cleanup_after IS NOT NULL AS retained FROM identity_workspaces WHERE id=$1', [workspaceId])).rows[0]).toEqual({ status: 'deletion-pending', retained: true });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  it('rejects project grants for users without membership and incomplete owner grants', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { workspaceId } = await ownedWorkspace(client);
      await client.query('SAVEPOINT invalid_grant');
      await expect(client.query("INSERT INTO identity_project_grants(workspace_id,project_id,user_id,scopes) VALUES($1,$2,$3,ARRAY['read'])", [workspaceId, randomUUID(), randomUUID()])).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_grant');
      await expect(client.query("UPDATE identity_memberships SET scopes=ARRAY['read'] WHERE workspace_id=$1", [workspaceId])).rejects.toMatchObject({ code: '23514' });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
});
