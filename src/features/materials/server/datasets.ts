import type { Pool } from 'pg';
import { z } from 'zod';
import { DatasetAggregateInputSchema, DatasetAggregateSchema, DatasetPageSchema, DatasetQuerySchema, type DatasetQuery, type MaterialCell, type MaterialCollection } from '@/contracts/materials';
import { withWorkspaceAccess, type IdentityPrincipal } from '@/features/identity/server/access';
import { validate } from '@/features/identity/server/http';
import { authorizedCollection, collectionDto, decodeCursor, encodeCursor, literalSearch, materialError, viewer } from './support';
import { IdSchema } from '@/contracts/primitives';
import { readPinnedSource } from '@/features/sources/server/pinned-source';

export function scalarValueSql(cell: string) {
  return `(CASE ${cell}->'value'->>'kind' WHEN 'text' THEN ${cell}->'value'->>'text' WHEN 'date' THEN ${cell}->'value'->>'date' WHEN 'decimal' THEN ${cell}->'value'->>'decimal' WHEN 'quantity' THEN ${cell}->'value'->>'decimal' WHEN 'money' THEN ${cell}->'value'->>'minorUnits' END)`;
}
export function datasetWhere(body: Pick<DatasetQuery, 'filters' | 'query'>, fields: NonNullable<MaterialCollection['mapping']>['fields'], parameters: unknown[], alias = 'r') {
  const clauses: string[] = [];
  const bind = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };
  if (body.query) clauses.push(`${alias}.label ILIKE ${bind(literalSearch(body.query))} ESCAPE '\\'`);
  for (const filter of body.filters) {
    const field = fields.find((candidate) => candidate.id === filter.fieldId);
    if (!field) throw materialError('field', 'VALIDATION_FAILED');
    const cell = `(${alias}.cells->${bind(filter.fieldId)}::text)`, scalar = scalarValueSql(cell);
    if (filter.op === 'unknown') { clauses.push(`(${cell} IS NULL OR ${cell}->'value'->>'kind'='unknown')`); continue; }
    if (filter.value === undefined) throw materialError('filter', 'VALIDATION_FAILED');
    if (filter.op === 'contains') { clauses.push(`${scalar} ILIKE ${bind(literalSearch(filter.value))} ESCAPE '\\'`); continue; }
    if (filter.op === 'eq') { clauses.push(`${scalar}=${bind(filter.value)}::text`); continue; }
    const comparator = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.op];
    if (field.kind === 'date') { validate(z.iso.date(), filter.value); clauses.push(`${scalar}${comparator}${bind(filter.value)}::text`); }
    else if (['decimal', 'money', 'quantity'].includes(field.kind)) {
      validate(z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/), filter.value);
      clauses.push(`CASE WHEN ${cell}->'value'->>'kind' IN ('decimal','money','quantity') THEN ${scalar}::numeric END ${comparator} ${bind(filter.value)}::numeric`);
    } else throw materialError('filter', 'VALIDATION_FAILED');
  }
  return clauses.length ? clauses.join(' AND ') : 'true';
}
export const snapshotCte = `snapshot AS (SELECT DISTINCT ON(record_id) record_id AS id,revision,missing,label,cells FROM material_record_versions WHERE collection_id=$1 AND revision<=$2 ORDER BY record_id,revision DESC)`;

