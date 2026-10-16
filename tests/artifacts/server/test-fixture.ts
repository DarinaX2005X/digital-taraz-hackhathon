import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { scopesForRole } from '../../../src/features/identity/domain/policy';
import { identityTransaction, type SessionPrincipal } from '../../../src/features/identity/server/access';
import { createProjectCore } from '../../../src/features/workspace/server/project-core';
import { createArtifactService } from '../../../src/features/artifacts/server/service';
import type { ArtifactContent } from '../../../src/features/artifacts/contracts';

export function artifactTestPool(): Pool {
  if (!/^[a-f0-9]{32}$/.test(process.env.TIRLIK_TEST_NAMESPACE ?? '')) throw new Error('ISOLATED_TEST_NAMESPACE_REQUIRED');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/tirlik' || process.env.OPENROUTER_API_KEY || process.env.BREVO_API_KEY || process.env.SMTP_PASSWORD) throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
  return new Pool({ connectionString: url.href, application_name: 'artifact-service-integration', max: 8 });
}
export const testDocument = (first = 'Original first condition', second = 'Manual delivery wording'): ArtifactContent => ({ kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: first }] }, { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: second }] }] } });
export async function currentArtifactAuthz(pool: Pool, workspaceId: string): Promise<number> { return (await pool.query<{ authz_version: number }>('SELECT authz_version FROM identity_workspaces WHERE id=$1', [workspaceId])).rows[0]!.authz_version; }
export async function artifactFixture(pool: Pool) {
  const owner: SessionPrincipal = { kind: 'session', userId: randomUUID(), sessionId: randomUUID() }, member: SessionPrincipal = { kind: 'session', userId: randomUUID(), sessionId: randomUUID() }, workspaceId = randomUUID();
  await identityTransaction(pool, async (tx) => {
    for (const principal of [owner, member]) {
      await tx.query('INSERT INTO identity_users(id,name,email,email_verified) VALUES($1,$2,$3,false)', [principal.userId, 'Synthetic artifact reviewer', `${principal.userId}@example.test`]);
      await tx.query("INSERT INTO identity_sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [principal.sessionId, principal.userId, randomUUID()]);
    }
    await tx.query('INSERT INTO identity_workspaces(id,name,created_by) VALUES($1,$2,$3)', [workspaceId, 'Synthetic artifact workspace', owner.userId]);
    await tx.query("INSERT INTO identity_memberships(id,workspace_id,user_id,role,scopes) VALUES($1,$2,$3,'owner',$4),($5,$2,$6,'editor',$7)", [randomUUID(), workspaceId, owner.userId, scopesForRole('owner'), randomUUID(), member.userId, scopesForRole('editor')]);
  });
  const projects = createProjectCore(pool), service = createArtifactService(pool);
  const created = await projects.create(owner, randomUUID(), { workspaceId, title: 'Synthetic business work', expectedAuthzVersion: 1 });
  const create = async (content = testDocument(), title = 'Working conditions') => service.create(owner, randomUUID(), { workspaceId, projectId: created.project.id, expectedAuthzVersion: await currentArtifactAuthz(pool, workspaceId), title, content });
  const read = (artifactId: string, principal = owner) => service.read(principal, { workspaceId, artifactId });
  return { owner, member, workspaceId, projectId: created.project.id, projects, service, create, read };
}
