import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { CommandGroupInputSchema } from '../../../contracts/commands';
import { ChangeSetSchema, DependencyReadSchema, PrepareChangesSchema, RegisterDependenciesSchema, ReviewChangesSchema, type ChangeSet, type DependencyGraph } from '../../../contracts/dependencies';
import { IdSchema } from '../../../contracts/primitives';
import { hashJson } from '../../artifacts/domain/canonical';
import type { JsonValue } from '../../artifacts/domain/content-models';
import { createArtifactService } from '../../artifacts/server/service';
import { ArtifactConflict, assertMutationEpoch, loadArtifact, notFound, requireActiveProject, sourceVector } from '../../artifacts/server/service-support';
import { identityTransaction, withWorkspaceAccessInTransaction, type IdentityPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { validate } from '../../identity/server/http';
import { ChangeSetListInputSchema, ChangeSetListResultSchema } from '../../change-review/contracts';
import { PrepareWorkChangesInputSchema, type PrepareWorkChangesInput, type PrepareWorkChangesResult, type WorkExecutionContext } from '../../../contracts/business-work';
import { commandsForProposal, selectableGroups } from '../domain/proposal';
import { graphSourceRefs, loadDependencyArtifacts, loadDependencySnapshot } from './snapshot';
import { graphLock, readGraph, registerEdgesInTransaction } from './register';

export const BindDependenciesSchema = RegisterDependenciesSchema.extend({ group: CommandGroupInputSchema });
type ReadInput = z.input<typeof DependencyReadSchema>;
const ChangeCursorSchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema, authzVersion: z.number().int().positive(),
  createdAt: z.string().datetime(), id: IdSchema,
});
const PrepareWorkChangesRequestSchema = PrepareWorkChangesInputSchema.extend({ workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive() });
interface ChangeRow { id: string; workspace_id: string; project_id: string; created_by: string; created_at: Date; revision: number; state: ChangeSet['state']; proposal: ChangeSet['proposal']; accepted_group_ids: string[]; rejected_group_ids: string[]; command_group_id: string | null }
function changeDto(row: ChangeRow): ChangeSet { return ChangeSetSchema.parse({ id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, createdBy: row.created_by, createdAt: row.created_at.toISOString(), revision: row.revision, state: row.state, proposal: row.proposal, acceptedGroupIds: row.accepted_group_ids, rejectedGroupIds: row.rejected_group_ids, ...(row.command_group_id ? { commandGroupId: row.command_group_id } : {}) }); }
async function loadChange(tx: PoolClient, body: ReadInput, id: string) {
  const row = (await tx.query<ChangeRow>('SELECT * FROM dependency_changesets WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE', [body.workspaceId, body.projectId, id])).rows[0];
  if (!row) throw notFound(); return changeDto(row);
}
const digest = (value: unknown) => hashJson(value as JsonValue);
async function replay<T>(tx: PoolClient, access: WorkspaceAccess, operationId: string, operation: string, body: unknown): Promise<T | undefined> {
  validate(IdSchema, operationId);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`dependency-operation:${access.workspace.id}:${operationId}`]);
  const row = (await tx.query<{ operation: string; body_hash: string; result: T }>('SELECT operation,body_hash,result FROM dependency_operations WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3', [access.workspace.id, access.userId, operationId])).rows[0];
  if (row && (row.operation !== operation || row.body_hash !== digest(body))) throw new ArtifactConflict();
  return row?.result;
}
async function save(tx: PoolClient, access: WorkspaceAccess, operationId: string, operation: string, body: unknown, result: unknown) {
  await tx.query('INSERT INTO dependency_operations(workspace_id,actor_id,operation_id,operation,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [access.workspace.id, access.userId, operationId, operation, digest(body), JSON.stringify(result)]);
}
async function authorizeGraph(tx: PoolClient, access: WorkspaceAccess, graph: DependencyGraph) {
  const artifacts = await loadDependencyArtifacts(tx, access, graph);
  if (!await sourceVector(tx, access, graphSourceRefs(graph, artifacts))) throw new ArtifactConflict();
  return artifacts;
}
async function authorizeProposal(tx: PoolClient, access: WorkspaceAccess, value: ChangeSet) {
  for (const artifactId of Object.keys(value.proposal.expectedArtifactRevisions).sort()) await loadArtifact(tx, access, artifactId, { expectedProjectId: value.projectId });
  if (!await sourceVector(tx, access, value.proposal.sourceRefs)) throw notFound();
}
export function createDependencyService(pool: Pool) {
  const artifacts = createArtifactService(pool);
  async function registerInTransaction(tx: PoolClient, principal: IdentityPrincipal, operationId: string, input: z.input<typeof RegisterDependenciesSchema>) {
    const body = validate(RegisterDependenciesSchema, input);
    return withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'edit' }, async (tx, access) => {
      const previous = await replay<DependencyGraph>(tx, access, operationId, 'register', body);
      await graphLock(tx, body.workspaceId, body.projectId);
      if (previous) { await authorizeGraph(tx, access, previous); return previous; }
      assertMutationEpoch(access, body.expectedAuthzVersion);
      const graph = await registerEdgesInTransaction(tx, access, body); await save(tx, access, operationId, 'register', body, graph); return graph;
    });
  }
  async function read(principal: IdentityPrincipal, input: ReadInput) {
    const body = validate(DependencyReadSchema, input);
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { ...body, scope: 'read' }, async (tx, access) => {
      await graphLock(tx, body.workspaceId, body.projectId); const graph = await readGraph(tx, body); await authorizeGraph(tx, access, graph); return graph;
    }));
  }
  async function bind(principal: IdentityPrincipal, operationId: string, input: z.input<typeof BindDependenciesSchema>) {
    const body = validate(BindDependenciesSchema, input);
    if (operationId !== body.group.commandGroupId) throw new ArtifactConflict();
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'edit' }, async (tx, access) => {
      const previous = await replay<{ receipt: Awaited<ReturnType<typeof artifacts.apply>>; graph: DependencyGraph }>(tx, access, operationId, 'bind', body);
      await graphLock(tx, body.workspaceId, body.projectId);
      if (previous) { await authorizeGraph(tx, access, previous.graph); return previous; }
      assertMutationEpoch(access, body.expectedAuthzVersion);
      const before = await readGraph(tx, { workspaceId: body.workspaceId, projectId: body.projectId });
      if (body.expectedGraphRevision !== undefined && body.expectedGraphRevision !== before.revision) throw new ArtifactConflict();
      // The same transaction and canonical history own the actual content mutation.
      const receipt = await artifacts.applyInTransaction(tx, principal, { workspaceId: body.workspaceId, expectedAuthzVersion: body.expectedAuthzVersion, group: { ...body.group, dependencyEdges: body.edges } });
      const graph = await readGraph(tx, { workspaceId: body.workspaceId, projectId: body.projectId }), result = { receipt, graph };
      await save(tx, access, operationId, 'bind', body, result); return result;
    }));
  }
  async function prepare(principal: IdentityPrincipal, operationId: string, input: z.input<typeof PrepareChangesSchema>) {
    const body = validate(PrepareChangesSchema, input);
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'edit' }, async (tx, access) => {
      const previous = await replay<ChangeSet>(tx, access, operationId, 'prepare', body);
      await graphLock(tx, body.workspaceId, body.projectId);
      const graph = await readGraph(tx, { workspaceId: body.workspaceId, projectId: body.projectId });
      if (previous) { await authorizeProposal(tx, access, previous); return previous; }
      assertMutationEpoch(access, body.expectedAuthzVersion); await requireActiveProject(tx, access, body.projectId);
      const id = randomUUID(), at = new Date().toISOString();
      const { proposal } = await loadDependencySnapshot(tx, access, graph, at);
      const row = (await tx.query<ChangeRow>("INSERT INTO dependency_changesets(id,workspace_id,project_id,created_by,created_at,state,proposal) VALUES($1,$2,$3,$4,$5,'ready',$6) RETURNING *", [id, body.workspaceId, body.projectId, access.userId, at, JSON.stringify(proposal)])).rows[0]!;
      const result = changeDto(row); await save(tx, access, operationId, 'prepare', body, result); return result;
    }));
  }
  async function prepareWorkChanges(principal: IdentityPrincipal, operationId: string, input: PrepareWorkChangesInput & { workspaceId: string; expectedAuthzVersion: number }, execution: WorkExecutionContext): Promise<PrepareWorkChangesResult> {
    const body = validate(PrepareWorkChangesRequestSchema, input);
    if (operationId !== execution.operationId || body.workspaceId !== execution.workspaceId || body.projectId !== execution.projectId || body.expectedAuthzVersion !== execution.expectedAuthzVersion) throw new ArtifactConflict();
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'edit' }, async (tx, access) => {
      const request = { body, inputRevisionVector: execution.inputRevisionVector };
      const previous = await replay<PrepareWorkChangesResult>(tx, access, operationId, 'prepare-work-changes', request);
      await graphLock(tx, body.workspaceId, body.projectId);
      if (previous) { await authorizeProposal(tx, access, previous.changeSet); return previous; }
      assertMutationEpoch(access, body.expectedAuthzVersion); await requireActiveProject(tx, access, body.projectId);
      const selected = new Set(body.artifactIds), graph = await readGraph(tx, { workspaceId: body.workspaceId, projectId: body.projectId });
      for (const artifactId of body.artifactIds) await loadArtifact(tx, access, artifactId, { expectedProjectId: body.projectId });
      const scoped = { ...graph, edges: graph.edges.filter((edge) => selected.has(edge.target.artifactId)) };
      const id = randomUUID(), at = new Date().toISOString(), { proposal } = await loadDependencySnapshot(tx, access, scoped, at);
      const actualArtifacts = Object.keys(proposal.expectedArtifactRevisions).sort(), requestedArtifacts = [...selected].sort();
      if (actualArtifacts.length !== requestedArtifacts.length || actualArtifacts.some((id, index) => id !== requestedArtifacts[index])) throw new ArtifactConflict();
      const actualSources = Object.entries(proposal.expectedSourceRevisions).sort(([a], [b]) => a.localeCompare(b));
      const requestedSources = Object.entries(body.sourceRevisionVector).sort(([a], [b]) => a.localeCompare(b));
      if (digest(actualSources) !== digest(requestedSources)) throw new ArtifactConflict();
      const allowed = new Map(execution.allowedInputRefs.map((ref) => [`${ref.kind}:${ref.id}`, ref.revision]));
      if (body.artifactIds.some((artifactId) => allowed.get(`artifact:${artifactId}`) !== proposal.expectedArtifactRevisions[artifactId]) || requestedSources.some(([sourceId, revision]) => allowed.get(`source:${sourceId}`) !== revision)) throw notFound();
      const row = (await tx.query<ChangeRow>("INSERT INTO dependency_changesets(id,workspace_id,project_id,created_by,created_at,state,proposal) VALUES($1,$2,$3,$4,$5,'ready',$6) RETURNING *", [id, body.workspaceId, body.projectId, access.userId, at, JSON.stringify(proposal)])).rows[0]!;
      const result = { changeSet: changeDto(row), inputRevisionVector: execution.inputRevisionVector };
      await save(tx, access, operationId, 'prepare-work-changes', request, result); return result;
    }));
  }
  async function changeset(principal: IdentityPrincipal, id: string, input: ReadInput) {
    const body = validate(DependencyReadSchema, input); validate(IdSchema, id);
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { ...body, scope: 'read' }, async (tx, access) => {
      await graphLock(tx, body.workspaceId, body.projectId);
      const result = await loadChange(tx, body, id), graph = await readGraph(tx, body);
      await authorizeGraph(tx, access, graph);
      await authorizeProposal(tx, access, result);
      return result;
    }));
  }
  async function listChangesets(principal: IdentityPrincipal, input: z.input<typeof ChangeSetListInputSchema>) {
    const body = validate(ChangeSetListInputSchema, input);
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'read' }, async (tx, access) => {
      let after: z.infer<typeof ChangeCursorSchema> | undefined;
      if (body.after) {
        try { after = ChangeCursorSchema.parse(JSON.parse(Buffer.from(body.after, 'base64url').toString('utf8'))); }
        catch { throw new ArtifactConflict(); }
        if (after.workspaceId !== body.workspaceId || after.projectId !== body.projectId || after.authzVersion !== access.workspace.authz_version) throw new ArtifactConflict();
      }
      const rows = (await tx.query<ChangeRow>(`SELECT * FROM dependency_changesets
        WHERE workspace_id=$1 AND project_id=$2
        AND ($3::timestamptz IS NULL OR (created_at,id)<($3,$4::uuid))
        ORDER BY created_at DESC,id DESC LIMIT $5`, [body.workspaceId, body.projectId, after?.createdAt ?? null, after?.id ?? null, body.limit + 1])).rows;
      const page = rows.slice(0, body.limit).map(changeDto);
      for (const value of page) await authorizeProposal(tx, access, value);
      const last = rows.slice(0, body.limit).at(-1);
      const nextAfter = rows.length > body.limit && last ? Buffer.from(JSON.stringify({ workspaceId: body.workspaceId, projectId: body.projectId, authzVersion: access.workspace.authz_version, createdAt: last.created_at.toISOString(), id: last.id })).toString('base64url') : null;
      return ChangeSetListResultSchema.parse({ changesets: page, nextAfter, authzVersion: access.workspace.authz_version });
    }));
  }
  async function review(principal: IdentityPrincipal, operationId: string, id: string, action: 'accept' | 'reject', input: z.input<typeof ReviewChangesSchema>) {
    const body = validate(ReviewChangesSchema, input); validate(IdSchema, id);
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, projectId: body.projectId, scope: 'edit' }, async (tx, access) => {
      const request = { id, action, body }, previous = await replay<{ changeset: ChangeSet; receipt?: Awaited<ReturnType<typeof artifacts.apply>> }>(tx, access, operationId, 'review', request);
      await graphLock(tx, body.workspaceId, body.projectId);
      const current = await loadChange(tx, body, id), graph = await readGraph(tx, { workspaceId: body.workspaceId, projectId: body.projectId });
      if (previous) { await authorizeProposal(tx, access, previous.changeset); return previous; }
      assertMutationEpoch(access, body.expectedAuthzVersion); await requireActiveProject(tx, access, body.projectId);
      if (current.revision !== body.expectedRevision || current.state === 'applied' || current.state === 'rejected') throw new ArtifactConflict();
      const pending = new Set(current.proposal.changes.filter((change) => change.state !== 'unchanged').map((change) => change.groupId));
      for (const settled of [...current.acceptedGroupIds, ...current.rejectedGroupIds]) pending.delete(settled);
      if (body.groupIds.some((group) => !pending.has(group))) throw new ArtifactConflict();
      let receipt: Awaited<ReturnType<typeof artifacts.apply>> | undefined;
      if (action === 'accept') {
        const snapshot = await loadDependencySnapshot(tx, access, graph, current.createdAt, true);
        // Recompute all inputs under authorization and row locks; a cached preview is never write authority.
        if (digest(snapshot.proposal) !== digest(current.proposal)) throw new ArtifactConflict();
        const allowed = new Set(selectableGroups(current.proposal));
        if (body.groupIds.some((group) => !allowed.has(group))) throw new ArtifactConflict();
        const group = commandsForProposal(current.proposal, snapshot.artifacts, body.groupIds, { groupId: operationId, changesetId: id, makeId: randomUUID }, 'Apply linked changes');
        receipt = await artifacts.applyInTransaction(tx, principal, { workspaceId: body.workspaceId, expectedAuthzVersion: body.expectedAuthzVersion, group }, 'import');
      } else { await authorizeGraph(tx, access, graph); await authorizeProposal(tx, access, current); }
      const accepted = [...current.acceptedGroupIds, ...(action === 'accept' ? body.groupIds : [])], rejected = [...current.rejectedGroupIds, ...(action === 'reject' ? body.groupIds : [])];
      const remaining = [...pending].filter((group) => !body.groupIds.includes(group));
      const state = !remaining.length ? accepted.length ? 'applied' : 'rejected' : accepted.length ? 'partially-applied' : 'ready';
      const row = (await tx.query<ChangeRow>('UPDATE dependency_changesets SET revision=revision+1,state=$4,accepted_group_ids=$5,rejected_group_ids=$6,command_group_id=COALESCE($7,command_group_id) WHERE workspace_id=$1 AND project_id=$2 AND id=$3 RETURNING *', [body.workspaceId, body.projectId, id, state, accepted, rejected, receipt?.commandGroupId ?? null])).rows[0]!;
      const result = { changeset: changeDto(row), ...(receipt ? { receipt } : {}) }; await save(tx, access, operationId, 'review', request, result); return result;
    }));
  }
  return { read, registerInTransaction, register: (principal: IdentityPrincipal, operationId: string, input: z.input<typeof RegisterDependenciesSchema>) => identityTransaction(pool, (tx) => registerInTransaction(tx, principal, operationId, input)), bind, prepare, prepareWorkChanges, changeset, listChangesets, review };
}
