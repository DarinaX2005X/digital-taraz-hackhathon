import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { SourceRefSchema, type SourceRef } from '@/contracts/artifacts';
import { BoundFactsSchema, FactReadSchema, MaterialCellSchema, type BoundFact, type MaterialCell } from '@/contracts/materials';
import { withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '@/features/identity/server/access';
import { IdentityError, validate } from '@/features/identity/server/http';
import { readPinnedSource } from '@/features/sources/server/pinned-source';
import { readSourceFreshness } from '@/features/sources/server/source-heads';
import { authorizedCollection, canCorrect, type CollectionRow } from './support';

const sameRef = (a: SourceRef, b: SourceRef) => a.sourceId === b.sourceId && a.sourceVersionId === b.sourceVersionId && a.revision === b.revision
  && a.collectionId === b.collectionId && a.recordId === b.recordId && a.fieldId === b.fieldId && a.factRevision === b.factRevision;
const unavailable = (error: unknown) => error instanceof IdentityError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code);

/** Caller holds current actor/workspace authorization in the same transaction. No content is returned for an inaccessible ref. */
export async function readFactsInTransaction(tx: PoolClient, access: WorkspaceAccess, rawRefs: readonly SourceRef[]) {
  const refs = validate(z.array(SourceRefSchema).min(1).max(100), rawRefs);
  const collections = new Map<string, CollectionRow | null>();
  for (const id of [...new Set(refs.flatMap((ref) => ref.collectionId ? [ref.collectionId] : []))].sort()) {
    try { collections.set(id, await authorizedCollection(tx, access, id, 'read')); }
    catch (error) { if (!unavailable(error)) throw error; collections.set(id, null); }
  }
  const facts: BoundFact[] = [];
  for (const ref of refs) {
    const unknown: BoundFact = { requestedRef: ref, state: 'unknown', canBind: false, canCorrect: false };
    const collection = ref.collectionId ? collections.get(ref.collectionId) : null;
    if (!collection || !ref.recordId || !ref.fieldId || ref.factRevision === undefined) { facts.push(unknown); continue; }
    try {
      const source = await readPinnedSource(tx, access, { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId });
      if (source.sourceRef.revision !== ref.revision) { facts.push(unknown); continue; }
      const old = (await tx.query<{ cell: unknown; label: string; missing: boolean }>(`SELECT cells->$3::text AS cell,label,missing FROM material_record_versions
        WHERE collection_id=$1 AND record_id=$2 AND (cells->$3::text->>'factRevision')::int=$4 ORDER BY revision DESC LIMIT 1`, [collection.id, ref.recordId, ref.fieldId, ref.factRevision])).rows[0];
      const parsed = MaterialCellSchema.safeParse(old?.cell);
      if (!old || !parsed.success || !sameRef(ref, parsed.data.sourceRef)) { facts.push(unknown); continue; }
      const latest = (await tx.query<{ cell: unknown; label: string; missing: boolean }>('SELECT cells->$3::text AS cell,label,missing FROM material_records WHERE collection_id=$1 AND id=$2', [collection.id, ref.recordId, ref.fieldId])).rows[0];
      const current = MaterialCellSchema.safeParse(latest?.cell);
      // Resolve the latest source separately: the old source may still be readable after a newer confidential source loses access.
      if (current.success) await readPinnedSource(tx, access, { sourceId: current.data.sourceRef.sourceId, sourceVersionId: current.data.sourceRef.sourceVersionId });
      const mapping = (await tx.query<{ label: string }>(`SELECT f->>'label' AS label FROM material_mapping_versions m CROSS JOIN LATERAL jsonb_array_elements(m.mapping->'fields') f
        WHERE m.collection_id=$1 AND m.revision<=$2 AND f->>'id'=$3 ORDER BY m.revision DESC LIMIT 1`, [collection.id, ref.factRevision, ref.fieldId])).rows[0];
      const missing = !latest || latest.missing || !current.success;
      const state = missing ? 'missing' : sameRef(ref, current.data.sourceRef) ? 'current' : 'stale';
      const editable = await canCorrect(tx, access, collection);
      const pinned: MaterialCell & { labels: { collection: string; record: string; field: string } } = { ...parsed.data, labels: { collection: collection.title, record: old.label, field: mapping?.label ?? ref.fieldId } };
      facts.push({ requestedRef: ref, state, pinned, ...(current.success && !missing ? { currentSourceRef: current.data.sourceRef } : {}), canBind: state === 'current' && parsed.data.value.kind !== 'unknown' && parsed.data.reviewState !== 'needs-review', canCorrect: editable && !missing });
    } catch (error) { if (!unavailable(error)) throw error; facts.push(unknown); }
  }
  return BoundFactsSchema.parse({ facts });
}

export function createMaterialFactReader(pool: Pool) {
  return {
    async read(principal: IdentityPrincipal, input: unknown) {
      const body = validate(FactReadSchema, input);
      return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => ({ ...await readFactsInTransaction(tx, access, body.refs), sourceFreshness: await readSourceFreshness(tx, access, body.refs) }));
    },
  };
}
