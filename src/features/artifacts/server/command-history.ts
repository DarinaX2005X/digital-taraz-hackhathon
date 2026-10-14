import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { SourceRef } from '../../../contracts/artifacts';
import { hasScope } from '../../identity/domain/policy';
import { withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { ArtifactCommandRequestSchema, ArtifactHistoryActionSchema, ArtifactHistoryGroupSchema, CommandReceiptSchema, type ArtifactCommandRequest, type ArtifactHistoryAction, type ArtifactHistoryGroup, type CommandReceipt } from '../contracts';
import { collectSourceRefs } from '../domain/content-state';
import { assertBoundedJson } from '../domain/canonical';
import type { JsonValue } from '../domain/content-models';
import { ArtifactDraft, inverseInputs, type ReversibleOperation } from '../domain/operations';
import type { ArtifactState } from '../domain/targets';
import { createChunkStore } from './chunk-store';
import { ArtifactConflict, artifactColumns, assertMutationEpoch, assertRevision, assertSources, authorizeProject, editableStatus, loadArtifact, mapTargetConflict, nextVersion, operationBodyHash, operationLock, receipt, requireActiveProject, saveReceipt, sourceVector, type ArtifactRow } from './service-support';
import { appendWorkspaceEvents, type WorkspaceEventInput } from './workspace-events';

interface GroupRow {
  id: string; actor_id: string; actor_name?: string; body_hash: string; origin: 'human' | 'ai' | 'import'; action: 'apply' | 'undo' | 'redo'; reason: string;
  committed_revisions: Record<string, number>; is_active: boolean; undone_by_group_id: string | null; undoes_group_id: string | null; redoes_group_id: string | null; created_at: Date;
}
interface CommandRow { id: string; artifact_id: string; group_id: string; inverse_operations: ReversibleOperation[]; operations: JsonValue[]; revision: number }
const groupSql = 'SELECT g.*,u.name AS actor_name FROM artifact_command_groups g JOIN identity_users u ON u.id=g.actor_id';
const scopeCanEdit = (access: WorkspaceAccess, row: ArtifactRow) => hasScope({ ...access.membership, projectScopes: access.projectScopes, confidential: row.access_class === 'confidential' }, 'edit') && editableStatus(row.status);

async function candidateCommands(tx: PoolClient, workspaceId: string, group: GroupRow): Promise<CommandRow[]> {
  let id = group.id;
  if (!group.is_active) id = group.undone_by_group_id ?? '';
  else {
    const redo = (await tx.query<{ id: string }>("SELECT id FROM artifact_command_groups WHERE workspace_id=$1 AND redoes_group_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1", [workspaceId, group.id])).rows[0];
    if (redo) id = redo.id;
  }
  if (!id) return [];
  return (await tx.query<CommandRow>('SELECT id,artifact_id,group_id,inverse_operations,operations,revision FROM artifact_commands WHERE workspace_id=$1 AND group_id=$2 ORDER BY artifact_id', [workspaceId, id])).rows;
}

export async function describeHistoryGroup(tx: PoolClient, access: WorkspaceAccess, group: GroupRow, eligibility = true): Promise<ArtifactHistoryGroup | null> {
  const ids = Object.keys(group.committed_revisions).sort();
  const rows = (await tx.query<ArtifactRow>(`SELECT ${artifactColumns} FROM artifacts WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`, [access.workspace.id, ids])).rows;
  const visible: ArtifactRow[] = [], granted = new Map<string, WorkspaceAccess>();
  for (const row of rows) {
    try { const allowed = await authorizeProject(tx, access, row.project_id, 'read', row.access_class === 'confidential'); visible.push(row); granted.set(row.id, allowed); }
    catch (error) { if (!(error instanceof IdentityError) || !['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error; }
  }
  if (!visible.length) return null;
  const unavailable = visible.length !== ids.length;
  let eligible = eligibility && !unavailable && group.action === 'apply' && visible.every((row) => scopeCanEdit(granted.get(row.id)!, row));
  let expectedSourceRevisions: Record<string, number> | undefined;
  if (eligible) {
    const candidates = await candidateCommands(tx, access.workspace.id, group);
    eligible = candidates.length === ids.length;
    const refs: SourceRef[] = [];
    for (const row of visible) {
      const command = candidates.find((item) => item.artifact_id === row.id);
      if (!command) { eligible = false; continue; }
      const store = createChunkStore(tx, access.workspace.id), draft = new ArtifactDraft(store.graph, row.content_hash);
      const seen = new Set<string>();
      for (const inverse of command.inverse_operations) {
        if (seen.has(inverse.operation.targetId)) continue;
        seen.add(inverse.operation.targetId);
        if ((await draft.target(inverse.operation.targetId))?.hash !== inverse.operation.beforeHash && !((await draft.target(inverse.operation.targetId)) === null && inverse.operation.beforeHash === null)) eligible = false;
      }
      const bindings = await store.graph.get(row.content_hash, ['bindings']) as unknown as ArtifactState['bindings'];
      const direct = await store.graph.get(row.content_hash, ['sourceRefs']) as unknown as SourceRef[];
      refs.push(...collectSourceRefs({ bindings, sourceRefs: direct }));
      for (const inverse of command.inverse_operations) for (const metadata of Object.values(inverse.metadata)) if (metadata.binding) refs.push(metadata.binding.sourceRef);
    }
    const vector = await sourceVector(tx, access, uniqueRefs(refs));
    if (vector === null) eligible = false; else expectedSourceRevisions = vector;
  }
  return ArtifactHistoryGroupSchema.parse({ commandGroupId: group.id, actorId: group.actor_id, ...(group.actor_name ? { actorName: group.actor_name } : {}), reason: group.reason, origin: group.origin, createdAt: group.created_at.toISOString(), state: group.is_active ? 'active' : 'undone', committedRevisionVector: Object.fromEntries(visible.map((row) => [row.id, group.committed_revisions[row.id]!])), artifacts: visible.map((row) => ({ artifactId: row.id, title: row.title, kind: row.kind, committedRevision: group.committed_revisions[row.id]!, currentRevision: row.current_revision })), hasUnavailableArtifacts: unavailable, canUndo: eligible && group.is_active, canRedo: eligible && !group.is_active, ...(group.undone_by_group_id ? { undoneByGroupId: group.undone_by_group_id } : {}), ...(group.undoes_group_id ? { undoesGroupId: group.undoes_group_id } : {}), ...(group.redoes_group_id ? { redoesGroupId: group.redoes_group_id } : {}), ...(expectedSourceRevisions ? { expectedSourceRevisions } : {}) });
}
export async function readHistoryGroups(tx: PoolClient, access: WorkspaceAccess, artifactId: string): Promise<ArtifactHistoryGroup[]> {
  const groups = (await tx.query<GroupRow>(`${groupSql} WHERE g.workspace_id=$1 AND g.action='apply' AND EXISTS(SELECT 1 FROM artifact_commands c WHERE c.workspace_id=g.workspace_id AND c.group_id=g.id AND c.artifact_id=$2) ORDER BY g.created_at DESC,g.id DESC LIMIT 100`, [access.workspace.id, artifactId])).rows;
  const output: ArtifactHistoryGroup[] = [];
  for (const group of groups) { const item = await describeHistoryGroup(tx, access, group); if (item) output.push(item); }
  return output;
}
function uniqueRefs(refs: SourceRef[]) { return [...new Map(refs.map((ref) => [operationBodyHash(ref), ref])).values()]; }
async function loadGroup(tx: PoolClient, workspaceId: string, id: string, lock = false): Promise<GroupRow | undefined> {
  return (await tx.query<GroupRow>(`${groupSql} WHERE g.workspace_id=$1 AND g.id=$2${lock ? ' FOR UPDATE OF g' : ''}`, [workspaceId, id])).rows[0];
}
async function requireNoGroupCollision(tx: PoolClient, workspaceId: string, id: string) {
  if (await loadGroup(tx, workspaceId, id)) throw new ArtifactConflict();
}

interface CommitCommand { id: string; row: ArtifactRow; draft: ArtifactDraft; store: ReturnType<typeof createChunkStore>; operations: JsonValue[]; inverse: ReversibleOperation[]; beforeHashes: Record<string, string | null>; afterHashes: Record<string, string | null> }
async function commitGroup(tx: PoolClient, access: WorkspaceAccess, input: { id: string; hash: string; origin: GroupRow['origin']; action: GroupRow['action']; reason: string; changesetId?: string; targetGroupId?: string; sourceRevisions: Record<string, number>; commands: CommitCommand[] }): Promise<CommandReceipt> {
  await tx.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [`artifact-content:${access.workspace.id}`]);
  const artifacts: CommandReceipt['artifacts'] = [], vector: Record<string, number> = {}, events: WorkspaceEventInput[] = [];
  for (const command of input.commands) {
    const contentRef = await command.store.persist(command.draft.root);
    const changed = await nextVersion(tx, access, command.row, { contentRef, reason: input.reason, inputRevisions: input.sourceRevisions });
    vector[command.row.id] = changed.row.current_revision;
    artifacts.push({ artifactId: command.row.id, revision: changed.row.current_revision, versionId: changed.version.id, contentRef });
    const targets = Object.keys(command.afterHashes);
    events.push({ projectId: changed.row.project_id, accessClass: changed.row.access_class, kind: 'artifact.changed', objectId: changed.row.id, revision: changed.row.current_revision, payload: { commandGroupId: input.id, changedTargetIds: targets.slice(0, 100), ...(targets.length > 100 ? { moreTargets: true } : {}) } });
  }
  await tx.query(`INSERT INTO artifact_command_groups(workspace_id,id,actor_id,body_hash,origin,action,reason,changeset_id,committed_revisions,undoes_group_id,redoes_group_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [access.workspace.id, input.id, access.userId, input.hash, input.origin, input.action, input.reason, input.changesetId ?? null, JSON.stringify(vector), input.action === 'undo' ? input.targetGroupId : null, input.action === 'redo' ? input.targetGroupId : null]);
  for (const command of input.commands) await tx.query(`INSERT INTO artifact_commands(workspace_id,id,group_id,artifact_id,base_revision,revision,operations,inverse_operations,before_hashes,after_hashes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [access.workspace.id, command.id, input.id, command.row.id, command.row.current_revision, vector[command.row.id], JSON.stringify(command.operations), JSON.stringify(command.inverse), JSON.stringify(command.beforeHashes), JSON.stringify(command.afterHashes)]);
  if (input.targetGroupId) await tx.query('UPDATE artifact_command_groups SET is_active=$3,undone_by_group_id=$4 WHERE workspace_id=$1 AND id=$2', [access.workspace.id, input.targetGroupId, input.action === 'redo', input.action === 'undo' ? input.id : null]);
  const cursor = await appendWorkspaceEvents(tx, access, events);
  const group = (await loadGroup(tx, access.workspace.id, input.id))!;
  const historyGroup = (await describeHistoryGroup(tx, access, group))!;
  return CommandReceiptSchema.parse({ commandGroupId: input.id, committedRevisionVector: vector, artifacts, cursor, historyGroup });
}

export function createCommandHistory(pool: Pool) {
  async function apply(principal: IdentityPrincipal, input: z.input<typeof ArtifactCommandRequestSchema>, origin: 'human' | 'ai' | 'import' = 'human'): Promise<CommandReceipt> {
    assertBoundedJson(input, { bytes: 22 * 1024 * 1024, depth: 80 });
    const body: ArtifactCommandRequest = validate(ArtifactCommandRequestSchema, input);
    const id = body.group.commandGroupId, hash = operationBodyHash({ body, origin });
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      await operationLock(tx, body.workspaceId, id);
      const authorized = new Map<string, ArtifactRow>();
      for (const command of [...body.group.commands].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) {
        const { row } = await loadArtifact(tx, access, command.artifactId, { scope: 'edit', lock: true }); authorized.set(row.id, row);
      }
      const replay = await receipt<CommandReceipt>(tx, access, id, 'commands', hash);
      if (replay) return CommandReceiptSchema.parse(replay);
      assertMutationEpoch(access, body.expectedAuthzVersion);
      await requireNoGroupCollision(tx, access.workspace.id, id);
      const commandIds = body.group.commands.map((command) => command.commandId);
      if ((await tx.query('SELECT id FROM artifact_commands WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [access.workspace.id, commandIds])).rowCount) throw new ArtifactConflict();
      const refs: SourceRef[] = [], pending: CommitCommand[] = [];
      for (const command of body.group.commands) {
        const row = authorized.get(command.artifactId)!;
        if (command.kind !== row.kind) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
        assertRevision(row, command.baseRevision);
        if (!editableStatus(row.status)) throw new ArtifactConflict();
        await requireActiveProject(tx, access, row.project_id);
        const store = createChunkStore(tx, access.workspace.id), draft = new ArtifactDraft(store.graph, row.content_hash);
        const beforeBindings = await store.graph.get(row.content_hash, ['bindings']) as unknown as ArtifactState['bindings'];
        const direct = await store.graph.get(row.content_hash, ['sourceRefs']) as unknown as SourceRef[];
        refs.push(...collectSourceRefs({ bindings: beforeBindings, sourceRefs: direct }));
        let applied;
        try { applied = await draft.apply(command.operations, { actorId: access.userId, at: new Date().toISOString(), reason: command.reason, origin }); }
        catch (error) { mapTargetConflict(error, row); }
        const afterBindings = await store.graph.get(draft.root, ['bindings']) as unknown as ArtifactState['bindings'];
        refs.push(...collectSourceRefs({ bindings: afterBindings, sourceRefs: direct }));
        pending.push({ id: command.commandId, row, store, draft, operations: command.operations as unknown as JsonValue[], inverse: applied.inverse, beforeHashes: applied.beforeHashes, afterHashes: applied.afterHashes });
      }
      await assertSources(tx, access, uniqueRefs(refs), body.group.expectedSourceRevisions, origin !== 'human');
      const result = await commitGroup(tx, access, { id, hash, origin, action: 'apply', reason: body.group.commands[0]!.reason, changesetId: body.group.changesetId, sourceRevisions: body.group.expectedSourceRevisions, commands: pending });
      await saveReceipt(tx, access, id, 'commands', hash, result);
      return result;
    });
  }
  async function historyAction(principal: IdentityPrincipal, action: 'undo' | 'redo', input: z.input<typeof ArtifactHistoryActionSchema>): Promise<CommandReceipt> {
    const body: ArtifactHistoryAction = validate(ArtifactHistoryActionSchema, input), id = body.commandGroupId, hash = operationBodyHash({ body, action });
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      for (const key of [id, body.targetCommandGroupId].sort()) await operationLock(tx, body.workspaceId, key);
      const target = await loadGroup(tx, body.workspaceId, body.targetCommandGroupId, true);
      if (!target || target.action !== 'apply') throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
      const ids = Object.keys(target.committed_revisions).sort(), rows = new Map<string, ArtifactRow>();
      for (const artifactId of ids) rows.set(artifactId, (await loadArtifact(tx, access, artifactId, { scope: 'edit', lock: true })).row);
      const replay = await receipt<CommandReceipt>(tx, access, id, action, hash);
      if (replay) return CommandReceiptSchema.parse(replay);
      assertMutationEpoch(access, body.expectedAuthzVersion);
      await requireNoGroupCollision(tx, body.workspaceId, id);
      if (target.is_active !== (action === 'undo')) throw new ArtifactConflict();
      if (Object.keys(body.expectedArtifactRevisions).length !== ids.length || ids.some((artifactId) => body.expectedArtifactRevisions[artifactId] === undefined)) throw new ArtifactConflict();
      const candidates = await candidateCommands(tx, body.workspaceId, target);
      if (candidates.length !== ids.length) throw new ArtifactConflict();
      // The persisted undo window is per artifact; versions remain independent.
      for (const artifactId of ids) {
        const recent = (await tx.query<{ id: string }>(`SELECT g.id FROM artifact_command_groups g WHERE g.workspace_id=$1 AND g.action='apply' AND EXISTS(SELECT 1 FROM artifact_commands c WHERE c.workspace_id=g.workspace_id AND c.group_id=g.id AND c.artifact_id=$2) ORDER BY g.created_at DESC,g.id DESC LIMIT 100`, [body.workspaceId, artifactId])).rows;
        if (!recent.some((group) => group.id === target.id)) throw new ArtifactConflict();
      }
      const refs: SourceRef[] = [], pending: CommitCommand[] = [];
      for (const candidate of candidates) {
        const row = rows.get(candidate.artifact_id)!;
        assertRevision(row, body.expectedArtifactRevisions[row.id]!);
        if (!editableStatus(row.status)) throw new ArtifactConflict();
        await requireActiveProject(tx, access, row.project_id);
        const store = createChunkStore(tx, access.workspace.id), draft = new ArtifactDraft(store.graph, row.content_hash);
        const bindings = await store.graph.get(row.content_hash, ['bindings']) as unknown as ArtifactState['bindings'];
        const direct = await store.graph.get(row.content_hash, ['sourceRefs']) as unknown as SourceRef[];
        refs.push(...collectSourceRefs({ bindings, sourceRefs: direct }));
        const operations = inverseInputs(candidate.inverse_operations);
        let applied;
        try { applied = await draft.apply(operations, { actorId: access.userId, at: new Date().toISOString(), reason: `${action}: ${target.reason}`.slice(0, 1000), origin: 'history' }, candidate.inverse_operations); }
        catch (error) { mapTargetConflict(error, row); }
        const afterBindings = await store.graph.get(draft.root, ['bindings']) as unknown as ArtifactState['bindings'];
        refs.push(...collectSourceRefs({ bindings: afterBindings, sourceRefs: direct }));
        pending.push({ id: randomUUID(), row, draft, store, operations: operations as unknown as JsonValue[], inverse: applied.inverse, beforeHashes: applied.beforeHashes, afterHashes: applied.afterHashes });
      }
      await assertSources(tx, access, uniqueRefs(refs), body.expectedSourceRevisions);
      const result = await commitGroup(tx, access, { id, hash, origin: 'human', action, reason: `${action}: ${target.reason}`.slice(0, 1000), targetGroupId: target.id, sourceRevisions: body.expectedSourceRevisions, commands: pending });
      await saveReceipt(tx, access, id, action, hash, result);
      return result;
    });
  }
  return { apply, undo: (principal: IdentityPrincipal, input: z.input<typeof ArtifactHistoryActionSchema>) => historyAction(principal, 'undo', input), redo: (principal: IdentityPrincipal, input: z.input<typeof ArtifactHistoryActionSchema>) => historyAction(principal, 'redo', input) };
}
export type ArtifactCommandService = ReturnType<typeof createCommandHistory>;
