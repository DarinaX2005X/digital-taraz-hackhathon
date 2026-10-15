import type { PoolClient } from 'pg';
import type { DependencyEdge, DependencyTarget } from '../../../contracts/dependency-edges';
import { hashJson } from '../../artifacts/domain/canonical';
import type { JsonValue } from '../../artifacts/domain/content-models';
import { ArtifactConflict, authorizeProject } from '../../artifacts/server/service-support';
import type { WorkspaceAccess } from '../../identity/server/access';
import { targetKey } from '../domain/graph';
import { graphLock, readGraph, registerEdgesInTransaction } from './register';

interface Effect { target: DependencyTarget; before: DependencyEdge | null; after: DependencyEdge | null }
interface EffectRow { project_id: string; effects: Effect[] }
const same = (left: unknown, right: unknown) => hashJson(left as JsonValue) === hashJson(right as JsonValue);
async function loadEffects(tx: PoolClient, workspaceId: string, groupId: string): Promise<EffectRow[]> {
  return (await tx.query<EffectRow>('SELECT project_id,effects FROM dependency_command_effects WHERE workspace_id=$1 AND command_group_id=$2 ORDER BY project_id', [workspaceId, groupId])).rows;
}
export async function dependencyEffectProjectIds(tx: PoolClient, workspaceId: string, targetCommandGroupId: string): Promise<string[]> {
  return (await loadEffects(tx, workspaceId, targetCommandGroupId)).map((row) => row.project_id);
}
async function saveEffects(tx: PoolClient, access: WorkspaceAccess, commandGroupId: string, projectId: string, effects: Effect[]) {
  if (!effects.length) return;
  await tx.query('INSERT INTO dependency_command_effects(workspace_id,command_group_id,project_id,effects) VALUES($1,$2,$3,$4)', [access.workspace.id, commandGroupId, projectId, JSON.stringify(effects)]);
}
export async function applyDependencyEffectsInTransaction(tx: PoolClient, access: WorkspaceAccess, input: { commandGroupId: string; projects: Array<{ projectId: string; edges: DependencyEdge[]; removeTargets?: DependencyTarget[] }> }) {
  const projects = [...input.projects].sort((a, b) => a.projectId.localeCompare(b.projectId));
  if (new Set(projects.map((project) => project.projectId)).size !== projects.length) throw new ArtifactConflict();
  for (const project of projects) await graphLock(tx, access.workspace.id, project.projectId);
  for (const project of projects) {
    const before = await readGraph(tx, { workspaceId: access.workspace.id, projectId: project.projectId });
    const after = await registerEdgesInTransaction(tx, access, project);
    const keys = new Map([...(project.removeTargets ?? []), ...project.edges.map((edge) => edge.target)].map((target) => [targetKey(target), target]));
    const old = new Map(before.edges.map((edge) => [targetKey(edge.target), edge])), next = new Map(after.edges.map((edge) => [targetKey(edge.target), edge]));
    const effects: Effect[] = [...keys].map(([key, target]) => ({ target, before: old.get(key) ?? null, after: next.get(key) ?? null })).filter((effect) => !same(effect.before, effect.after));
    await saveEffects(tx, access, input.commandGroupId, project.projectId, effects);
  }
}
export async function canReplayDependencyEffects(tx: PoolClient, access: WorkspaceAccess, targetCommandGroupId: string, action: 'undo' | 'redo'): Promise<boolean> {
  for (const row of await loadEffects(tx, access.workspace.id, targetCommandGroupId)) {
    await authorizeProject(tx, access, row.project_id, 'read');
    const graph = await readGraph(tx, { workspaceId: access.workspace.id, projectId: row.project_id });
    const current = new Map(graph.edges.map((edge) => [targetKey(edge.target), edge]));
    if (row.effects.some((effect) => !same(current.get(targetKey(effect.target)) ?? null, action === 'undo' ? effect.after : effect.before))) return false;
  }
  return true;
}
export async function historyDependencyEffectsInTransaction(tx: PoolClient, access: WorkspaceAccess, input: { commandGroupId: string; targetCommandGroupId: string; action: 'undo' | 'redo' }) {
  const rows = await loadEffects(tx, access.workspace.id, input.targetCommandGroupId);
  for (const row of rows) await graphLock(tx, access.workspace.id, row.project_id);
  if (!await canReplayDependencyEffects(tx, access, input.targetCommandGroupId, input.action)) throw new ArtifactConflict();
  for (const row of rows) {
    const effects = row.effects.map((effect) => input.action === 'undo' ? { ...effect, before: effect.after, after: effect.before } : effect);
    await registerEdgesInTransaction(tx, access, { projectId: row.project_id, edges: effects.flatMap((effect) => effect.after ? [effect.after] : []), removeTargets: effects.map((effect) => effect.target) });
    await saveEffects(tx, access, input.commandGroupId, row.project_id, effects);
  }
}