export function createDatasetService(pool: Pool) {
  async function query(principal: IdentityPrincipal, input: unknown) {
    const body = validate(DatasetQuerySchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, body.collectionId, 'read');
      const revision = body.revision ?? collection.revision;
      if (revision > collection.revision) throw materialError('revision');
      const mappingRow = (await tx.query<{ mapping: MaterialCollection['mapping'] }>('SELECT mapping FROM material_mapping_versions WHERE collection_id=$1 AND revision<=$2 ORDER BY revision DESC LIMIT 1', [collection.id, revision])).rows[0];
      const mapping = mappingRow?.mapping ?? collection.mapping;
      const fieldIds = body.fieldIds ?? mapping?.fields.map((field) => field.id) ?? [];
      if (fieldIds.some((id) => !mapping?.fields.some((field) => field.id === id))) throw materialError('field', 'VALIDATION_FAILED');
      const scope = { workspaceId: body.workspaceId, userId: access.userId, authz: access.workspace.authz_version, collectionId: collection.id, revision, fieldIds, filters: body.filters, query: body.query, includeMissing: body.includeMissing };
      const after = decodeCursor(body.after, scope); if (after) validate(IdSchema, after.id);
      const params: unknown[] = [collection.id, revision, body.includeMissing];
      const where = datasetWhere(body, mapping?.fields ?? [], params);
      const total = (await tx.query<{ count: number }>(`WITH ${snapshotCte} SELECT count(*)::int AS count FROM snapshot r WHERE ($3::boolean OR NOT missing) AND ${where}`, params)).rows[0]!.count;
      params.push(after?.id ?? null, fieldIds, body.limit + 1);
      const cursorIndex = params.length - 2, fieldsIndex = params.length - 1, limitIndex = params.length;
      const rows = (await tx.query<{ id: string; revision: number; missing: boolean; label: string; cells: Record<string, MaterialCell>; byte_total: string }>(`WITH ${snapshotCte}, candidates AS (
          SELECT r.id,r.revision,r.missing,r.label,COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r.cells) WHERE key=ANY($${fieldsIndex}::text[])),'{}') AS cells
          FROM snapshot r WHERE ($3::boolean OR NOT missing) AND ${where} AND ($${cursorIndex}::uuid IS NULL OR r.id>$${cursorIndex}) ORDER BY r.id LIMIT $${limitIndex}
        ), sized AS (SELECT *,sum(octet_length(cells::text)+octet_length(label)+300) OVER(ORDER BY id) AS byte_total FROM candidates)
        SELECT * FROM sized WHERE byte_total<=900000 ORDER BY id`, params)).rows;
      if (!rows.length && total > 0) {
        const oversized = (await tx.query<{ count: number }>(`WITH ${snapshotCte} SELECT count(*)::int AS count FROM snapshot r WHERE ($3::boolean OR NOT missing) AND ${where} AND ($${cursorIndex}::uuid IS NULL OR r.id>$${cursorIndex})`, params.slice(0, cursorIndex))).rows[0]!.count;
        if (oversized) throw materialError('rowSize', 'VALIDATION_FAILED');
      }
      const page = rows.slice(0, body.limit), last = page.at(-1);
      const checked = new Set<string>();
      for (const record of page) for (const cell of Object.values(record.cells)) {
        const key = `${cell.sourceRef.sourceId}/${cell.sourceRef.sourceVersionId}`;
        if (!checked.has(key)) { await readPinnedSource(tx, access, { sourceId: cell.sourceRef.sourceId, sourceVersionId: cell.sourceRef.sourceVersionId }); checked.add(key); }
      }
      let hasMore = rows.length > body.limit;
      if (!hasMore && last) {
        const moreParams = params.slice(0, cursorIndex - 1); moreParams.push(last.id);
        hasMore = Boolean((await tx.query(`WITH ${snapshotCte} SELECT 1 FROM snapshot r WHERE ($3::boolean OR NOT missing) AND ${where} AND r.id>$${cursorIndex}::uuid LIMIT 1`, moreParams)).rowCount);
      }
      return DatasetPageSchema.parse({ viewer: viewer(access), collection: collectionDto({ ...collection, mapping }), revision, total, records: page.map((row) => ({ recordId: row.id, revision: row.revision, missing: row.missing, label: row.label, cells: row.cells })), nextCursor: hasMore && last ? encodeCursor(scope, last.id) : null });
    });
  }
  async function aggregate(principal: IdentityPrincipal, input: unknown) {
    const body = validate(DatasetAggregateInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, body.collectionId, 'read'), revision = body.revision ?? collection.revision;
      if (revision > collection.revision) throw materialError('revision');
      const mappingRow = (await tx.query<{ mapping: MaterialCollection['mapping'] }>('SELECT mapping FROM material_mapping_versions WHERE collection_id=$1 AND revision<=$2 ORDER BY revision DESC LIMIT 1', [collection.id, revision])).rows[0];
      const mapping = mappingRow?.mapping ?? (revision === collection.revision ? collection.mapping : null);
      const field = mapping?.fields.find((candidate) => candidate.id === body.fieldId);
      if (!field || body.operation !== 'count' && !['money', 'decimal', 'quantity'].includes(field.kind)) throw materialError('field', 'VALIDATION_FAILED');
      const params: unknown[] = [collection.id, revision, body.fieldId];
      const where = datasetWhere(body, mapping!.fields, params);
      const sources = (await tx.query<{ source_id: string; version_id: string }>(`WITH ${snapshotCte} SELECT DISTINCT c.value->'sourceRef'->>'sourceId' AS source_id,c.value->'sourceRef'->>'sourceVersionId' AS version_id
        FROM snapshot r CROSS JOIN LATERAL jsonb_each(r.cells) c WHERE NOT missing AND $3::text IS NOT NULL AND ${where} LIMIT 1001`, params)).rows;
      if (sources.length > 1000) throw materialError('sourceLimit', 'VALIDATION_FAILED');
      for (const source of sources) await readPinnedSource(tx, access, { sourceId: source.source_id, sourceVersionId: source.version_id });
      const scalar = scalarValueSql('(cells->$3::text)'), method = { sum: 'sum', min: 'min', max: 'max', average: 'avg', count: 'count' }[body.operation];
      const result = (await tx.query<{ total: number; included: number; unknown: number; value: string | null }>(`WITH ${snapshotCte}, material_values AS (
        SELECT cells->$3::text AS cell,${scalar} AS scalar FROM snapshot r WHERE NOT missing AND ${where}
      ) SELECT count(*)::int AS total,count(*) FILTER(WHERE cell->'value'->>'kind'<>'unknown' AND cell->>'reviewState'<>'needs-review')::int AS included,
        count(*) FILTER(WHERE cell IS NULL OR cell->'value'->>'kind'='unknown')::int AS unknown,
        ${body.operation === 'count' ? 'count(scalar)' : `${method}(CASE WHEN cell->'value'->>'kind' IN ('money','decimal','quantity') THEN scalar::numeric END)`} FILTER(WHERE cell->'value'->>'kind'<>'unknown' AND cell->>'reviewState'<>'needs-review')::text AS value FROM material_values`, params)).rows[0]!;
      return DatasetAggregateSchema.parse({ revision, fieldId: body.fieldId, operation: body.operation, value: result.value, ...(field.kind === 'money' ? { currency: field.currency } : {}), ...(field.kind === 'quantity' ? { unit: field.unit } : {}), coverage: { total: result.total, included: result.included, excluded: result.total - result.included, unknown: result.unknown } });
    });
  }
  return { query, aggregate };
}

