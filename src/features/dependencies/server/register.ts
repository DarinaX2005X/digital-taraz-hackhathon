import type { PoolClient } from 'pg';
import { DependencyGraphSchema, type DependencyGraph } from '../../../contracts/dependencies';
import type { DependencyEdge, DependencyTarget } from '../../../contracts/dependency-edges';
import { ArtifactConflict, authorizeProject, requireActiveProject, sourceVector } from '../../artifacts/server/service-support';
import type { WorkspaceAccess } from '../../identity/server/access';
import { compileDependencies, targetKey } from '../domain/graph';
import { artifactDraft } from '../domain/proposal';
import { graphSourceRefs, loadDependencyArtifacts } from './snapshot';
type ReadInput = {workspaceId: string; projectId: string};

export async function graphLock(tx: PoolClient, workspaceId: string, projectId: string) { await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`dependencies:${workspaceId}:${projectId}`]); }
export async function readGraph(tx: PoolClient, body: ReadInput): Promise<DependencyGraph> {
  const row = (await tx.query<{ revision: number; edges: DependencyGraph['edges'] }>('SELECT revision,edges FROM dependency_graphs WHERE workspace_id=$1 AND project_id=$2', [body.workspaceId, body.projectId])).rows[0];
  return DependencyGraphSchema.parse({ ...body, revision: row?.revision ?? 0, edges: row?.edges ?? [] });
}
export async function registerEdgesInTransaction(tx: PoolClient, access: WorkspaceAccess, input: { projectId: string; expectedGraphRevision?: number; edges: DependencyEdge[]; removeTargets?: DependencyTarget[] }) {
  const body = { ...input, workspaceId: access.workspace.id };
  await authorizeProject(tx, access, body.projectId, 'edit');
  await graphLock(tx, body.workspaceId, body.projectId);
  await requireActiveProject(tx, access, body.projectId);
  const current = await readGraph(tx, { workspaceId: body.workspaceId, projectId: body.projectId });
  if (body.expectedGraphRevision !== undefined && body.expectedGraphRevision !== current.revision) throw new ArtifactConflict();
  for (const edge of body.edges) {
    const existing = current.edges.find((item) => item.id === edge.id);
    if (existing && targetKey(existing.target) !== targetKey(edge.target)) throw new ArtifactConflict();
  }
  const removed = new Set([...(body.removeTargets ?? []), ...body.edges.map((edge) => edge.target)].map(targetKey));
  const merged = new Map(current.edges.filter((edge) => !removed.has(targetKey(edge.target))).map((edge) => [edge.id, edge]));
  for (const edge of body.edges) merged.set(edge.id, edge);
  const graph = DependencyGraphSchema.parse({ ...current, revision: current.revision + 1, edges: [...merged.values()] });
  compileDependencies(graph.edges);
  const artifacts = await loadDependencyArtifacts(tx, access, graph, true), drafts = new Map(artifacts.map((artifact) => [artifact.id, artifactDraft(artifact)]));
  for (const edge of body.edges) {
    if (!await drafts.get(edge.target.artifactId)?.target(edge.target.targetElementId)) throw new ArtifactConflict();
    for (const { ref } of edge.inputs) if (ref.kind === 'artifact' && !await drafts.get(ref.artifactId)?.target(ref.targetElementId)) throw new ArtifactConflict();
  }
  if (!await sourceVector(tx, access, graphSourceRefs(graph, artifacts))) throw new ArtifactConflict();
  await tx.query('INSERT INTO dependency_graphs(workspace_id,project_id,revision,edges,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,project_id) DO UPDATE SET revision=EXCLUDED.revision,edges=EXCLUDED.edges,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()', [body.workspaceId, body.projectId, graph.revision, JSON.stringify(graph.edges), access.userId]);
  return graph;
}
