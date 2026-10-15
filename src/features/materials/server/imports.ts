import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { ApplyImportSchema, BeginImportSchema, ImportCountsSchema, ImportPreviewSchema, ImportResolutionSchema, MaterialCellSchema, MaterialMutationSchema, type MaterialCell } from '@/contracts/materials';
import { IdSchema } from '@/contracts/primitives';
import { withWorkspaceAccess, type IdentityPrincipal } from '@/features/identity/server/access';
import { validate } from '@/features/identity/server/http';
import { readPinnedSource, readPinnedSourceChunk } from '@/features/sources/server/pinned-source';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { cellIssues, cellsHash, compatibleFields, isHeader, mapFragment, matchesHeaders, normalizeValue, recordKey, rowLabel } from '../domain/mapping';
import { assertRevision, authorizedCollection, authorizedImport, canCorrect, collectionDto, createResolution, decodeCursor, emptyCounts, encodeCursor, finishResolution, importDto, materialError, operation, viewer, type CollectionRow, type ImportRowDb, type StagedRow } from './support';

async function classify(tx: PoolClient, collection: CollectionRow, item: ImportRowDb) {
  await tx.query(`WITH duplicates AS (SELECT identity_hash FROM material_import_rows WHERE import_id=$1 AND excluded=false AND identity_hash IS NOT NULL GROUP BY identity_hash HAVING count(*)>1)
    UPDATE material_import_rows s SET record_id=COALESCE(r.id,s.provisional_record_id),change=CASE
      WHEN s.identity_hash IS NULL OR d.identity_hash IS NOT NULL THEN 'ambiguous'
      WHEN r.id IS NULL THEN 'added' WHEN r.row_hash=s.row_hash AND r.missing=false THEN 'unchanged'
      WHEN $3='append' THEN 'ambiguous' ELSE 'changed' END
    FROM material_import_rows x LEFT JOIN material_records r ON r.collection_id=$2 AND r.identity_hash=x.identity_hash
      LEFT JOIN duplicates d ON d.identity_hash=x.identity_hash
    WHERE s.import_id=$1 AND x.import_id=$1 AND s.ordinal=x.ordinal`, [item.id, collection.id, item.mapping.importMode]);
  const counts = (await tx.query<{ total: number; added: number; changed: number; unchanged: number; ambiguous: number; excluded: number }>(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE change='added' AND NOT excluded)::int AS added,count(*) FILTER(WHERE change='changed' AND NOT excluded)::int AS changed,
    count(*) FILTER(WHERE change='unchanged' AND NOT excluded)::int AS unchanged,count(*) FILTER(WHERE change='ambiguous' AND NOT excluded)::int AS ambiguous,
    count(*) FILTER(WHERE excluded)::int AS excluded FROM material_import_rows WHERE import_id=$1`, [item.id])).rows[0]!;
  const missing = item.mapping.importMode === 'replace-snapshot' ? (await tx.query<{ count: number }>(`SELECT count(*)::int AS count FROM material_records r WHERE r.collection_id=$1 AND NOT r.missing AND NOT EXISTS(SELECT 1 FROM material_import_rows i WHERE i.import_id=$2 AND i.identity_hash=r.identity_hash AND NOT i.excluded)`, [collection.id, item.id])).rows[0]!.count : 0;
  const unknownCells = (await tx.query<{ count: number }>(`SELECT count(*)::int AS count FROM material_import_rows r CROSS JOIN LATERAL jsonb_each(r.cells) c WHERE r.import_id=$1 AND NOT r.excluded AND c.value->'value'->>'kind'='unknown'`, [item.id])).rows[0]!.count;
  const result = ImportCountsSchema.parse({ ...counts, missing, unknownCells });
  await tx.query('UPDATE material_imports SET counts=$2 WHERE id=$1', [item.id, JSON.stringify(result)]);
  item.counts = result;
}

export function createImportService(pool: Pool) {
  async function begin(principal: IdentityPrincipal, operationId: string, input: unknown) {
    const body = validate(BeginImportSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, body.collectionId, 'edit', true);
      const pinned = await readPinnedSource(tx, access, { sourceId: body.sourceId, sourceVersionId: body.sourceVersionId });
      if (pinned.projectId !== collection.project_id || pinned.accessClass === 'confidential' && collection.access_class !== 'confidential') throw materialError('sourceScope', 'FORBIDDEN');
      return operation(tx, access, operationId, 'begin', body, async () => {
        assertRevision(collection, body.expectedRevision);
        if (!compatibleFields(collection.mapping, body.mapping)) throw materialError('keyChanged');
        if (body.mapping.sheet !== null && !pinned.manifest.sheets.includes(body.mapping.sheet)) throw materialError('schema');
        const mappingHash = hashJson(body.mapping);
        const previous = (await tx.query<ImportRowDb>("SELECT * FROM material_imports WHERE collection_id=$1 AND content_hash=$2 AND mapping_hash=$3 AND status='applied' AND applied_revision=$4 ORDER BY created_at DESC LIMIT 1", [collection.id, pinned.manifest.byteHash, mappingHash, collection.revision])).rows[0];
        if (previous) return { viewer: viewer(access), import: importDto(previous) };
        const row = (await tx.query<ImportRowDb>(`INSERT INTO material_imports(id,workspace_id,collection_id,actor_id,source_id,source_version_id,source_revision,content_hash,mapping,mapping_hash,expected_revision,chunk_count,counts,header_seen)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [randomUUID(), body.workspaceId, collection.id, access.userId, body.sourceId, body.sourceVersionId, pinned.sourceRef.revision, pinned.manifest.byteHash, JSON.stringify(body.mapping), mappingHash, collection.revision, pinned.chunkCount, JSON.stringify(emptyCounts()), body.mapping.headerRow === 0])).rows[0]!;
        return { viewer: viewer(access), import: importDto(row) };
      });
    });
  }
  async function advance(principal: IdentityPrincipal, importId: string, input: unknown) {
    const body = validate(MaterialMutationSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const { collection, row } = await authorizedImport(tx, access, importId, 'edit', true);
      if (['preview', 'applied'].includes(row.status)) return { viewer: viewer(access), import: importDto(row) };
      if (row.status !== 'preparing') throw materialError('importState');
      assertRevision(collection, body.expectedRevision);
      if (row.expected_revision !== collection.revision) throw materialError('revision');
      const sourceRef = { sourceId: row.source_id, sourceVersionId: row.source_version_id, revision: row.source_revision };
      // Each transaction processes at most 2,000 source rows. Reopening resumes the durable ordinal.
      const end = Math.min(row.next_chunk + 4, row.chunk_count);
      let failure: string | null = null;
      for (let ordinal = row.next_chunk; ordinal < end; ordinal++) {
        const chunk = await readPinnedSourceChunk(tx, access, { sourceId: row.source_id, sourceVersionId: row.source_version_id, ordinal });
        const rows: StagedRow[] = [];
        for (const [offset, fragment] of chunk.fragments.entries()) {
          if (row.mapping.sheet !== null && fragment.sheet !== row.mapping.sheet) continue;
          if (isHeader(fragment, row.mapping)) {
            if (!matchesHeaders(fragment, row.mapping)) { failure = 'schema'; break; }
            row.header_seen = true; continue;
          }
          if (row.mapping.headerRow > 0 && fragment.row && fragment.row < row.mapping.headerRow) continue;
          const cells = mapFragment(fragment, row.mapping, sourceRef);
          if (!z.record(z.string(), MaterialCellSchema).safeParse(cells).success) { failure = 'cellSize'; break; }
          const key = recordKey(cells, row.mapping);
          rows.push({ import_id: row.id, ordinal: ordinal * 500 + offset, record_id: randomUUID(), identity_key: key.key, identity_hash: key.hash, label: rowLabel(cells, row.mapping), cells, row_hash: cellsHash(cells), issues: [...cellIssues(cells), ...(!key.hash ? ['key'] : [])], change: 'added', excluded: false, key_override: null });
        }
        if (failure) break;
        if (rows.length) await tx.query(`INSERT INTO material_import_rows(import_id,ordinal,record_id,provisional_record_id,identity_key,identity_hash,label,cells,row_hash,issues)
          SELECT $1,ordinal,record_id,record_id,identity_key,identity_hash,label,cells,row_hash,issues FROM jsonb_to_recordset($2::jsonb) AS x(ordinal integer,record_id uuid,identity_key text,identity_hash text,label text,cells jsonb,row_hash text,issues jsonb)
          ON CONFLICT(import_id,ordinal) DO NOTHING`, [row.id, JSON.stringify(rows)]);
        row.next_chunk = ordinal + 1;
      }
      const total = (await tx.query<{ count: number }>('SELECT count(*)::int AS count FROM material_import_rows WHERE import_id=$1', [row.id])).rows[0]!.count;
      if (total > 100000) failure = 'rowLimit';
      if (row.next_chunk === row.chunk_count && !row.header_seen) failure = 'schema';
      row.status = failure ? 'failed' : row.next_chunk === row.chunk_count ? 'preview' : 'preparing'; row.error_code = failure;
      if (row.status === 'preview') await classify(tx, collection, row);
      else row.counts.total = total;
      await tx.query('UPDATE material_imports SET next_chunk=$2,header_seen=$3,status=$4,error_code=$5,counts=$6 WHERE id=$1', [row.id, row.next_chunk, row.header_seen, row.status, failure, JSON.stringify(row.counts)]);
      return { viewer: viewer(access), import: importDto(row) };
    });
  }
  async function preview(principal: IdentityPrincipal, workspaceId: string, importId: string, options: { after?: string; change?: string; limit?: number } = {}) {
    validate(IdSchema, workspaceId); const limit = validate(z.number().int().min(1).max(50), options.limit ?? 50);
    const change = validate(z.enum(['added', 'changed', 'unchanged', 'missing', 'ambiguous']).optional(), options.change);
    return withWorkspaceAccess(pool, principal, { workspaceId, scope: 'read' }, async (tx, access) => {
      const { collection, row } = await authorizedImport(tx, access, importId, 'read');
      await readPinnedSource(tx, access, { sourceId: row.source_id, sourceVersionId: row.source_version_id });
      const scope = { workspaceId, userId: access.userId, authzVersion: access.workspace.authz_version, importId, reviewRevision: row.review_revision, change: change ?? null }, cursor = decodeCursor(options.after, scope);
      const after = cursor ? validate(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative()), cursor.id) : -1;
      const rows = (await tx.query<StagedRow & { before: Record<string, MaterialCell> | null; last_candidate: number }>(`WITH data AS (
        SELECT s.import_id,s.ordinal,s.record_id,s.identity_key,s.identity_hash,s.label,s.cells,s.row_hash,s.issues,s.change,s.excluded,s.key_override,r.cells AS before FROM material_import_rows s LEFT JOIN material_records r ON r.collection_id=$2 AND r.id=s.record_id WHERE s.import_id=$1
        UNION ALL
        SELECT $1::uuid, (2000000+row_number() OVER(ORDER BY r.id))::int,r.id,r.identity_key,r.identity_hash,r.label,r.cells,r.row_hash,'[]'::jsonb,'missing',false,NULL,r.cells
        FROM material_records r WHERE r.collection_id=$2 AND NOT r.missing AND $5::boolean AND NOT EXISTS(SELECT 1 FROM material_import_rows s WHERE s.import_id=$1 AND s.identity_hash=r.identity_hash AND NOT s.excluded)
      ), candidates AS (SELECT * FROM data WHERE ordinal>$3 AND ($4::text IS NULL OR change=$4) ORDER BY ordinal LIMIT $6),
      sized AS (SELECT *,max(ordinal) OVER() AS last_candidate,sum(octet_length(cells::text)+COALESCE(octet_length(before::text),0)+octet_length(label)+1000) OVER(ORDER BY ordinal) AS byte_total FROM candidates)
      SELECT * FROM sized WHERE byte_total<=900000 ORDER BY ordinal`, [row.id, collection.id, after, change ?? null, row.mapping.importMode === 'replace-snapshot', limit + 1])).rows;
      const page = rows.slice(0, limit);
      const checked = new Set([`${row.source_id}/${row.source_version_id}`]);
      for (const item of page) for (const cell of Object.values(item.before ?? {})) {
        const key = `${cell.sourceRef.sourceId}/${cell.sourceRef.sourceVersionId}`;
        if (!checked.has(key)) { await readPinnedSource(tx, access, { sourceId: cell.sourceRef.sourceId, sourceVersionId: cell.sourceRef.sourceVersionId }); checked.add(key); }
      }
      if (!page.length) {
        const oversized = await tx.query(`SELECT 1 FROM material_import_rows WHERE import_id=$1 AND ordinal>$2 AND ($3::text IS NULL OR change=$3) LIMIT 1`, [row.id, after, change ?? null]);
        if (oversized.rowCount) throw materialError('rowSize', 'VALIDATION_FAILED');
      }
      const last = page.at(-1), hasMore = Boolean(last && (rows.length > limit || last.ordinal < last.last_candidate));
      return ImportPreviewSchema.parse({ viewer: viewer(access), collection: collectionDto(collection), canEdit: await canCorrect(tx, access, collection), import: importDto(row), rows: page.map((item) => ({ ordinal: item.ordinal, recordId: item.record_id, key: item.identity_key, label: item.label, change: item.change, issues: item.issues, cells: item.cells, before: item.before, excluded: item.excluded })), nextCursor: hasMore ? encodeCursor(scope, String(last!.ordinal)) : null });
    });
  }
  async function resolve(principal: IdentityPrincipal, operationId: string, importId: string, input: unknown) {
    const body = validate(ImportResolutionSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const { collection, row } = await authorizedImport(tx, access, importId, 'edit', true);
      await readPinnedSource(tx, access, { sourceId: row.source_id, sourceVersionId: row.source_version_id });
      return operation(tx, access, operationId, 'resolve-import', { importId, ...body }, async () => {
        assertRevision(collection, body.expectedRevision);
        if (row.status !== 'preview' || row.review_revision !== body.expectedReviewRevision || new Set(body.changes.map((item) => item.ordinal)).size !== body.changes.length) throw materialError('revision');
        const before = (await tx.query<StagedRow>('SELECT * FROM material_import_rows WHERE import_id=$1 AND ordinal=ANY($2::integer[]) ORDER BY ordinal FOR UPDATE', [row.id, body.changes.map((change) => change.ordinal)])).rows;
        if (before.length !== body.changes.length) throw materialError('notFound', 'NOT_FOUND');
        const after = before.map((existing) => {
          const change = body.changes.find((item) => item.ordinal === existing.ordinal)!;
          const cells = structuredClone(existing.cells);
          for (const [fieldId, rawValue] of Object.entries(change.values ?? {})) {
            const field = row.mapping.fields.find((candidate) => candidate.id === fieldId), old = cells[fieldId];
            if (!field || !old) throw materialError('field', 'VALIDATION_FAILED');
            cells[fieldId] = { ...old, sourceRawValue: old.sourceRawValue ?? old.rawValue, rawValue, value: normalizeValue(rawValue, field), reviewState: 'confirmed' };
          }
          const override = change.keyOverride === undefined ? existing.key_override : change.keyOverride;
          const key = override !== null ? { key: JSON.stringify([override]), hash: hashJson([override]) } : recordKey(cells, row.mapping);
          return { ...existing, cells, identity_key: key.key, identity_hash: key.hash, label: rowLabel(cells, row.mapping), row_hash: cellsHash(cells), issues: [...cellIssues(cells), ...(!key.hash ? ['key'] : [])], excluded: change.exclude ?? existing.excluded, key_override: override };
        });
        await tx.query(`UPDATE material_import_rows r SET cells=x.cells,identity_key=x.identity_key,identity_hash=x.identity_hash,label=x.label,row_hash=x.row_hash,issues=x.issues,excluded=x.excluded,key_override=x.key_override
          FROM jsonb_to_recordset($2::jsonb) x(ordinal integer,cells jsonb,identity_key text,identity_hash text,label text,row_hash text,issues jsonb,excluded boolean,key_override text) WHERE r.import_id=$1 AND r.ordinal=x.ordinal`, [row.id, JSON.stringify(after)]);
        row.review_revision++;
        await tx.query('INSERT INTO material_import_edits(id,import_id,revision,before_rows,after_rows,actor_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), row.id, row.review_revision, JSON.stringify(before), JSON.stringify(after), access.userId]);
        await tx.query('UPDATE material_imports SET review_revision=$2 WHERE id=$1', [row.id, row.review_revision]);
        await classify(tx, collection, row);
        return { viewer: viewer(access), import: importDto(row) };
      });
    });
  }
  async function apply(principal: IdentityPrincipal, operationId: string, importId: string, input: unknown) {
    const body = validate(ApplyImportSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const { collection, row } = await authorizedImport(tx, access, importId, 'edit', true);
      await readPinnedSource(tx, access, { sourceId: row.source_id, sourceVersionId: row.source_version_id });
      return operation(tx, access, operationId, 'apply-import', { importId, ...body }, async () => {
        if (row.status === 'applied') return { viewer: viewer(access), collection: collectionDto(collection), import: importDto(row) };
        assertRevision(collection, body.expectedRevision);
        if (row.status !== 'preview' || row.expected_revision !== collection.revision || row.review_revision !== body.expectedReviewRevision) throw materialError('revision');
        await classify(tx, collection, row);
        const needsReview = (await tx.query<{ present: boolean }>(`SELECT EXISTS(SELECT 1 FROM material_import_rows r CROSS JOIN LATERAL jsonb_each(r.cells) c WHERE r.import_id=$1 AND NOT r.excluded AND c.value->>'reviewState'='needs-review') AS present`, [row.id])).rows[0]!.present;
        if ((row.counts.ambiguous || row.counts.unknownCells || row.counts.excluded || needsReview) && !body.allowPartial) throw materialError('partial');
        const replace = row.mapping.importMode === 'replace-snapshot';
        if (replace && (!body.confirmCompleteSnapshot || row.counts.ambiguous || row.counts.excluded || row.counts.unknownCells || needsReview)) throw materialError('completeSnapshot');
        const mappingVersionId = randomUUID();
        await tx.query('INSERT INTO material_mapping_versions(id,workspace_id,collection_id,revision,mapping,created_by) VALUES($1,$2,$3,$4,$5,$6)', [mappingVersionId, body.workspaceId, collection.id, collection.revision + 1, JSON.stringify(row.mapping), access.userId]);
        const resolution = await createResolution(tx, access, collection, 'import', 'Import', { importId, mappingVersionId });
        // SQL applies the complete accepted set without materializing the dataset in Node or the browser.
        await tx.query(`INSERT INTO material_records(id,collection_id,identity_hash,identity_key,current_revision,missing,label,cells,row_hash)
          SELECT s.record_id,$2,s.identity_hash,s.identity_key,$3,false,s.label,
            (SELECT jsonb_object_agg(e.key,CASE WHEN old.cells->e.key->'value'=e.value->'value' AND old.cells->e.key->>'reviewState'=e.value->>'reviewState' THEN old.cells->e.key
              ELSE jsonb_set(jsonb_set(e.value,'{factRevision}',to_jsonb($3::int)),'{sourceRef}',(e.value->'sourceRef')||jsonb_build_object('collectionId',$2::text,'recordId',s.record_id::text,'fieldId',e.key,'factRevision',$3::int)) END) FROM jsonb_each(s.cells) e),s.row_hash
          FROM material_import_rows s LEFT JOIN material_records old ON old.collection_id=$2 AND old.id=s.record_id WHERE s.import_id=$1 AND NOT s.excluded AND s.change IN ('added','changed')
          ON CONFLICT(collection_id,identity_hash) DO UPDATE SET current_revision=EXCLUDED.current_revision,missing=false,label=EXCLUDED.label,cells=EXCLUDED.cells,row_hash=EXCLUDED.row_hash`, [row.id, collection.id, resolution.revision]);
        if (replace) await tx.query(`UPDATE material_records r SET missing=true,current_revision=$3 WHERE r.collection_id=$1 AND NOT r.missing AND NOT EXISTS(SELECT 1 FROM material_import_rows s WHERE s.import_id=$2 AND s.identity_hash=r.identity_hash AND NOT s.excluded)`, [collection.id, row.id, resolution.revision]);
        await tx.query(`INSERT INTO material_record_versions(id,collection_id,record_id,revision,resolution_id,missing,label,cells,row_hash)
          SELECT gen_random_uuid(),collection_id,id,current_revision,$3,missing,label,cells,row_hash FROM material_records WHERE collection_id=$1 AND current_revision=$2`, [collection.id, resolution.revision, resolution.id]);
        const updated = await finishResolution(tx, access, collection, resolution, 'import', row.mapping);
        row.status = 'applied'; row.applied_revision = resolution.revision;
        await tx.query("UPDATE material_imports SET status='applied',applied_revision=$2 WHERE id=$1", [row.id, resolution.revision]);
        return { viewer: viewer(access), collection: collectionDto(updated), import: importDto(row) };
      });
    });
  }
  async function undoResolve(principal: IdentityPrincipal, operationId: string, importId: string, input: unknown) {
    const body = validate(MaterialMutationSchema.extend({ expectedReviewRevision: z.number().int().positive() }), input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const { collection, row } = await authorizedImport(tx, access, importId, 'edit', true);
      return operation(tx, access, operationId, 'undo-import-decision', { importId, ...body }, async () => {
        assertRevision(collection, body.expectedRevision);
        if (row.status !== 'preview' || row.review_revision !== body.expectedReviewRevision) throw materialError('revision');
        const edit = (await tx.query<{ before_rows: StagedRow[]; after_rows: StagedRow[] }>('SELECT before_rows,after_rows FROM material_import_edits WHERE import_id=$1 AND revision=$2', [row.id, row.review_revision])).rows[0];
        if (!edit) throw materialError('notFound', 'NOT_FOUND');
        await tx.query(`UPDATE material_import_rows r SET cells=x.cells,identity_key=x.identity_key,identity_hash=x.identity_hash,label=x.label,row_hash=x.row_hash,issues=x.issues,excluded=x.excluded,key_override=x.key_override
          FROM jsonb_to_recordset($2::jsonb) x(ordinal integer,cells jsonb,identity_key text,identity_hash text,label text,row_hash text,issues jsonb,excluded boolean,key_override text) WHERE r.import_id=$1 AND r.ordinal=x.ordinal`, [row.id, JSON.stringify(edit.before_rows)]);
        row.review_revision++;
        await tx.query('INSERT INTO material_import_edits(id,import_id,revision,before_rows,after_rows,actor_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), row.id, row.review_revision, JSON.stringify(edit.after_rows), JSON.stringify(edit.before_rows), access.userId]);
        await tx.query('UPDATE material_imports SET review_revision=$2 WHERE id=$1', [row.id, row.review_revision]);
        await classify(tx, collection, row);
        return { viewer: viewer(access), import: importDto(row) };
      });
    });
  }
  async function cancel(principal: IdentityPrincipal, importId: string, input: unknown) {
    const body = validate(MaterialMutationSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const { row } = await authorizedImport(tx, access, importId, 'edit', true);
      if (row.status === 'applied') throw materialError('importState');
      await tx.query("UPDATE material_imports SET status='cancelled' WHERE id=$1", [row.id]); row.status = 'cancelled';
      return { viewer: viewer(access), import: importDto(row) };
    });
  }
  return { begin, advance, preview, resolve, undoResolve, apply, cancel };
}
