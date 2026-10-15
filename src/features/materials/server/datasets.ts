import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  DatasetAggregateInputSchema,
  DatasetAggregateSchema,
  DatasetBrowseQuerySchema,
  DatasetFacetInputSchema,
  DatasetFacetSchema,
  DatasetGroupInputSchema,
  DatasetGroupPageSchema,
  DatasetPageSchema,
  MaterialDecisionContextInputSchema,
  MaterialDecisionContextSchema,
  MaterialValueSchema,
  type DatasetBrowseQuery,
  type DatasetCoverage,
  type DatasetExpression,
  type DatasetFilterSchema,
  type MaterialCell,
  type MaterialCollection,
} from '@/contracts/materials';
import { IdSchema } from '@/contracts/primitives';
import { withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '@/features/identity/server/access';
import { validate } from '@/features/identity/server/http';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { readPinnedSource } from '@/features/sources/server/pinned-source';
import { authorizedCollection, collectionDto, decodeCursor, encodeCursor, literalSearch, materialError, viewer } from './support';

type Filter = z.infer<typeof DatasetFilterSchema>;

export function scalarValueSql(cell: string) {
  return `(CASE ${cell}->'value'->>'kind' WHEN 'text' THEN ${cell}->'value'->>'text' WHEN 'date' THEN ${cell}->'value'->>'date' WHEN 'decimal' THEN ${cell}->'value'->>'decimal' WHEN 'quantity' THEN ${cell}->'value'->>'decimal' WHEN 'money' THEN ${cell}->'value'->>'minorUnits' END)`;
}

export function datasetWhere(body: Pick<DatasetBrowseQuery, 'filters' | 'query' | 'where'>, fields: NonNullable<MaterialCollection['mapping']>['fields'], parameters: unknown[], alias = 'r') {
  const bind = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };
  const predicate = (filter: Filter): string => {
    const field = fields.find((candidate) => candidate.id === filter.fieldId);
    if (!field) throw materialError('field', 'VALIDATION_FAILED');
    const cell = `(${alias}.cells->${bind(filter.fieldId)}::text)`, scalar = scalarValueSql(cell);
    if (filter.op === 'unknown') {
      if (filter.value !== undefined) throw materialError('filter', 'VALIDATION_FAILED');
      return `(${cell} IS NULL OR ${cell}->'value'->>'kind'='unknown')`;
    }
    if (filter.value === undefined) throw materialError('filter', 'VALIDATION_FAILED');
    if (filter.op === 'contains') {
      if (field.kind !== 'text') throw materialError('filter', 'VALIDATION_FAILED');
      return `${scalar} ILIKE ${bind(literalSearch(filter.value))} ESCAPE '\\'`;
    }
    if (field.kind === 'date') validate(z.iso.date(), filter.value);
    if (['decimal', 'money', 'quantity'].includes(field.kind)) validate(z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/), filter.value);
    if (filter.op === 'eq') return `${scalar}=${bind(filter.value)}::text`;
    const comparator = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.op];
    if (field.kind === 'date') return `${scalar}${comparator}${bind(filter.value)}::text`;
    if (['decimal', 'money', 'quantity'].includes(field.kind)) return `CASE WHEN ${cell}->'value'->>'kind' IN ('decimal','money','quantity') THEN ${scalar}::numeric END ${comparator} ${bind(filter.value)}::numeric`;
    throw materialError('filter', 'VALIDATION_FAILED');
  };
  const expression = (node: DatasetExpression): string => {
    if (node.type === 'predicate') return predicate(node.predicate);
    if (node.type === 'not') return `NOT (${expression(node.child)})`;
    return `(${node.children.map(expression).join(node.operator === 'and' ? ' AND ' : ' OR ')})`;
  };
  const clauses: string[] = [];
  if (body.query) clauses.push(`${alias}.label ILIKE ${bind(literalSearch(body.query))} ESCAPE '\\'`);
  clauses.push(...body.filters.map(predicate));
  if (body.where) clauses.push(expression(body.where));
  return clauses.length ? clauses.join(' AND ') : 'true';
}

export const snapshotCte = `snapshot AS (SELECT DISTINCT ON(record_id) record_id AS id,revision,missing,label,cells FROM material_record_versions WHERE collection_id=$1 AND revision<=$2 ORDER BY record_id,revision DESC)`;
export const currentSnapshotCte = `snapshot AS (SELECT id,current_revision AS revision,missing,label,cells FROM material_records WHERE collection_id=$1 AND $2::int IS NOT NULL)`;

