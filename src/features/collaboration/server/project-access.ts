import type { Pool } from 'pg';
import type { z } from 'zod';
import type { AccessScope, MembershipRole } from '../../identity/contracts';
import { hasScope } from '../../identity/domain/policy';
import { withWorkspaceAccess, type IdentityPrincipal, type SessionPrincipal } from '../../identity/server/access';
import { createProjectCore } from '../../workspace/server/project-core';
import {
  ProjectAccessListSchema,
  ReadProjectAccessSchema,
  SetProjectAccessSchema,
  type ProjectAccessList,
} from '../contracts';

interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  role: MembershipRole;
  membership_scopes: AccessScope[];
  project_scopes: AccessScope[] | null;
}

function effectiveScopes(row: MemberRow): AccessScope[] {
  if (row.role === 'owner') return row.membership_scopes;
  if (!row.project_scopes) return [];
  const project = new Set(row.project_scopes);
  return row.membership_scopes.filter((scope) => project.has(scope));
}

export function createProjectAccessService(pool: Pool) {
  const projects = createProjectCore(pool);

  async function list(principal: IdentityPrincipal, input: z.input<typeof ReadProjectAccessSchema>): Promise<ProjectAccessList> {
    const body = ReadProjectAccessSchema.parse(input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'read' }, async (transaction, access) => {
      const canManage = hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'manage-members');
      const rows = (await transaction.query<MemberRow>(`
        SELECT m.user_id,u.name,u.email,m.role,m.scopes AS membership_scopes,g.scopes AS project_scopes
        FROM identity_memberships m
        JOIN identity_users u ON u.id=m.user_id AND u.deletion_requested_at IS NULL
        LEFT JOIN identity_project_grants g
          ON g.workspace_id=m.workspace_id AND g.project_id=$2 AND g.user_id=m.user_id
        WHERE m.workspace_id=$1 AND m.state='active'
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,u.name,u.id`,
      [body.workspaceId, body.projectId])).rows;
      return ProjectAccessListSchema.parse({
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        members: rows.map((row) => ({
          userId: row.user_id,
          name: row.name,
          email: row.email,
          membershipRole: row.role,
          membershipScopes: row.membership_scopes,
          projectScopes: row.role === 'owner' ? row.membership_scopes : row.project_scopes,
          effectiveScopes: effectiveScopes(row),
          canManage: canManage && row.role !== 'owner' && row.user_id !== access.userId,
        })),
        authzVersion: access.workspace.authz_version,
        canManage,
      });
    });
  }

  async function set(principal: SessionPrincipal, operationId: string, input: z.input<typeof SetProjectAccessSchema>) {
    const body = SetProjectAccessSchema.parse(input);
    return projects.setGrant(principal, operationId, body);
  }

  return { list, set };
}

export type ProjectAccessService = ReturnType<typeof createProjectAccessService>;
