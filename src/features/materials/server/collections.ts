import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { CollectionListInputSchema, CollectionListSchema, CreateCollectionSchema, ResolutionSchema } from '@/contracts/materials';
import { IdSchema } from '@/contracts/primitives';
import { withWorkspaceAccess, lockProjectAccess, type IdentityPrincipal } from '@/features/identity/server/access';
import { validate } from '@/features/identity/server/http';
import { authorizedCollection, canCorrect, collectionDto, decodeCursor, encodeCursor, importDto, literalSearch, materialError, operation, viewer, type CollectionRow, type ImportRowDb } from './support';

export function createCollectionService(pool: Pool) {
  async function create(principal: IdentityPrincipal, key: string, input: unknown) {
    const body = validate(CreateCollectionSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, projectId: body.projectId, confidential: body.accessClass === 'confidential', scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      if ((await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [body.workspaceId, body.projectId])).rows[0]?.status !== 'active') throw materialError('archived');
      return operation(tx, access, key, 'create', body, async () => {
        const row = (await tx.query<CollectionRow>('INSERT INTO material_collections(id,workspace_id,project_id,title,kind,access_class,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [randomUUID(), body.workspaceId, body.projectId, body.title, body.kind, body.accessClass, access.userId])).rows[0]!;
        return { viewer: viewer(access), collection: collectionDto(row), canEdit: true };
      });
    });
  }
  async function read(principal: IdentityPrincipal, workspaceId: string, collectionId: string) {
    validate(IdSchema, workspaceId);
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, collectionId, 'read');
      const imports = (await tx.query<ImportRowDb>('SELECT * FROM material_imports WHERE workspace_id=$1 AND collection_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20', [workspaceId, collectionId])).rows;
      const editable = await canCorrect(tx, access, collection);
      return { viewer: viewer(access), collection: collectionDto(collection), canEdit: editable, imports: imports.map(importDto) };
    });
  }
  async function list(principal: IdentityPrincipal, input: unknown) {
    const body = validate(CollectionListInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      if (body.projectId) await lockProjectAccess(tx, access, { projectId: body.projectId, scope: 'read' });
      const scope = { workspaceId: body.workspaceId, userId: access.userId, authz: access.workspace.authz_version, projectId: body.projectId ?? null, query: body.query, kind: body.kind ?? null, from: body.from ?? null, to: body.to ?? null };
      const cursor = decodeCursor(body.after, scope);
      if (cursor) { validate(IdSchema, cursor.id); validate(z.iso.datetime({ precision: 6 }), cursor.at); }
      const rows = (await tx.query<CollectionRow & { cursor_at: string }>(`SELECT c.*,to_char(c.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM material_collections c JOIN projects p ON p.workspace_id=c.workspace_id AND p.id=c.project_id
        WHERE c.workspace_id=$1 AND p.status<>'trashed' AND ($2::uuid IS NULL OR c.project_id=$2)
          AND ($3::boolean OR EXISTS(SELECT 1 FROM identity_project_grants g WHERE g.workspace_id=c.workspace_id AND g.project_id=c.project_id AND g.user_id=$4 AND 'read'=ANY(g.scopes) AND (c.access_class='internal' OR 'read-confidential'=ANY(g.scopes))))
          AND (c.access_class='internal' OR $5::boolean)
          AND ($6='' OR c.title ILIKE $7 ESCAPE '\\') AND ($8::text IS NULL OR c.kind=$8)
          AND ($9::date IS NULL OR c.updated_at >= $9::date) AND ($10::date IS NULL OR c.updated_at < $10::date+interval '1 day')
          AND ($11::timestamptz IS NULL OR (c.updated_at,c.id)<($11,$12::uuid)) ORDER BY c.updated_at DESC,c.id DESC LIMIT $13`, [body.workspaceId, body.projectId ?? null, access.membership.role === 'owner', access.userId, access.membership.scopes.includes('read-confidential'), body.query, literalSearch(body.query), body.kind ?? null, body.from ?? null, body.to ?? null, cursor?.at ?? null, cursor?.id ?? null, body.limit + 1])).rows;
      const page = rows.slice(0, body.limit), last = page.at(-1);
      return CollectionListSchema.parse({ viewer: viewer(access), collections: page.map((row) => collectionDto({ ...row, mapping: null })), nextCursor: rows.length > body.limit && last ? encodeCursor(scope, last.id, last.cursor_at) : null });
    });
  }
  async function history(principal: IdentityPrincipal, workspaceId: string, collectionId: string, beforeRevision?: number) {
    validate(IdSchema, workspaceId); if (beforeRevision !== undefined) validate(z.number().int().positive(), beforeRevision);
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, collectionId, 'read'), editable = await canCorrect(tx, access, collection);
      const rows = (await tx.query<{ id: string; collection_id: string; revision: number; kind: string; reason: string; created_at: Date; actor_id: string; undo_of: string | null }>('SELECT id,collection_id,revision,kind,reason,created_at,actor_id,undo_of FROM material_resolutions WHERE workspace_id=$1 AND collection_id=$2 AND ($3::int IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 51', [workspaceId, collectionId, beforeRevision ?? null])).rows;
      return { viewer: viewer(access), resolutions: rows.slice(0, 50).map((row) => ResolutionSchema.parse({ id: row.id, collectionId: row.collection_id, revision: row.revision, kind: row.kind, reason: row.reason, createdAt: row.created_at.toISOString(), actorId: row.actor_id, undoOf: row.undo_of, canUndo: editable && collection.revision === row.revision })), nextBeforeRevision: rows.length > 50 ? rows[49]!.revision : null };
    });
  }
  return { create, read, list, history };
}
