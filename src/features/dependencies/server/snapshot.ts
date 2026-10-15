import type { PoolClient } from 'pg';
import type { SourceRef } from '../../../contracts/artifacts';
import type { DependencyGraph } from '../../../contracts/dependencies';
import type { BoundFact } from '../../../contracts/materials';
import { collectSourceRefs } from '../../artifacts/domain/content-state';
import { ArtifactConflict, loadArtifact, loadState, missingTargets, sourceVector } from '../../artifacts/server/service-support';
import type { WorkspaceAccess } from '../../identity/server/access';
import { readFactsInTransaction } from '../../materials/server/facts';
import { dependencyKey } from '../domain/graph';
import { buildDependencyProposal, type DependencyArtifact, type DependencyFact } from '../domain/proposal';
import { materialScalar } from '../domain/transforms';

export async function loadDependencyArtifacts(tx: PoolClient, access: WorkspaceAccess, graph: DependencyGraph, editTargets = false): Promise<DependencyArtifact[]> {
  const targets = new Set(graph.edges.map((edge) => edge.target.artifactId));
  const ids = new Set([...targets, ...graph.edges.flatMap((edge) => edge.inputs.flatMap(({ ref }) => ref.kind === 'artifact' ? [ref.artifactId] : []))]);
  const artifacts: DependencyArtifact[] = [];
  for (const id of [...ids].sort()) {
    const { row } = await loadArtifact(tx, access, id, { expectedProjectId: graph.projectId, scope: editTargets && targets.has(id) ? 'edit' : 'read', lock: editTargets });
    if (targets.has(id) && ['archived', 'trashed'].includes(row.status)) throw new ArtifactConflict();
    const { state } = await loadState(tx, row);
    artifacts.push({ id, title: row.title, revision: row.current_revision, content: state.content, sourceRefs: collectSourceRefs(state), bindings: Object.values(state.bindings), locks: state.locks, missingTargets: missingTargets(state) });
  }
  return artifacts;
}
async function batchFacts(tx: PoolClient, access: WorkspaceAccess, refs: SourceRef[]): Promise<BoundFact[]> {
  const results: BoundFact[] = [];
  for (let offset = 0; offset < refs.length; offset += 100) results.push(...(await readFactsInTransaction(tx, access, refs.slice(offset, offset + 100))).facts);
  return results;
}
export function graphSourceRefs(graph: DependencyGraph, artifacts: readonly DependencyArtifact[]): SourceRef[] {
  const refs = [...artifacts.flatMap((artifact) => artifact.sourceRefs), ...graph.edges.flatMap((edge) => edge.inputs.flatMap(({ ref }) => ref.kind === 'source' ? [ref.sourceRef] : []))];
  return [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()];
}
export async function loadDependencySnapshot(tx: PoolClient, access: WorkspaceAccess, graph: DependencyGraph, at: string, editTargets = false) {
  const artifacts = await loadDependencyArtifacts(tx, access, graph, editTargets);
  const refs = graphSourceRefs(graph, artifacts);
  const pinned = await batchFacts(tx, access, refs.filter((ref) => ref.collectionId));
  const current = await batchFacts(tx, access, pinned.flatMap((fact) => fact.currentSourceRef ? [fact.currentSourceRef] : []));
  const byKey = new Map(current.map((fact) => [dependencyKey({ kind: 'source', sourceRef: fact.requestedRef }), fact]));
  const facts: DependencyFact[] = pinned.map((old) => {
    const key = dependencyKey({ kind: 'source', sourceRef: old.requestedRef });
    const fact = byKey.get(key) ?? old;
    if (fact.state !== 'current' || !fact.canBind || !fact.pinned) return { key, state: fact.state === 'missing' ? 'missing' : 'unknown' };
    return { key, state: 'current', value: materialScalar(fact.pinned.value), materialValue: fact.pinned.value, sourceRef: fact.pinned.sourceRef };
  });
  const vector = await sourceVector(tx, access, [...refs, ...facts.flatMap((fact) => fact.sourceRef ? [fact.sourceRef] : [])]);
  if (!vector) throw new ArtifactConflict();
  const proposal = await buildDependencyProposal({ edges: graph.edges, artifacts, facts, graphRevision: graph.revision, expectedSourceRevisions: vector, actorId: access.userId, at });
  return { artifacts, proposal };
}
