import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { IdSchema } from '@/contracts/primitives';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { hasScope } from '@/features/identity/domain/policy';
import { assertAuthzVersion, withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '@/features/identity/server/access';
import { IdentityError, validate } from '@/features/identity/server/http';
import { readPinnedSource } from '@/features/sources/server/pinned-source';
import {
  AvailabilityHistorySchema,
  AvailabilityVersionSchema,
  CreateAvailabilityVersionSchema,
  CreateWorkResourceSchema,
  PlanExportResourceResolutionSchema,
  UpdateWorkResourceSchema,
  WorkResourceListInputSchema,
  WorkResourceListSchema,
  WorkResourceResultSchema,
  WorkResourceSchema,
  type AvailabilityVersion,
  type CreateAvailabilityVersion,
  type CreateWorkResource,
  type UpdateWorkResource,
  type WorkResource,
} from '../contracts';
import { canonicalAssignments, type OperationalPlanContent } from '../domain/model';

interface ResourceRow {
  id: string; workspace_id: string; display_name: string; kind: WorkResource['kind']; status: WorkResource['status']; membership_id: string | null;
  timezone: string; access_class: WorkResource['accessClass']; notes: string | null; revision: number; current_availability_version_id: string | null;
  created_by: string; created_at: Date; updated_at: Date;
}
interface ResourceVersionRow extends ResourceRow { resource_id: string }
interface AvailabilityRow {
  id: string; workspace_id: string; resource_id: string; revision: number; timezone: string; effective_from: string | Date; effective_to: string | Date | null;
  source_refs: unknown; verified_at: Date | null; note: string | null; created_by: string; created_at: Date;
}
interface IntervalRow { availability_version_id: string; weekday?: number; date?: string | Date; ordinal: number; start_minute: number; end_minute: number; label?: string | null }

const fail = (key: string, code: ConstructorParameters<typeof IdentityError>[0] = 'CONFLICT') => new IdentityError(code, `operations.errors.${key}`);
const hash = (value: unknown) => hashJson(JSON.parse(JSON.stringify(value)) as JsonValue);
const viewer = (access: WorkspaceAccess) => ({ userId: access.userId, workspaceId: access.workspace.id, authzVersion: access.workspace.authz_version });
const canRead = (access: WorkspaceAccess, accessClass: string) => accessClass !== 'confidential' || hasScope({ ...access.membership, projectScopes: access.projectScopes, confidential: true }, 'read');
const calendar = (value: string | Date) => typeof value === 'string' ? value.slice(0, 10) : `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

function resourceDto(row: ResourceRow): WorkResource {
  return WorkResourceSchema.parse({
    id: row.id, workspaceId: row.workspace_id, displayName: row.display_name, kind: row.kind, status: row.status,
    membershipId: row.membership_id, timezone: row.timezone, accessClass: row.access_class,
    ...(row.notes === null ? {} : { notes: row.notes }), revision: row.revision,
    currentAvailabilityVersionId: row.current_availability_version_id,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  });
}

async function ensureTimezone(timezone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
  catch { throw fail('timezone', 'VALIDATION_FAILED'); }
}

async function ensureMembership(tx: PoolClient, workspaceId: string, membershipId: string | null | undefined) {
  if (!membershipId) return;
  const found = await tx.query('SELECT id FROM identity_memberships WHERE workspace_id=$1 AND id=$2 AND state=\'active\' FOR SHARE', [workspaceId, membershipId]);
  if (!found.rowCount) throw fail('membershipUnavailable', 'NOT_FOUND');
}

async function lockResource(tx: PoolClient, access: WorkspaceAccess, id: string): Promise<ResourceRow> {
  const row = (await tx.query<ResourceRow>('SELECT * FROM work_resources WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [access.workspace.id, validate(IdSchema, id)])).rows[0];
  if (!row || !canRead(access, row.access_class)) throw fail('resourceNotFound', 'NOT_FOUND');
  return row;
}

async function insertResourceVersion(tx: PoolClient, row: ResourceRow, actorId: string) {
  await tx.query(`INSERT INTO work_resource_versions(id,workspace_id,resource_id,revision,display_name,kind,status,current_availability_version_id,membership_id,timezone,access_class,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [randomUUID(), row.workspace_id, row.id, row.revision, row.display_name, row.kind, row.status, row.current_availability_version_id, row.membership_id, row.timezone, row.access_class, row.notes, actorId]);
}

