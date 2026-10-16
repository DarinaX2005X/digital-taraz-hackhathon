import type { PoolClient } from 'pg';
import type { SourceRef } from '@/contracts/artifacts';
import type { WorkspaceAccess } from '@/features/identity/server/access';
import { SourceFreshnessSchema, type SourceFreshness } from '@/features/artifacts/contracts';
import { readSourceFreshness } from '@/features/sources/server/source-heads';
import { readFactsInTransaction } from './facts';

const refKey = (ref: SourceRef) => [ref.sourceId, ref.sourceVersionId, ref.revision, ref.fragmentId, ref.collectionId, ref.recordId, ref.fieldId, ref.factRevision]
  .map((value) => value === undefined ? '-' : `${String(value).length}:${String(value)}`).join('|');

/** Combines the authorized source head with exact material fact state. Fact
 * lookups reuse the canonical material reader so ACL, historical value,
 * review state, missing records and current binding are evaluated once. */
export async function readMaterialSourceFreshness(tx: PoolClient, access: WorkspaceAccess, refs: readonly SourceRef[]): Promise<SourceFreshness[]> {
  const sourceFreshness = await readSourceFreshness(tx, access, refs);
  const factRefs = refs.filter((ref) => ref.factRevision !== undefined);
  const facts = [];
  for (let offset = 0; offset < factRefs.length; offset += 100) {
    facts.push(...(await readFactsInTransaction(tx, access, factRefs.slice(offset, offset + 100))).facts);
  }
  const factByRef = new Map(facts.map((fact) => [refKey(fact.requestedRef), fact]));
  return sourceFreshness.map((source) => {
    if (source.sourceRef.factRevision === undefined) return source;
    const fact = factByRef.get(refKey(source.sourceRef));
    const factStatus = fact?.state === 'current' && fact.canBind ? 'current'
      : fact?.state === 'stale' || fact?.state === 'missing' ? 'stale'
        : 'unknown';
    const status = source.sourceStatus === 'unknown' ? 'unknown'
      : source.sourceStatus === 'stale' || factStatus === 'stale' ? 'stale'
        : factStatus === 'current' ? 'current' : 'unknown';
    return SourceFreshnessSchema.parse({ ...source, status, factStatus });
  });
}