function coverage(row: Record<string, unknown>, prefix = ''): DatasetCoverage {
  return {
    total: Number(row[`${prefix}total`]), included: Number(row[`${prefix}included`]), excluded: Number(row[`${prefix}excluded`]),
    missing: Number(row[`${prefix}missing`]), unknown: Number(row[`${prefix}unknown`]), needsReview: Number(row[`${prefix}needs_review`]),
  };
}

function coverageColumns(cell: string, valid: string, prefix = '') {
  return [
    `count(*)::int AS ${prefix}total`,
    `count(*) FILTER(WHERE ${valid})::int AS ${prefix}included`,
    `count(*) FILTER(WHERE NOT (${valid}))::int AS ${prefix}excluded`,
    `count(*) FILTER(WHERE ${cell} IS NULL)::int AS ${prefix}missing`,
    `count(*) FILTER(WHERE ${cell} IS NOT NULL AND ${cell}->'value'->>'kind'='unknown')::int AS ${prefix}unknown`,
    `count(*) FILTER(WHERE ${cell} IS NOT NULL AND ${cell}->'value'->>'kind'<>'unknown' AND ${cell}->>'reviewState'='needs-review')::int AS ${prefix}needs_review`,
  ].join(',');
}

function validCell(cell: string, numeric = false) {
  return `${cell} IS NOT NULL AND ${cell}->'value'->>'kind'<>'unknown' AND ${cell}->>'reviewState'<>'needs-review'${numeric ? ` AND ${cell}->'value'->>'kind' IN ('money','decimal','quantity')` : ''}`;
}

async function assertReadableSources(tx: PoolClient, access: WorkspaceAccess, snapshot: string, params: readonly unknown[], where: string, includeMissing: boolean) {
  const rows = (await tx.query<{ source_id: string | null; version_id: string | null }>(`WITH ${snapshot} SELECT DISTINCT e.value->'sourceRef'->>'sourceId' AS source_id,e.value->'sourceRef'->>'sourceVersionId' AS version_id
    FROM snapshot r CROSS JOIN LATERAL jsonb_each(r.cells) e WHERE ($3::boolean OR NOT r.missing) AND ${where} LIMIT 1001`, [...params.slice(0, 2), includeMissing, ...params.slice(3)])).rows;
  if (rows.length > 1000 || rows.some((row) => !row.source_id || !row.version_id)) throw materialError('sourceLimit', 'VALIDATION_FAILED');
  const refs = [];
  for (const row of rows.sort((a, b) => `${a.source_id}/${a.version_id}`.localeCompare(`${b.source_id}/${b.version_id}`))) refs.push((await readPinnedSource(tx, access, { sourceId: row.source_id!, sourceVersionId: row.version_id! })).sourceRef);
  return refs;
}

async function mappingAt(tx: PoolClient, collection: MaterialCollection, revision: number) {
  const row = (await tx.query<{ mapping: MaterialCollection['mapping'] }>('SELECT mapping FROM material_mapping_versions WHERE collection_id=$1 AND revision<=$2 ORDER BY revision DESC LIMIT 1', [collection.id, revision])).rows[0];
  return row?.mapping ?? (revision === collection.revision ? collection.mapping : null);
}