async function idempotent<T>(tx: PoolClient, access: WorkspaceAccess, operationId: string, kind: string, body: unknown, effect: () => Promise<T>): Promise<T> {
  validate(IdSchema, operationId);
  const bodyHash = hash(body);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`operations:${access.workspace.id}:${access.userId}:${operationId}`]);
  const previous = (await tx.query<{ kind: string; body_hash: string; result: unknown }>('SELECT kind,body_hash,result FROM operations_idempotency WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [access.workspace.id, access.userId, operationId])).rows[0];
  if (previous) {
    if (previous.kind !== kind || previous.body_hash !== bodyHash) throw fail('idempotencyConflict');
    return structuredClone(previous.result) as T;
  }
  const result = await effect();
  await tx.query("INSERT INTO operations_idempotency(workspace_id,actor_id,operation_id,kind,body_hash,result,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days')", [access.workspace.id, access.userId, operationId, kind, bodyHash, JSON.stringify(result)]);
  return result;
}

function encodeCursor(row: ResourceRow) { return Buffer.from(JSON.stringify([row.updated_at.toISOString(), row.id])).toString('base64url'); }
function decodeCursor(value?: string): [string, string] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return z.tuple([z.iso.datetime(), IdSchema]).parse(parsed);
  } catch { throw fail('cursor', 'VALIDATION_FAILED'); }
}

async function availabilityDto(tx: PoolClient, row: AvailabilityRow): Promise<AvailabilityVersion> {
  const weekly = await tx.query<IntervalRow>('SELECT availability_version_id,weekday,ordinal,start_minute,end_minute FROM availability_week_intervals WHERE availability_version_id=$1 ORDER BY weekday,ordinal', [row.id]);
  const exceptions = await tx.query<IntervalRow>('SELECT availability_version_id,date,label,0 AS ordinal,0 AS start_minute,1 AS end_minute FROM availability_exceptions WHERE availability_version_id=$1 ORDER BY date', [row.id]);
  const exceptionIntervals = await tx.query<IntervalRow>('SELECT availability_version_id,date,ordinal,start_minute,end_minute FROM availability_exception_intervals WHERE availability_version_id=$1 ORDER BY date,ordinal', [row.id]);
  const weekdays = new Map<number, { startMinute: number; endMinute: number }[]>();
  for (const interval of weekly.rows) weekdays.set(interval.weekday!, [...(weekdays.get(interval.weekday!) ?? []), { startMinute: interval.start_minute, endMinute: interval.end_minute }]);
  const byDate = new Map<string, { startMinute: number; endMinute: number }[]>();
  for (const interval of exceptionIntervals.rows) { const date = calendar(interval.date!); byDate.set(date, [...(byDate.get(date) ?? []), { startMinute: interval.start_minute, endMinute: interval.end_minute }]); }
  return AvailabilityVersionSchema.parse({
    id: row.id, workspaceId: row.workspace_id, resourceId: row.resource_id, revision: row.revision, timezone: row.timezone,
    effectiveFrom: calendar(row.effective_from), effectiveTo: row.effective_to === null ? null : calendar(row.effective_to),
    weekdays: [...weekdays].map(([weekday, intervals]) => ({ weekday, intervals })),
    exceptions: exceptions.rows.map((item) => ({ date: calendar(item.date!), intervals: byDate.get(calendar(item.date!)) ?? [], ...(item.label ? { label: item.label } : {}) })),
    sourceRefs: row.source_refs, verifiedAt: row.verified_at?.toISOString() ?? null, ...(row.note ? { note: row.note } : {}),
    createdBy: row.created_by, createdAt: row.created_at.toISOString(),
  });
}

