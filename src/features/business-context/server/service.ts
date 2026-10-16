import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import {
  BusinessContextReadSchema,
  ReadBusinessContextInputSchema,
  type BusinessContextItem,
  type BusinessContextRead,
  type ReadBusinessContextInput,
  type WorkExecutionContext,
} from '../../../contracts/business-work';
import { hasScope } from '../../identity/domain/policy';
import {
  lockProjectAccess,
  withWorkspaceAccess,
  type IdentityPrincipal,
  type SessionPrincipal,
  type WorkspaceAccess,
} from '../../identity/server/access';
import { IdentityError } from '../../identity/server/http';
import {
  BusinessContextDetailSchema,
  BusinessContextListSchema,
  BusinessContextVersionSchema,
  CreateBusinessContextSchema,
  ListBusinessContextsSchema,
  SetContextStatusSchema,
  UpdateBusinessContextSchema,
  UseBusinessContextSchema,
  UsedBusinessContextSchema,
  type BusinessContextDetail,
  type BusinessContextSummary,
  type BusinessContextVersion,
} from '../contracts';

interface ContextRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  scope: 'workspace' | 'project';
  owner_id: string;
  title: string;
  current_revision: number;
  status: 'active' | 'archived';
  created_at: Date;
  updated_at: Date;
}
interface VersionRow {
  id: string;
  workspace_id: string;
  context_id: string;
  revision: number;
  scope: 'workspace' | 'project';
  project_id: string | null;
  owner_id: string;
  title: string;
  items: unknown;
  brand_kit: unknown;
  reason: string;
  created_by: string;
  created_at: Date;
}

const contextColumns = 'id,workspace_id,project_id,scope,owner_id,title,current_revision,status,created_at,updated_at';
const versionColumns = 'id,workspace_id,context_id,revision,scope,project_id,owner_id,title,items,brand_kit,reason,created_by,created_at';
const bodyHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function versionDto(row: VersionRow): BusinessContextVersion {
  return BusinessContextVersionSchema.parse({
    id: row.id,
    contextId: row.context_id,
    revision: row.revision,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    scope: row.scope,
    ownerId: row.owner_id,
    title: row.title,
    items: row.items,
    brandKit: row.brand_kit,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  });
}

function permissions(access: WorkspaceAccess, row: ContextRow) {
  const subject = { ...access.membership, projectScopes: access.projectScopes };
  const hasEdit = hasScope(subject, 'edit');
  const edit = row.status === 'active' && hasEdit;
  const confirm = row.status === 'active' && hasScope(subject, 'approve');
  return { read: true as const, edit, confirm, archive: hasEdit && (row.owner_id === access.userId || access.membership.role === 'owner') };
}

function summaryDto(row: ContextRow, access: WorkspaceAccess): BusinessContextSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    scope: row.scope,
    ownerId: row.owner_id,
    title: row.title,
    currentRevision: row.current_revision,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    permissions: permissions(access, row),
  };
}

async function contextAccess(transaction: PoolClient, access: WorkspaceAccess, contextId: string, scope: 'read' | 'edit' | 'approve', lock = false) {
  const row = (await transaction.query<ContextRow>(`SELECT ${contextColumns} FROM business_contexts WHERE workspace_id=$1 AND id=$2 ${lock ? 'FOR UPDATE' : 'FOR SHARE'}`, [access.workspace.id, contextId])).rows[0];
  if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  const resolved = row.project_id ? await lockProjectAccess(transaction, access, { projectId: row.project_id, scope }) : access;
  if (!hasScope({ ...resolved.membership, projectScopes: resolved.projectScopes }, scope)) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
  return { row, access: resolved };
}

async function assertItemOwners(transaction: PoolClient, workspaceId: string, items: readonly BusinessContextItem[]) {
  const owners = [...new Set(items.map((item) => item.ownerId))];
  if (!owners.length) return;
  const count = (await transaction.query<{ count: number }>("SELECT count(*)::int AS count FROM identity_memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND state='active'", [workspaceId, owners])).rows[0]?.count ?? 0;
  if (count !== owners.length) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
}

async function readVersion(transaction: PoolClient, workspaceId: string, contextId: string, revision: number) {
  const row = (await transaction.query<VersionRow>(`SELECT ${versionColumns} FROM business_context_versions WHERE workspace_id=$1 AND context_id=$2 AND revision=$3`, [workspaceId, contextId, revision])).rows[0];
  if (!row) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
  return versionDto(row);
}

