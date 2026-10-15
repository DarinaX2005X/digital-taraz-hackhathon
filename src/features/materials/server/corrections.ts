import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { CorrectionPreviewSchema, MaterialMutationSchema, type MaterialCell } from '@/contracts/materials';
import { IdSchema } from '@/contracts/primitives';
import { withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '@/features/identity/server/access';
import { validate } from '@/features/identity/server/http';
import { readPinnedSource } from '@/features/sources/server/pinned-source';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { cellsHash, normalizeValue, rowLabel } from '../domain/mapping';
import { assertRevision, authorizedCollection, collectionDto, createResolution, finishResolution, materialError, operation, viewer, type CollectionRow, type RecordRow } from './support';

const ApplySchema = CorrectionPreviewSchema.extend({ previewHash: z.string().length(64) });
const UndoSchema = MaterialMutationSchema.extend({ resolutionId: IdSchema, reason: z.string().trim().min(1).max(1000) });
type Change = z.infer<typeof CorrectionPreviewSchema>['changes'][number];
async function prepare(tx: PoolClient, access: WorkspaceAccess, collection: CollectionRow, changes: Change[]) {
  if (!collection.mapping || new Set(changes.map((change) => `${change.recordId}/${change.fieldId}`)).size !== changes.length) throw materialError('field', 'VALIDATION_FAILED');
  const records = (await tx.query<RecordRow>('SELECT * FROM material_records WHERE collection_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [collection.id, [...new Set(changes.map((change) => change.recordId))]])).rows;
  const preview = [];
  for (const change of changes) {
    const record = records.find((item) => item.id === change.recordId), field = collection.mapping.fields.find((item) => item.id === change.fieldId), before = record?.cells[change.fieldId];
    if (!record || record.missing || !field || !before) throw materialError('notFound', 'NOT_FOUND');
    await readPinnedSource(tx, access, { sourceId: before.sourceRef.sourceId, sourceVersionId: before.sourceRef.sourceVersionId });
    const value = normalizeValue(change.rawValue, field);
    if (value.kind === 'unknown') throw materialError('invalidValue', 'VALIDATION_FAILED');
    const after: MaterialCell = { ...before, value, sourceRawValue: before.sourceRawValue ?? before.rawValue, rawValue: change.rawValue, reviewState: 'confirmed', factRevision: collection.revision + 1, sourceRef: { ...before.sourceRef, factRevision: collection.revision + 1 } };
    preview.push({ recordId: record.id, fieldId: field.id, recordLabel: record.label, fieldLabel: field.label, reason: change.reason, before, after });
  }
  return { records, changes: preview, previewHash: hashJson({ collectionId: collection.id, revision: collection.revision, changes: preview }) };
}
export function createCorrectionService(pool: Pool) {
  async function preview(principal: IdentityPrincipal, collectionId: string, input: unknown) {
    const body = validate(CorrectionPreviewSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, collectionId, 'edit', true); assertRevision(collection, body.expectedRevision);
      const result = await prepare(tx, access, collection, body.changes);
      return { viewer: viewer(access), collection: collectionDto(collection), changes: result.changes, previewHash: result.previewHash };
    });
  }
  async function apply(principal: IdentityPrincipal, operationId: string, collectionId: string, input: unknown) {
    const body = validate(ApplySchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, collectionId, 'edit', true);
      return operation(tx, access, operationId, 'correct', { collectionId, ...body }, async () => {
        assertRevision(collection, body.expectedRevision);
        const prepared = await prepare(tx, access, collection, body.changes);
        if (prepared.previewHash !== body.previewHash) throw materialError('revision');
        const resolution = await createResolution(tx, access, collection, 'correction', [...new Set(body.changes.map((change) => change.reason))].join('\n'));
        for (const record of prepared.records) {
          const cells = { ...record.cells };
          for (const change of prepared.changes.filter((item) => item.recordId === record.id)) cells[change.fieldId] = change.after;
          await tx.query('UPDATE material_records SET cells=$3,row_hash=$4,label=$5,current_revision=$6 WHERE collection_id=$1 AND id=$2', [collection.id, record.id, JSON.stringify(cells), cellsHash(cells), rowLabel(cells, collection.mapping!), resolution.revision]);
        }
        await versionRecords(tx, collection.id, resolution);
        return { viewer: viewer(access), collection: collectionDto(await finishResolution(tx, access, collection, resolution, 'correction')), resolutionId: resolution.id };
      });
    });
  }
  async function undo(principal: IdentityPrincipal, operationId: string, collectionId: string, input: unknown) {
    const body = validate(UndoSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit', expectedAuthzVersion: body.expectedAuthzVersion }, async (tx, access) => {
      const collection = await authorizedCollection(tx, access, collectionId, 'edit', true);
      return operation(tx, access, operationId, 'undo', { collectionId, ...body }, async () => {
        assertRevision(collection, body.expectedRevision);
        const previous = (await tx.query<{ revision: number }>('SELECT revision FROM material_resolutions WHERE collection_id=$1 AND id=$2', [collection.id, body.resolutionId])).rows[0];
        if (!previous || previous.revision !== collection.revision) throw materialError('revision');
        // Recheck every source used by the result before restoring its facts. A later ACL change cannot be bypassed through history.
        const refs = (await tx.query<{ source_id: string; version_id: string }>(`SELECT DISTINCT e.value->'sourceRef'->>'sourceId' AS source_id,e.value->'sourceRef'->>'sourceVersionId' AS version_id
          FROM material_records r JOIN LATERAL (SELECT cells FROM material_record_versions v WHERE v.collection_id=r.collection_id AND v.record_id=r.id AND v.revision<$2 ORDER BY revision DESC LIMIT 1) old ON true
          CROSS JOIN LATERAL jsonb_each(old.cells) e WHERE r.collection_id=$1 AND r.current_revision=$2`, [collection.id, collection.revision])).rows;
        for (const ref of refs) await readPinnedSource(tx, access, { sourceId: ref.source_id, sourceVersionId: ref.version_id });
        const resolution = await createResolution(tx, access, collection, 'undo', body.reason, { undoOf: body.resolutionId });
        await tx.query(`UPDATE material_records r SET current_revision=$3,missing=COALESCE(old.missing,true),label=COALESCE(old.label,r.label),row_hash=COALESCE(old.row_hash,r.row_hash),
          cells=CASE WHEN old.cells IS NULL THEN r.cells ELSE (SELECT jsonb_object_agg(e.key,jsonb_set(jsonb_set(e.value,'{factRevision}',to_jsonb($3::int)),'{sourceRef}',(e.value->'sourceRef')||jsonb_build_object('factRevision',$3::int))) FROM jsonb_each(old.cells) e) END
          FROM material_records target LEFT JOIN LATERAL (SELECT v.* FROM material_record_versions v WHERE v.collection_id=target.collection_id AND v.record_id=target.id AND v.revision<$2 ORDER BY v.revision DESC LIMIT 1) old ON true
          WHERE target.collection_id=$1 AND target.current_revision=$2 AND r.id=target.id`, [collection.id, collection.revision, resolution.revision]);
        await versionRecords(tx, collection.id, resolution);
        const oldMapping = (await tx.query<{ mapping: CollectionRow['mapping'] }>('SELECT mapping FROM material_mapping_versions WHERE collection_id=$1 AND revision<$2 ORDER BY revision DESC LIMIT 1', [collection.id, collection.revision])).rows[0]?.mapping ?? collection.mapping;
        if (oldMapping) await tx.query('INSERT INTO material_mapping_versions(id,workspace_id,collection_id,revision,mapping,created_by) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)', [access.workspace.id, collection.id, resolution.revision, JSON.stringify(oldMapping), access.userId]);
        return { viewer: viewer(access), collection: collectionDto(await finishResolution(tx, access, collection, resolution, 'undo', oldMapping ?? undefined)), resolutionId: resolution.id };
      });
    });
  }
  return { preview, apply, undo };
}
async function versionRecords(tx: PoolClient, collectionId: string, resolution: { id: string; revision: number }) {
  await tx.query(`INSERT INTO material_record_versions(id,collection_id,record_id,revision,resolution_id,missing,label,cells,row_hash)
    SELECT gen_random_uuid(),collection_id,id,current_revision,$3,missing,label,cells,row_hash FROM material_records WHERE collection_id=$1 AND current_revision=$2`, [collectionId, resolution.revision, resolution.id]);
}