export function createOperationsService(pool: Pool) {
  async function list(principal: IdentityPrincipal, raw: unknown) {
    const input = WorkResourceListInputSchema.parse(raw), cursor = decodeCursor(input.after);
    return withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' }, async (tx, access) => {
      const confidential = hasScope({ ...access.membership, projectScopes: access.projectScopes, confidential: true }, 'read');
      const values: unknown[] = [input.workspaceId, input.status, `%${input.query.replace(/[\\%_]/g, '\\$&')}%`, input.limit + 1, confidential];
      const kinds = input.kinds.length ? input.kinds : ['person', 'equipment', 'place', 'other']; values.push(kinds);
      if (cursor) values.push(cursor[0], cursor[1]);
      const rows = (await tx.query<ResourceRow>(`SELECT * FROM work_resources WHERE workspace_id=$1 AND status=$2 AND display_name ILIKE $3 ESCAPE '\\'
        AND ($5 OR access_class <> 'confidential') AND kind=ANY($6::text[]) ${cursor ? 'AND (updated_at,id)<($7::timestamptz,$8::uuid)' : ''}
        ORDER BY updated_at DESC,id DESC LIMIT $4`, values)).rows;
      const page = rows.slice(0, input.limit);
      return WorkResourceListSchema.parse({ viewer: viewer(access), resources: page.map(resourceDto), nextAfter: rows.length > input.limit ? encodeCursor(page.at(-1)!) : null });
    });
  }
  async function read(principal: IdentityPrincipal, workspaceId: string, id: string) {
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'read' }, async (tx, access) => WorkResourceResultSchema.parse({ viewer: viewer(access), resource: resourceDto(await lockResource(tx, access, id)) }));
  }
  async function create(principal: IdentityPrincipal, operationId: string, raw: CreateWorkResource) {
    const input = CreateWorkResourceSchema.parse(raw); await ensureTimezone(input.timezone);
    return withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'edit' }, async (tx, access) => idempotent(tx, access, operationId, 'resource.create', input, async () => {
      assertAuthzVersion(access, input.expectedAuthzVersion); await ensureMembership(tx, input.workspaceId, input.membershipId);
      if (!canRead(access, input.accessClass)) throw fail('confidential', 'FORBIDDEN');
      const id = randomUUID();
      const row = (await tx.query<ResourceRow>(`INSERT INTO work_resources(id,workspace_id,display_name,kind,membership_id,timezone,access_class,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [id, input.workspaceId, input.displayName, input.kind, input.membershipId ?? null, input.timezone, input.accessClass, input.notes ?? null, access.userId])).rows[0]!;
      await insertResourceVersion(tx, row, access.userId);
      return WorkResourceResultSchema.parse({ viewer: viewer(access), resource: resourceDto(row) });
    }));
  }
  async function update(principal: IdentityPrincipal, operationId: string, id: string, raw: UpdateWorkResource) {
    const input = UpdateWorkResourceSchema.parse(raw); if (input.timezone) await ensureTimezone(input.timezone);
    return withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'edit' }, async (tx, access) => idempotent(tx, access, operationId, 'resource.update', { id, ...input }, async () => {
      assertAuthzVersion(access, input.expectedAuthzVersion);
      const before = await lockResource(tx, access, id); if (before.revision !== input.expectedRevision) throw fail('resourceChanged');
      await ensureMembership(tx, input.workspaceId, input.membershipId);
      if (input.accessClass && !canRead(access, input.accessClass)) throw fail('confidential', 'FORBIDDEN');
      const next = (await tx.query<ResourceRow>(`UPDATE work_resources SET display_name=COALESCE($3,display_name),kind=COALESCE($4,kind),membership_id=CASE WHEN $5 THEN $6 ELSE membership_id END,
        timezone=COALESCE($7,timezone),access_class=COALESCE($8,access_class),notes=CASE WHEN $9 THEN $10 ELSE notes END,status=COALESCE($11,status),revision=revision+1,updated_at=now()
        WHERE workspace_id=$1 AND id=$2 RETURNING *`, [input.workspaceId, id, input.displayName ?? null, input.kind ?? null, Object.hasOwn(input, 'membershipId'), input.membershipId ?? null, input.timezone ?? null, input.accessClass ?? null, Object.hasOwn(input, 'notes'), input.notes ?? null, input.status ?? null])).rows[0]!;
      await insertResourceVersion(tx, next, access.userId);
      return WorkResourceResultSchema.parse({ viewer: viewer(access), resource: resourceDto(next) });
    }));
  }
  async function createAvailability(principal: IdentityPrincipal, operationId: string, resourceId: string, raw: CreateAvailabilityVersion) {
    const input = CreateAvailabilityVersionSchema.parse(raw); await ensureTimezone(input.timezone);
    // Reuse the immutable version refinement for interval overlap and effective ranges.
    AvailabilityVersionSchema.parse({ id: randomUUID(), workspaceId: input.workspaceId, resourceId, revision: 1, timezone: input.timezone,
      effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, weekdays: input.weekdays, exceptions: input.exceptions,
      sourceRefs: input.sourceRefs, verifiedAt: input.verifiedAt, ...(input.note ? { note: input.note } : {}), createdBy: principal.userId, createdAt: new Date().toISOString() });
    return withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'edit' }, async (tx, access) => idempotent(tx, access, operationId, 'availability.create', { resourceId, ...input }, async () => {
      assertAuthzVersion(access, input.expectedAuthzVersion);
      const resource = await lockResource(tx, access, resourceId); if (resource.revision !== input.expectedResourceRevision) throw fail('resourceChanged');
      for (const sourceRef of input.sourceRefs) {
        const pinned = await readPinnedSource(tx, access, { sourceId: sourceRef.sourceId, sourceVersionId: sourceRef.sourceVersionId });
        if (pinned.sourceRef.revision !== sourceRef.revision) throw fail('sourceChanged');
      }
      const revision = Number((await tx.query<{ revision: number }>('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM availability_versions WHERE workspace_id=$1 AND resource_id=$2', [input.workspaceId, resourceId])).rows[0]!.revision);
      const id = randomUUID();
      const row = (await tx.query<AvailabilityRow>(`INSERT INTO availability_versions(id,workspace_id,resource_id,revision,timezone,effective_from,effective_to,source_refs,verified_at,note,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [id, input.workspaceId, resourceId, revision, input.timezone, input.effectiveFrom, input.effectiveTo, JSON.stringify(input.sourceRefs), input.verifiedAt, input.note ?? null, access.userId])).rows[0]!;
      for (const day of input.weekdays) for (let ordinal = 0; ordinal < day.intervals.length; ordinal += 1) {
        const interval = day.intervals[ordinal]!; await tx.query('INSERT INTO availability_week_intervals(availability_version_id,weekday,ordinal,start_minute,end_minute) VALUES($1,$2,$3,$4,$5)', [id, day.weekday, ordinal, interval.startMinute, interval.endMinute]);
      }
      for (const exception of input.exceptions) {
        await tx.query('INSERT INTO availability_exceptions(availability_version_id,date,label) VALUES($1,$2,$3)', [id, exception.date, exception.label ?? null]);
        for (let ordinal = 0; ordinal < exception.intervals.length; ordinal += 1) { const interval = exception.intervals[ordinal]!; await tx.query('INSERT INTO availability_exception_intervals(availability_version_id,date,ordinal,start_minute,end_minute) VALUES($1,$2,$3,$4,$5)', [id, exception.date, ordinal, interval.startMinute, interval.endMinute]); }
      }
      const nextResource = (await tx.query<ResourceRow>('UPDATE work_resources SET current_availability_version_id=$3,revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *', [input.workspaceId, resourceId, id])).rows[0]!;
      await insertResourceVersion(tx, nextResource, access.userId);
      return { viewer: viewer(access), resource: resourceDto(nextResource), version: await availabilityDto(tx, row) };
    }));
  }
  async function availabilityHistory(principal: IdentityPrincipal, workspaceId: string, resourceId: string, beforeRevision?: number) {
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'read' }, async (tx, access) => {
      const resource = await lockResource(tx, access, resourceId), before = beforeRevision ?? 2_147_483_647;
      const rows = (await tx.query<AvailabilityRow>('SELECT * FROM availability_versions WHERE workspace_id=$1 AND resource_id=$2 AND revision<$3 ORDER BY revision DESC LIMIT 101', [workspaceId, resourceId, before])).rows;
      const page = rows.slice(0, 100), versions: AvailabilityVersion[] = [];
      for (const row of page) {
        const version = await availabilityDto(tx, row);
        for (const sourceRef of version.sourceRefs) {
          const pinned = await readPinnedSource(tx, access, { sourceId: sourceRef.sourceId, sourceVersionId: sourceRef.sourceVersionId });
          if (pinned.sourceRef.revision !== sourceRef.revision) throw fail('sourceChanged');
        }
        versions.push(version);
      }
      return AvailabilityHistorySchema.parse({ viewer: viewer(access), resource: resourceDto(resource), versions, nextBeforeRevision: rows.length > 100 ? page.at(-1)!.revision : null });
    });
  }
  return { list, read, create, update, createAvailability, availabilityHistory };
}

