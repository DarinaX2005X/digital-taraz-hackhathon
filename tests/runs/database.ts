import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { scopesForRole } from '../../src/features/identity/domain/policy';

export function isolatedRunPool() {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/tirlik') throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
  return new Pool({ connectionString: url.href, max: 16 });
}

export async function syntheticWorkspace(transaction: PoolClient) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  await transaction.query('INSERT INTO identity_users(id,name,email,email_verified) VALUES($1,$2,$3,true)', [userId, 'Synthetic runtime owner', `${userId}@example.test`]);
  await transaction.query('INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,$2,$3)', [workspaceId, 'Synthetic runtime workspace', userId]);
  await transaction.query('INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,$4,$5)', [randomUUID(), workspaceId, userId, 'owner', scopesForRole('owner')]);
  await transaction.query("INSERT INTO identity_sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [sessionId, userId, randomUUID()]);
  return { userId, workspaceId, sessionId };
}

export async function syntheticRun(transaction: PoolClient) {
  const scope = await syntheticWorkspace(transaction);
  const runId = randomUUID();
  const stepId = randomUUID();
  await transaction.query(`INSERT INTO agent_runs(id,workspace_id,created_by,authz_version,capability_id,capability_version,required_scope,confidential,goal,locale,input_refs,request_key_hash,input_hash)
    VALUES($1,$2,$3,1,'runtime.fixture',1,'edit',false,'Synthetic receipt transaction','en','[]',$4,$4)`, [runId, scope.workspaceId, scope.userId, 'a'.repeat(64)]);
  await transaction.query("INSERT INTO agent_run_steps(id,run_id,ordinal,action,tool_name,tool_version) VALUES($1,$2,1,'calculate','fixture.multiply',1)", [stepId, runId]);
  return { ...scope, runId, stepId };
}