export function createDatasetService(pool: Pool) {
  async function query(principal: IdentityPrincipal, input: unknown) {
    const body = validate(DatasetBrowseQuerySchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, body.collectionId, 'read');
      const revision = body.revision ?? collection.revision;
      if (revision > collection.revision) throw materialError('revision');
      const dto = collectionDto(collection), mapping = await mappingAt(tx, dto, revision), snapshot = revision === collection.revision ? currentSnapshotCte : snapshotCte;
      const fieldIds = body.fieldIds ?? mapping?.fields.map((field) => field.id) ?? [];
      if (fieldIds.some((id) => !mapping?.fields.some((field) => field.id === id))) throw materialError('field', 'VALIDATION_FAILED');
      const scope = { workspaceId: body.workspaceId, userId: access.userId, authz: access.workspace.authz_version, collectionId: collection.id, revision, fieldIds, filters: body.filters, where: body.where ?? null, query: body.query, includeMissing: body.includeMissing };
      const after = decodeCursor(body.after, scope); if (after) validate(IdSchema, after.id);
      const baseParams: unknown[] = [collection.id, revision, body.includeMissing];
      const where = datasetWhere(body, mapping?.fields ?? [], baseParams);
      await assertReadableSources(tx, access, snapshot, baseParams, where, body.includeMissing);
      const total = (await tx.query<{ count: number }>(`WITH ${snapshot} SELECT count(*)::int AS count FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where}`, baseParams)).rows[0]!.count;
      const params = [...baseParams, after?.id ?? null, fieldIds, body.limit + 1];
      const cursorIndex = baseParams.length + 1, fieldsIndex = baseParams.length + 2, limitIndex = baseParams.length + 3;
      const rows = (await tx.query<{ id: string; revision: number; missing: boolean; label: string; cells: Record<string, MaterialCell>; byte_total: string }>(`WITH ${snapshot}, candidates AS (
          SELECT r.id,r.revision,r.missing,r.label,COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r.cells) WHERE key=ANY($${fieldsIndex}::text[])),'{}') AS cells
          FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where} AND ($${cursorIndex}::uuid IS NULL OR r.id>$${cursorIndex}) ORDER BY r.id LIMIT $${limitIndex}
        ), sized AS (SELECT *,sum(octet_length(cells::text)+octet_length(label)+300) OVER(ORDER BY id) AS byte_total FROM candidates)
        SELECT * FROM sized WHERE byte_total<=900000 ORDER BY id`, params)).rows;
      if (!rows.length && total > 0) {
        const oversized = await tx.query(`WITH ${snapshot} SELECT 1 FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where} AND ($${cursorIndex}::uuid IS NULL OR r.id>$${cursorIndex}) LIMIT 1`, [...baseParams, after?.id ?? null]);
        if (oversized.rowCount) throw materialError('rowSize', 'VALIDATION_FAILED');
      }
      const page = rows.slice(0, body.limit), last = page.at(-1);
      let hasMore = rows.length > body.limit;
      if (!hasMore && last) hasMore = Boolean((await tx.query(`WITH ${snapshot} SELECT 1 FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where} AND r.id>$${cursorIndex}::uuid LIMIT 1`, [...baseParams, last.id])).rowCount);
      return DatasetPageSchema.parse({ viewer: viewer(access), collection: collectionDto({ ...collection, mapping }), revision, total, records: page.map((row) => ({ recordId: row.id, revision: row.revision, missing: row.missing, label: row.label, cells: row.cells })), nextCursor: hasMore && last ? encodeCursor(scope, last.id) : null });
    });
  }

  async function aggregate(principal: IdentityPrincipal, input: unknown) {
    const body = validate(DatasetAggregateInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, body.collectionId, 'read'), revision = body.revision ?? collection.revision;
      if (revision > collection.revision) throw materialError('revision');
      const dto = collectionDto(collection), mapping = await mappingAt(tx, dto, revision), snapshot = revision === collection.revision ? currentSnapshotCte : snapshotCte;
      const field = mapping?.fields.find((candidate) => candidate.id === body.fieldId);
      if (!field || body.operation !== 'count' && !['money', 'decimal', 'quantity'].includes(field.kind)) throw materialError('field', 'VALIDATION_FAILED');
      const params: unknown[] = [collection.id, revision, false];
      const where = datasetWhere(body, mapping!.fields, params);
      const sourceRefs = await assertReadableSources(tx, access, snapshot, params, where, false);
      params.push(body.fieldId);
      const cell = `(r.cells->$${params.length}::text)`, scalar = scalarValueSql(cell), valid = validCell(cell, body.operation !== 'count');
      const method = { sum: 'sum', min: 'min', max: 'max', average: 'avg' }[body.operation as 'sum' | 'min' | 'max' | 'average'];
      const value = body.operation === 'count' ? `count(*) FILTER(WHERE ${valid})::text` : `${method}(CASE WHEN ${valid} THEN ${scalar}::numeric END)::text`;
      const result = (await tx.query<Record<string, unknown>>(`WITH ${snapshot} SELECT ${coverageColumns(cell, valid)},${value} AS value FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where}`, params)).rows[0]!;
      return DatasetAggregateSchema.parse({ revision, fieldId: body.fieldId, operation: body.operation, value: result.value, ...(field.kind === 'money' ? { currency: field.currency } : {}), ...(field.kind === 'quantity' ? { unit: field.unit } : {}), coverage: coverage(result), sourceRefs });
    });
  }

  async function facet(principal: IdentityPrincipal, input: unknown) {
    const body = validate(DatasetFacetInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, body.collectionId, 'read'), revision = body.revision ?? collection.revision;
      if (revision > collection.revision) throw materialError('revision');
      const dto = collectionDto(collection), mapping = await mappingAt(tx, dto, revision), snapshot = revision === collection.revision ? currentSnapshotCte : snapshotCte;
      if (!mapping?.fields.some((field) => field.id === body.fieldId)) throw materialError('field', 'VALIDATION_FAILED');
      const scope = { workspaceId: body.workspaceId, userId: access.userId, authz: access.workspace.authz_version, collectionId: collection.id, revision, fieldId: body.fieldId, filters: body.filters, where: body.where ?? null, query: body.query };
      const cursor = decodeCursor(body.after, scope), offset = cursor ? validate(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(1_000_000)), cursor.id) : 0;
      const params: unknown[] = [collection.id, revision, false];
      const where = datasetWhere(body, mapping.fields, params);
      await assertReadableSources(tx, access, snapshot, params, where, false);
      params.push(body.fieldId);
      const fieldIndex = params.length, cell = `(r.cells->$${fieldIndex}::text)`, valid = validCell(cell);
      const coverageRow = (await tx.query<Record<string, unknown>>(`WITH ${snapshot} SELECT ${coverageColumns(cell, valid)} FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where}`, params)).rows[0]!;
      params.push(offset, body.limit + 1);
      const rows = (await tx.query<{ sort_key: string; value: unknown; count: number }>(`WITH ${snapshot}, grouped AS (
        SELECT COALESCE((${cell}->'value')::text,'null') AS sort_key,${cell}->'value' AS value,count(*)::int AS count FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where} GROUP BY ${cell}->'value'
      ) SELECT * FROM grouped ORDER BY sort_key OFFSET $${params.length - 1} LIMIT $${params.length}`, params)).rows;
      const page = rows.slice(0, body.limit);
      return DatasetFacetSchema.parse({ revision, fieldId: body.fieldId, values: page.map((row) => ({ key: row.sort_key, value: row.value === null ? null : MaterialValueSchema.parse(row.value), count: row.count })), nextCursor: rows.length > body.limit ? encodeCursor(scope, String(offset + page.length)) : null, coverage: coverage(coverageRow) });
    });
  }

  async function group(principal: IdentityPrincipal, input: unknown) {
    const body = validate(DatasetGroupInputSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, body.collectionId, 'read'), revision = body.revision ?? collection.revision;
      if (revision > collection.revision) throw materialError('revision');
      const dto = collectionDto(collection), mapping = await mappingAt(tx, dto, revision), snapshot = revision === collection.revision ? currentSnapshotCte : snapshotCte;
      const dimensions = body.dimensions.map((id) => mapping?.fields.find((field) => field.id === id));
      const measures = body.measures.map((measure) => ({ ...measure, field: mapping?.fields.find((field) => field.id === measure.fieldId) }));
      if (dimensions.some((field) => !field) || measures.some(({ field, operation }) => !field || operation !== 'count' && !['money', 'decimal', 'quantity'].includes(field.kind))) throw materialError('field', 'VALIDATION_FAILED');
      const scope = { workspaceId: body.workspaceId, userId: access.userId, authz: access.workspace.authz_version, collectionId: collection.id, revision, dimensions: body.dimensions, measures: body.measures, filters: body.filters, where: body.where ?? null, query: body.query };
      const cursor = decodeCursor(body.after, scope), offset = cursor ? validate(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(1_000_000)), cursor.id) : 0;
      const params: unknown[] = [collection.id, revision, false];
      const where = datasetWhere(body, mapping?.fields ?? [], params);
      const sourceRefs = await assertReadableSources(tx, access, snapshot, params, where, false);
      const dimensionSql = body.dimensions.map((id, index) => { params.push(id); return { alias: `d${index}`, value: `(r.cells->$${params.length}::text->'value')` }; });
      const measureSql = measures.map((measure, index) => {
        params.push(measure.fieldId);
        const cell = `(r.cells->$${params.length}::text)`, valid = validCell(cell, measure.operation !== 'count'), scalar = scalarValueSql(cell), prefix = `m${index}_`;
        const method = { sum: 'sum', min: 'min', max: 'max', average: 'avg' }[measure.operation as 'sum' | 'min' | 'max' | 'average'];
        const value = measure.operation === 'count' ? `count(*) FILTER(WHERE ${valid})::text` : `${method}(CASE WHEN ${valid} THEN ${scalar}::numeric END)::text`;
        return `${value} AS m${index}_value,${coverageColumns(cell, valid, prefix)}`;
      });
      params.push(offset, body.limit + 1);
      const selection = [...dimensionSql.map((item) => `${item.value} AS ${item.alias}`), ...measureSql].join(',');
      const grouping = dimensionSql.length ? ` GROUP BY ${dimensionSql.map((item) => item.value).join(',')}` : '';
      const ordering = dimensionSql.length ? dimensionSql.map((item) => `${item.alias}::text NULLS FIRST`).join(',') : 'm0_value NULLS FIRST';
      const rows = (await tx.query<Record<string, unknown>>(`WITH ${snapshot}, grouped AS (
        SELECT ${selection} FROM snapshot r WHERE ($3::boolean OR NOT r.missing) AND ${where}${grouping}
      ) SELECT *,count(*) OVER()::int AS total_groups FROM grouped ORDER BY ${ordering} OFFSET $${params.length - 1} LIMIT $${params.length}`, params)).rows;
      const page = rows.slice(0, body.limit), totalGroups = Number(rows[0]?.total_groups ?? 0);
      return DatasetGroupPageSchema.parse({ viewer: viewer(access), collection: collectionDto({ ...collection, mapping }), revision, totalGroups, sourceRefs,
        rows: page.map((row) => {
          const dimensionValues = Object.fromEntries(body.dimensions.map((id, index) => [id, row[`d${index}`] === null ? null : MaterialValueSchema.parse(row[`d${index}`])]));
          return { key: hashJson(dimensionValues), dimensions: dimensionValues, measures: Object.fromEntries(body.measures.map((measure, index) => [measure.id, { value: row[`m${index}_value`] === null ? null : String(row[`m${index}_value`]), coverage: coverage(row, `m${index}_`) }])) };
        }), nextCursor: rows.length > body.limit ? encodeCursor(scope, String(offset + page.length)) : null });
    });
  }

  async function context(principal: IdentityPrincipal, input: unknown) {
    const body = validate(MaterialDecisionContextInputSchema, input);
    const fieldIds = body.fieldIds ? [...new Set([...body.fieldIds, ...body.measures.map((measure) => measure.fieldId), ...(body.grouping?.dimensions ?? [])])] : undefined;
    const page = await query(principal, { workspaceId: body.workspaceId, collectionId: body.collectionId, revision: body.revision, fieldIds, filters: body.filters, where: body.where, query: body.query, limit: body.sampleLimit });
    const aggregateResults = [];
    for (const measure of body.measures) aggregateResults.push({ measureId: measure.id, ...await aggregate(principal, { workspaceId: body.workspaceId, collectionId: body.collectionId, revision: page.revision, filters: body.filters, where: body.where, query: body.query, fieldId: measure.fieldId, operation: measure.operation }) });
    const aggregates = aggregateResults.map((result) => ({ measureId: result.measureId, revision: result.revision, fieldId: result.fieldId, operation: result.operation, value: result.value, ...(result.currency ? { currency: result.currency } : {}), ...(result.unit ? { unit: result.unit } : {}), coverage: result.coverage }));
    const groupedResult = body.grouping ? await group(principal, { workspaceId: body.workspaceId, collectionId: body.collectionId, revision: page.revision, filters: body.filters, where: body.where, query: body.query, dimensions: body.grouping.dimensions, measures: body.measures, limit: body.grouping.limit }) : undefined;
    const grouped = groupedResult ? { viewer: groupedResult.viewer, collection: groupedResult.collection, revision: groupedResult.revision, rows: groupedResult.rows, nextCursor: groupedResult.nextCursor, totalGroups: groupedResult.totalGroups } : undefined;
    const refs = new Map<string, MaterialCell['sourceRef']>();
    for (const aggregateResult of aggregateResults) for (const ref of aggregateResult.sourceRefs) refs.set(JSON.stringify(ref), ref);
    for (const record of page.records) for (const cell of Object.values(record.cells)) refs.set(JSON.stringify(cell.sourceRef), cell.sourceRef);
    const fields = (page.collection.mapping?.fields ?? []).filter((field) => !fieldIds || fieldIds.includes(field.id));
    const evidence = [...refs.values()];
    return MaterialDecisionContextSchema.parse({ viewer: page.viewer, collection: page.collection, revision: page.revision, schema: fields, matchedRecords: page.total, truncated: page.total > page.records.length, sample: page.records, aggregates, ...(grouped ? { grouped } : {}), evidenceRefs: evidence.slice(0, 200), evidenceTruncated: evidence.length > 200 });
  }

  return { query, aggregate, facet, group, context };
}

/** Bounded, ACL-checked schema/aggregate/sample context for an assistant tool. Never returns the whole dataset. */
export function createMaterialDecisionContextReader(pool: Pool) {
  const datasets = createDatasetService(pool);
  return { read: datasets.context };
}