export type OperationsService = ReturnType<typeof createOperationsService>;

/**
 * Resolve only immutable, contact-free labels for a fixed export manifest.
 * The caller already owns an authorized transaction and must freeze this result.
 */
export async function resolveExportResourcesInTransaction(tx: PoolClient, access: WorkspaceAccess, plan: OperationalPlanContent) {
  const requested = new Map<string, { resourceId: string; resourceRevision?: number; availabilityVersionId?: string }>();
  for (const entry of plan.entries) for (const assignment of canonicalAssignments(entry)) {
    const key = `${assignment.resourceId}:${assignment.resourceRevision ?? 'current'}:${assignment.availabilityVersionId ?? ''}`;
    requested.set(key, assignment);
  }
  if (requested.size > 2000) throw fail('tooManyResources', 'VALIDATION_FAILED');
  const resources: unknown[] = [], warnings: { code: 'resource-name-not-pinned' | 'availability-version-unavailable'; resourceId: string }[] = [];
  await authorizeExportResourcesInTransaction(tx, access, [...requested.values()]);
  for (const assignment of requested.values()) {
    let row: ResourceVersionRow | undefined;
    if (assignment.resourceRevision !== undefined) row = (await tx.query<ResourceVersionRow>('SELECT *,resource_id FROM work_resource_versions WHERE workspace_id=$1 AND resource_id=$2 AND revision=$3', [access.workspace.id, assignment.resourceId, assignment.resourceRevision])).rows[0];
    else {
      const current = (await tx.query<ResourceRow>('SELECT * FROM work_resources WHERE workspace_id=$1 AND id=$2', [access.workspace.id, assignment.resourceId])).rows[0];
      if (current) row = { ...current, resource_id: current.id };
      warnings.push({ code: 'resource-name-not-pinned', resourceId: assignment.resourceId });
    }
    if (!row) throw fail('resourceNotFound', 'NOT_FOUND');
    let availability: unknown;
    if (assignment.availabilityVersionId) {
      const version = (await tx.query<AvailabilityRow>('SELECT * FROM availability_versions WHERE workspace_id=$1 AND id=$2 AND resource_id=$3', [access.workspace.id, assignment.availabilityVersionId, assignment.resourceId])).rows[0];
      if (version) availability = { id: version.id, revision: version.revision, timezone: version.timezone, effectiveFrom: calendar(version.effective_from), effectiveTo: version.effective_to === null ? null : calendar(version.effective_to), verifiedAt: version.verified_at?.toISOString() ?? null };
      else warnings.push({ code: 'availability-version-unavailable', resourceId: assignment.resourceId });
    }
    resources.push({ resourceId: assignment.resourceId, resourceRevision: row.revision, displayName: row.display_name, kind: row.kind, timezone: row.timezone, ...(availability ? { availability } : {}) });
  }
  return PlanExportResourceResolutionSchema.parse({ resources, warnings });
}

