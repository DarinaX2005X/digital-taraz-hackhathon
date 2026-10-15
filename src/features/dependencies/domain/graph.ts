import type { DependencyEdge, DependencyRef, DependencyTarget } from '../../../contracts/dependencies';
import { DependencyEdgeSchema } from '../../../contracts/dependencies';
import { dependencyTargetProperty } from '../../../contracts/dependency-edges';
import { ContentValidationError } from '../../artifacts/domain/canonical';

export const targetKey = (target: DependencyTarget): string => `artifact:${target.artifactId}:${target.targetElementId}:${dependencyTargetProperty(target)}`;
/** Source identity deliberately excludes a version; a missing record never binds by row position. */
export function dependencyKey(ref: DependencyRef): string {
  if (ref.kind === 'artifact') return targetKey(ref);
  const value = ref.sourceRef;
  return value.collectionId ? `fact:${value.collectionId}:${value.recordId}:${value.fieldId}` : `source:${value.sourceId}:${value.fragmentId ?? ''}`;
}

export interface CompiledDependencies { ordered: DependencyEdge[]; groupByEdge: Map<string, string>; outgoing: Map<string, DependencyEdge[]> }
export function compileDependencies(input: readonly DependencyEdge[]): CompiledDependencies {
  if (input.length > 1000) throw new ContentValidationError('dependency-graph-too-large');
  const edges = input.map((edge) => DependencyEdgeSchema.parse(edge));
  const byTarget = new Map<string, DependencyEdge>(), ids = new Set<string>(), outgoing = new Map<string, DependencyEdge[]>();
  for (const edge of edges) {
    const key = targetKey(edge.target);
    if (byTarget.has(key) || ids.has(edge.id)) throw new ContentValidationError('duplicate-dependency-target');
    byTarget.set(key, edge); ids.add(edge.id);
    for (const item of edge.inputs) outgoing.set(dependencyKey(item.ref), [...outgoing.get(dependencyKey(item.ref)) ?? [], edge]);
  }
  // Kahn's algorithm is bounded and avoids recursion on an imported long chain.
  const indegrees = new Map(edges.map((edge) => [edge.id, new Set(edge.inputs.map((item) => byTarget.get(dependencyKey(item.ref))?.id).filter(Boolean)).size]));
  const queue = edges.filter((edge) => indegrees.get(edge.id) === 0).sort((a, b) => a.id.localeCompare(b.id));
  const ordered: DependencyEdge[] = [];
  for (let i = 0; i < queue.length; i++) {
    const edge = queue[i]!; ordered.push(edge);
    for (const next of new Set(outgoing.get(targetKey(edge.target)) ?? [])) {
      const degree = indegrees.get(next.id)! - 1; indegrees.set(next.id, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (ordered.length !== edges.length) throw new ContentValidationError('dependency-cycle');
  // A causal component cannot accept a total while declining a contributing line.
  const parent = new Map(edges.map((edge) => [edge.id, edge.id]));
  const root = (id: string): string => { let current = id; while (parent.get(current) !== current) current = parent.get(current)!; return current; };
  const join = (a: string, b: string) => { const left = root(a), right = root(b); if (left !== right) parent.set(left > right ? left : right, left > right ? right : left); };
  for (const linked of outgoing.values()) for (const edge of linked.slice(1)) join(linked[0]!.id, edge.id);
  for (const edge of edges) for (const item of edge.inputs) { const upstream = byTarget.get(dependencyKey(item.ref)); if (upstream) join(edge.id, upstream.id); }
  return { ordered, outgoing, groupByEdge: new Map(edges.map((edge) => [edge.id, root(edge.id)])) };
}

export function affectedDependencies(edges: readonly DependencyEdge[], changed: readonly DependencyRef[]): DependencyEdge[] {
  const graph = compileDependencies(edges), pending = changed.map(dependencyKey), seen = new Set<string>();
  for (let i = 0; i < pending.length; i++) for (const edge of graph.outgoing.get(pending[i]!) ?? []) {
    if (!seen.has(edge.id)) { seen.add(edge.id); pending.push(targetKey(edge.target)); }
  }
  return graph.ordered.filter((edge) => seen.has(edge.id));
}
