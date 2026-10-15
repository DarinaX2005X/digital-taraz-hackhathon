import type { Pool } from 'pg';
import { z } from 'zod';
import { HashSchema, IdSchema } from '../../../contracts/primitives';
import { SourceLibraryQuerySchema, SourceListSchema, type SourceLibraryQuery } from '../../../contracts/sources';
import { hasScope } from '../../identity/domain/policy';
import { withWorkspaceAccess, type SessionPrincipal } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { sourceHash } from './storage';

const CursorSchema = z.strictObject({ version: z.literal(1), updatedAt: z.iso.datetime(), id: IdSchema, filterHash: HashSchema });
const invalid = () => new IdentityError('VALIDATION_FAILED', 'sources.errors.validation');
export async function listSourceLibrary(pool: Pool, principal: SessionPrincipal, raw: SourceLibraryQuery) {
  const input = validate(SourceLibraryQuerySchema, raw);
  const filters = { workspaceId: input.workspaceId, projectId: input.projectId ?? null, query: input.query || null, format: input.format ?? null, from: input.from ?? null, to: input.to ?? null };
  const filterHash = sourceHash(JSON.stringify(filters));
  let cursor: z.infer<typeof CursorSchema> | null = null;
  if (input.after) {
    try { cursor = CursorSchema.parse(JSON.parse(Buffer.from(input.after, 'base64url').toString('utf8'))); } catch { throw invalid(); }
    if (cursor.filterHash !== filterHash) throw invalid();
  }
  return withWorkspaceAccess(pool, principal, { workspaceId: input.workspaceId, scope: 'read' }, async (tx, access) => {
    const owner = access.membership.role === 'owner';
    const confidential = hasScope(access.membership, 'read-confidential');
    const search = input.query ? `%${input.query.replace(/[\\%_]/g, '\\$&')}%` : null;
    const rows = (await tx.query<{ id: string; updated_at: Date; cursor_time: string; summary: Record<string, unknown> }>(`
      SELECT s.id,s.updated_at,to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
      json_build_object('id',s.id,'workspaceId',s.workspace_id,'projectId',s.project_id,'title',d.title,'accessClass',s.access_class,
        'revision',s.current_revision,'currentVersionId',s.current_version_id,'status',u.status,'format',u.format,'fileName',u.file_name,
        'byteSize',COALESCE(u.byte_size,u.declared_size),'thumbnailUploadId',CASE WHEN u.format IN ('png','jpeg','webp') AND u.byte_hash IS NOT NULL THEN u.id ELSE NULL END,'createdAt',s.created_at,'updatedAt',s.updated_at) AS summary
      FROM sources s JOIN source_details d ON d.workspace_id=s.workspace_id AND d.source_id=s.id
      JOIN projects p ON p.workspace_id=s.workspace_id AND p.id=s.project_id
      LEFT JOIN identity_project_grants g ON g.workspace_id=s.workspace_id AND g.project_id=s.project_id AND g.user_id=$2
      JOIN LATERAL (SELECT id,status,format,file_name,byte_size,declared_size,byte_hash FROM source_uploads
        WHERE workspace_id=s.workspace_id AND source_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) u ON true
      WHERE s.workspace_id=$1 AND s.state<>'trashed' AND p.status<>'trashed'
        AND ($3::boolean OR 'read'=ANY(g.scopes))
        AND (s.access_class<>'confidential' OR ($4::boolean AND ($3::boolean OR 'read-confidential'=ANY(g.scopes))))
        AND ($5::uuid IS NULL OR s.project_id=$5) AND ($6::text IS NULL OR d.title ILIKE $6 ESCAPE '\\' OR u.file_name ILIKE $6 ESCAPE '\\')
        AND ($7::text IS NULL OR u.format=$7) AND ($8::date IS NULL OR s.updated_at>=($8::date::timestamp AT TIME ZONE 'UTC'))
        AND ($9::date IS NULL OR s.updated_at<(($9::date+1)::timestamp AT TIME ZONE 'UTC'))
        AND ($10::timestamptz IS NULL OR (s.updated_at,s.id)<($10::timestamptz,$11::uuid))
      ORDER BY s.updated_at DESC,s.id DESC LIMIT $12`, [input.workspaceId, access.userId, owner, confidential, input.projectId ?? null, search, input.format ?? null, input.from ?? null, input.to ?? null, cursor?.updatedAt ?? null, cursor?.id ?? null, input.limit + 1])).rows;
    const page = rows.slice(0, input.limit), last = page.at(-1);
    return SourceListSchema.parse({ sources: page.map((row) => ({ ...row.summary, createdAt: new Date(String(row.summary.createdAt)).toISOString(), updatedAt: row.updated_at.toISOString() })), nextCursor: rows.length > input.limit && last ? Buffer.from(JSON.stringify({ version: 1, updatedAt: last.cursor_time, id: last.id, filterHash })).toString('base64url') : null });
  });
}