/** Current ACL is authoritative even when an export contains a historical label. */
export async function authorizeExportResourcesInTransaction(tx: PoolClient, access: WorkspaceAccess, resources: readonly { resourceId: string }[]) {
  const ids = [...new Set(resources.map((resource) => validate(IdSchema, resource.resourceId)))];
  if (ids.length > 2000) throw fail('tooManyResources', 'VALIDATION_FAILED');
  if (!ids.length) return;
  const rows = (await tx.query<Pick<ResourceRow, 'id' | 'access_class'>>('SELECT id,access_class FROM work_resources WHERE workspace_id=$1 AND id=ANY($2::uuid[]) FOR SHARE', [access.workspace.id, ids])).rows;
  const visible = new Set(rows.filter((row) => canRead(access, row.access_class)).map((row) => row.id));
  if (visible.size !== ids.length || ids.some((id) => !visible.has(id))) throw fail('resourceNotFound', 'NOT_FOUND');
}

export const resolvePlanExportResources = resolveExportResourcesInTransaction;
export const authorizePlanExportResources = authorizeExportResourcesInTransaction;

/** Load only the pinned availability versions referenced by the plan. */
export async function loadPlanCapacityContextInTransaction(tx: PoolClient, access: WorkspaceAccess, plan: OperationalPlanContent) {
  const assignments = plan.entries.flatMap((entry) => canonicalAssignments(entry));
  await authorizeExportResourcesInTransaction(tx, access, assignments);
  const resourceIds = [...new Set(assignments.map((assignment) => assignment.resourceId))];
  const rows = resourceIds.length
    ? (await tx.query<ResourceRow>('SELECT * FROM work_resources WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [access.workspace.id, resourceIds])).rows
    : [];
  const availabilityIds = [...new Set(assignments.flatMap((assignment) => assignment.availabilityVersionId ? [assignment.availabilityVersionId] : []))];
  const versionRows = availabilityIds.length
    ? (await tx.query<AvailabilityRow>('SELECT * FROM availability_versions WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [access.workspace.id, availabilityIds])).rows
    : [];
  const availabilityVersions: AvailabilityVersion[] = [];
  for (const row of versionRows) availabilityVersions.push(await availabilityDto(tx, row));
  return { resources: rows.map(resourceDto), availabilityVersions };
}