async function replay<T>(transaction: PoolClient, workspaceId: string, actorId: string, operationId: string, kind: string, hash: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const saved = (await transaction.query<{ kind: string; body_hash: string; result: unknown }>('SELECT kind,body_hash,result FROM business_continuity_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [workspaceId, actorId, operationId])).rows[0];
  if (!saved) return undefined;
  if (saved.kind !== kind || saved.body_hash !== hash) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
  return schema.parse(saved.result);
}

async function remember(transaction: PoolClient, workspaceId: string, actorId: string, operationId: string, kind: string, hash: string, result: unknown) {
  await transaction.query('INSERT INTO business_continuity_operations(workspace_id,actor_id,operation_id,kind,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [workspaceId, actorId, operationId, kind, hash, JSON.stringify(result)]);
}

export function createBusinessContextService(pool: Pool) {
  async function list(principal: IdentityPrincipal, input: z.input<typeof ListBusinessContextsSchema>) {
    const body = ListBusinessContextsSchema.parse(input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (transaction, access) => {
      const search = `%${body.query.replace(/[\\%_]/g, '\\$&')}%`;
      const rows = (await transaction.query<ContextRow>(`SELECT ${contextColumns} FROM business_contexts c
        WHERE c.workspace_id=$1 AND c.status=$2
          AND (($3::uuid IS NULL AND c.scope='workspace') OR ($3::uuid IS NOT NULL AND (c.scope='workspace' OR c.project_id=$3)))
          AND ($4='' OR c.title ILIKE $5 ESCAPE '\\')
          AND (c.scope='workspace' OR $6::boolean OR EXISTS(
            SELECT 1 FROM identity_project_grants g WHERE g.workspace_id=c.workspace_id AND g.project_id=c.project_id AND g.user_id=$7 AND 'read'=ANY(g.scopes)
          ))
        ORDER BY c.updated_at DESC,c.id DESC LIMIT $8`, [body.workspaceId, body.status, body.projectId ?? null, body.query, search, access.membership.role === 'owner', access.userId, body.limit])).rows;
      const contexts: BusinessContextSummary[] = [];
      for (const row of rows) {
        const itemAccess = row.project_id ? await lockProjectAccess(transaction, access, { projectId: row.project_id, scope: 'read' }) : access;
        contexts.push(summaryDto(row, itemAccess));
      }
      return BusinessContextListSchema.parse({ contexts, authzVersion: access.workspace.authz_version });
    });
  }

  async function read(principal: IdentityPrincipal, workspaceId: string, contextId: string, revision?: number): Promise<BusinessContextDetail> {
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'read' }, async (transaction, access) => {
      const secured = await contextAccess(transaction, access, contextId, 'read');
      const version = await readVersion(transaction, workspaceId, contextId, revision ?? secured.row.current_revision);
      return BusinessContextDetailSchema.parse({ context: summaryDto(secured.row, secured.access), version, authzVersion: access.workspace.authz_version });
    });
  }

  async function create(principal: SessionPrincipal, operationId: string, input: z.input<typeof CreateBusinessContextSchema>) {
    const body = CreateBusinessContextSchema.parse(input);
    const hash = bodyHash(body);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion, ...(body.projectId ? { projectId: body.projectId } : {}) }, async (transaction, access) => {
      const existing = await replay(transaction, body.workspaceId, access.userId, operationId, 'context', hash, BusinessContextDetailSchema);
      if (existing) return existing;
      const canConfirm = hasScope({ ...access.membership, projectScopes: access.projectScopes }, 'approve');
      if (!canConfirm && body.items.some((item) => item.confirmed)) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      await assertItemOwners(transaction, body.workspaceId, body.items);
      const id = randomUUID(), versionId = randomUUID();
      const row = (await transaction.query<ContextRow>(`INSERT INTO business_contexts(id,workspace_id,project_id,scope,owner_id,title,current_revision,status)
        VALUES($1,$2,$3,$4,$5,$6,1,'active') RETURNING ${contextColumns}`, [id, body.workspaceId, body.projectId, body.scope, access.userId, body.title])).rows[0]!;
      const versionRow = (await transaction.query<VersionRow>(`INSERT INTO business_context_versions(id,workspace_id,context_id,revision,scope,project_id,owner_id,title,items,brand_kit,reason,created_by)
        VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$6) RETURNING ${versionColumns}`,
      [versionId, body.workspaceId, id, body.scope, body.projectId, access.userId, body.title, JSON.stringify(body.items), JSON.stringify(body.brandKit), body.reason])).rows[0]!;
      const result = BusinessContextDetailSchema.parse({ context: summaryDto(row, access), version: versionDto(versionRow), authzVersion: access.workspace.authz_version });
      await remember(transaction, body.workspaceId, access.userId, operationId, 'context', hash, result);
      return result;
    });
  }

  async function update(principal: SessionPrincipal, operationId: string, contextId: string, input: z.input<typeof UpdateBusinessContextSchema>) {
    const body = UpdateBusinessContextSchema.parse(input);
    const hash = bodyHash([contextId, body]);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (transaction, workspace) => {
      const existing = await replay(transaction, body.workspaceId, workspace.userId, operationId, 'context', hash, BusinessContextDetailSchema);
      if (existing) return existing;
      const secured = await contextAccess(transaction, workspace, contextId, 'edit', true);
      if (secured.row.status !== 'active' || secured.row.current_revision !== body.expectedRevision) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      const current = await readVersion(transaction, body.workspaceId, contextId, secured.row.current_revision);
      const canConfirm = hasScope({ ...secured.access.membership, projectScopes: secured.access.projectScopes }, 'approve');
      const prior = new Map(current.items.map((item) => [item.id, item]));
      if (!canConfirm && body.items.some((item) => item.confirmed && (!prior.get(item.id)?.confirmed || JSON.stringify(prior.get(item.id)) !== JSON.stringify(item)))) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      await assertItemOwners(transaction, body.workspaceId, body.items);
      const next = body.expectedRevision + 1;
      const row = (await transaction.query<ContextRow>(`UPDATE business_contexts SET title=$3,current_revision=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${contextColumns}`, [body.workspaceId, contextId, body.title, next])).rows[0]!;
      const versionRow = (await transaction.query<VersionRow>(`INSERT INTO business_context_versions(id,workspace_id,context_id,revision,scope,project_id,owner_id,title,items,brand_kit,reason,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${versionColumns}`,
      [randomUUID(), body.workspaceId, contextId, next, row.scope, row.project_id, row.owner_id, body.title, JSON.stringify(body.items), JSON.stringify(body.brandKit), body.reason, secured.access.userId])).rows[0]!;
      const result = BusinessContextDetailSchema.parse({ context: summaryDto(row, secured.access), version: versionDto(versionRow), authzVersion: secured.access.workspace.authz_version });
      await remember(transaction, body.workspaceId, secured.access.userId, operationId, 'context', hash, result);
      return result;
    });
  }

  async function setStatus(principal: SessionPrincipal, operationId: string, contextId: string, input: z.input<typeof SetContextStatusSchema>) {
    const body = SetContextStatusSchema.parse(input), hash = bodyHash([contextId, body]);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (transaction, workspace) => {
      const existing = await replay(transaction, body.workspaceId, workspace.userId, operationId, 'context', hash, BusinessContextDetailSchema);
      if (existing) return existing;
      const secured = await contextAccess(transaction, workspace, contextId, 'edit', true);
      if (!permissions(secured.access, secured.row).archive) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
      if (secured.row.current_revision !== body.expectedRevision) throw new IdentityError('CONFLICT', 'identity.errors.conflict');
      const row = body.status === secured.row.status ? secured.row : (await transaction.query<ContextRow>(`UPDATE business_contexts SET status=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${contextColumns}`, [body.workspaceId, contextId, body.status])).rows[0]!;
      const version = await readVersion(transaction, body.workspaceId, contextId, row.current_revision);
      const result = BusinessContextDetailSchema.parse({ context: summaryDto(row, secured.access), version, authzVersion: secured.access.workspace.authz_version });
      await remember(transaction, body.workspaceId, secured.access.userId, operationId, 'context', hash, result);
      return result;
    });
  }

  async function readSelected(principal: IdentityPrincipal, input: ReadBusinessContextInput): Promise<BusinessContextRead> {
    const body = ReadBusinessContextInputSchema.parse(input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (transaction, workspace) => {
      const secured = await contextAccess(transaction, workspace, body.contextId, 'read');
      const version = await readVersion(transaction, body.workspaceId, body.contextId, body.revision);
      const indexed = new Map(version.items.map((item) => [item.id, item]));
      const items = body.itemIds.map((id) => indexed.get(id));
      if (items.some((item) => !item)) throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      return BusinessContextReadSchema.parse({
        ref: { kind: 'business-context', id: body.contextId, revision: body.revision },
        items,
        brandKit: version.brandKit,
        permissions: { read: true, edit: permissions(secured.access, secured.row).edit, confirm: permissions(secured.access, secured.row).confirm },
      });
    });
  }

  async function use(principal: IdentityPrincipal, input: z.input<typeof UseBusinessContextSchema>) {
    const body = UseBusinessContextSchema.parse(input);
    const selected = await readSelected(principal, { workspaceId: body.workspaceId, contextId: body.selection.contextId, revision: body.selection.revision, itemIds: body.selection.itemIds });
    const overrides = new Map(body.overrides.map((override) => [override.itemId, override.value]));
    return UsedBusinessContextSchema.parse({
      selection: body.selection,
      context: selected,
      effectiveItems: selected.items.map((item) => overrides.has(item.id) ? { ...item, value: overrides.get(item.id)! } : item),
      overrideItemIds: [...overrides.keys()],
    });
  }

  return { list, read, create, update, setStatus, readSelected, use };
}

export async function readBusinessContext(input: ReadBusinessContextInput, context: WorkExecutionContext, pool: Pool): Promise<BusinessContextRead> {
  const body = ReadBusinessContextInputSchema.parse(input);
  if (body.workspaceId !== context.workspaceId || !context.allowedBusinessContextRefs) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
  const allowed = context.allowedBusinessContextRefs.find((selection) => selection.contextId === body.contextId && selection.revision === body.revision);
  if (!allowed || body.itemIds.some((id) => !allowed.itemIds.includes(id))) throw new IdentityError('FORBIDDEN', 'identity.errors.forbidden');
  const principal: IdentityPrincipal = { kind: 'job', userId: context.authority.userId, authzVersion: context.expectedAuthzVersion };
  return createBusinessContextService(pool).readSelected(principal, body);
}

export type BusinessContextService = ReturnType<typeof createBusinessContextService>;
