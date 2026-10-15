import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { IdSchema } from '../../../contracts/primitives';
import { fieldBindingProperty } from '../../../contracts/artifacts';
import { withWorkspaceAccess, type IdentityPrincipal, type WorkspaceAccess } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { ArtifactMutationResultSchema, ArtifactMutationSchema, ArtifactPurgeResultSchema, BranchArtifactSchema, DuplicateArtifactSchema, MoveArtifactSchema, PurgeArtifactSchema, RenameArtifactSchema, RestoreArtifactVersionSchema, type ArtifactMutation, type ArtifactMutationResult } from '../contracts';
import { assertBoundedJson, hashJson } from '../domain/canonical';
import { collectSourceRefs, createArtifactState } from '../domain/content-state';
import type { ArtifactContent, JsonValue } from '../domain/content-models';
import { locateTarget, targetPropertyValue, targetValue, type ArtifactState } from '../domain/targets';
import { createChunkStore } from './chunk-store';
import { ArtifactConflict, artifactColumns, assertMutationEpoch, assertRevision, authorizeProject, branchParent, editableStatus, envelope, insertVersion, loadArtifact, loadState, loadVersion, nextVersion, operationBodyHash, operationLock, receipt, requireActiveProject, saveReceipt, sourceVector, versionDto, viewer, type ArtifactRow } from './service-support';
import { appendWorkspaceEvents, type WorkspaceEventInput } from './workspace-events';

function changedBranchState(selected: ArtifactState, content: ArtifactContent, access: WorkspaceAccess): ArtifactState {
  if (content.kind !== selected.content.kind) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
  const state = createArtifactState(content);
  state.sourceRefs = structuredClone(selected.sourceRefs); state.bindings = structuredClone(selected.bindings); state.locks = structuredClone(selected.locks); state.retiredTargets = { ...selected.retiredTargets };
  for (const id of Object.keys(selected.index.targets)) if (!locateTarget(state.index, id)) state.retiredTargets[id] = true;
  for (const id of Object.keys(state.index.targets)) if (!locateTarget(selected.index, id) && selected.retiredTargets[id]) throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
  for (const binding of Object.values(state.bindings)) {
    const before = locateTarget(selected.index, binding.targetElementId), after = locateTarget(state.index, binding.targetElementId);
    const property = fieldBindingProperty(binding);
    const beforeValue = before ? targetValue(selected.content, before) : null, afterValue = after ? targetValue(state.content, after) : null;
    const beforeHash = before ? hashJson(binding.targetProperty ? targetPropertyValue(before.kind, beforeValue!, property) : beforeValue) : null;
    const afterHash = after ? hashJson(binding.targetProperty ? targetPropertyValue(after.kind, afterValue!, property) : afterValue) : null;
    if (beforeHash !== afterHash) binding.override = { reason: 'Recovered local draft', actorId: access.userId, at: new Date().toISOString() };
  }
  return state;
}
async function mutationResult(tx: PoolClient, access: WorkspaceAccess, row: ArtifactRow, version: Awaited<ReturnType<typeof loadVersion>>, state: ArtifactState, cursor: string): Promise<ArtifactMutationResult> {
  return ArtifactMutationResultSchema.parse({ viewer: viewer(access), artifact: envelope(row, state), version: { ...versionDto(version), ...await branchParent(tx, access, row.id) }, cursor });
}
type MutatingBody = ArtifactMutation & { title?: string; projectId?: string; revision?: number; parentRevision?: number; content?: ArtifactContent; reason?: string };
type Action = 'rename' | 'move' | 'archive' | 'trash' | 'restore' | 'duplicate' | 'branches' | 'restore-version';

export function createArtifactLifecycle(pool: Pool) {
  async function mutate(principal: IdentityPrincipal, operationId: string, artifactId: string, action: Action, schema: z.ZodType, input: unknown): Promise<ArtifactMutationResult> {
    validate(IdSchema, operationId); validate(IdSchema, artifactId); assertBoundedJson(input, { bytes: 22 * 1024 * 1024, depth: 70 });
    const body = validate(schema, input) as MutatingBody, hash = operationBodyHash({ artifactId, action, body });
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      await operationLock(tx, body.workspaceId, operationId);
      const { row } = await loadArtifact(tx, access, artifactId, { scope: 'edit', lock: true });
      const replay = await receipt<ArtifactMutationResult>(tx, access, operationId, `artifact.${action}`, hash);
      if (replay) {
        await loadArtifact(tx, access, replay.artifact.id);
        return ArtifactMutationResultSchema.parse({ ...replay, viewer: viewer(access) });
      }
      assertMutationEpoch(access, body.expectedAuthzVersion); assertRevision(row, body.baseRevision);
      if (!['trash', 'restore', 'duplicate', 'branches'].includes(action) && !editableStatus(row.status)) throw new ArtifactConflict();
      if (row.status === 'trashed' && !['restore'].includes(action)) throw new ArtifactConflict();
      if (action !== 'trash') await requireActiveProject(tx, access, row.project_id);
      if (body.projectId) {
        await authorizeProject(tx, access, body.projectId, 'edit', row.access_class === 'confidential');
        await requireActiveProject(tx, access, body.projectId);
      }
      const selectedRevision = action === 'branches' ? body.parentRevision! : body.revision;
      const selectedVersion = selectedRevision === undefined ? undefined : await loadVersion(tx, row, selectedRevision);
      const selectedRow = selectedVersion ? { ...row, content_hash: selectedVersion.content_hash, content_id: selectedVersion.content_id } : row;
      const { state: selectedState } = await loadState(tx, selectedRow);
      const state = action === 'branches' && body.content ? changedBranchState(selectedState, body.content, access) : selectedState;
      const vector = await sourceVector(tx, access, collectSourceRefs(state));
      let changed: { row: ArtifactRow; version: Awaited<ReturnType<typeof loadVersion>> };
      if (action === 'duplicate' || action === 'branches') {
        await tx.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [`artifact-content:${access.workspace.id}`]);
        const store = createChunkStore(tx, access.workspace.id), root = body.content ? store.graph.encode(state as unknown as JsonValue) : selectedRow.content_hash;
        const contentRef = body.content ? await store.persist(root) : { id: selectedRow.content_id, hash: root };
        const created = (await tx.query<ArtifactRow>(`INSERT INTO artifacts(id,workspace_id,project_id,kind,schema_version,current_revision,title,access_class,content_id,content_hash,created_by) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10) RETURNING ${artifactColumns}`, [randomUUID(), access.workspace.id, body.projectId, row.kind, row.schema_version, body.title, row.access_class, contentRef.id, contentRef.hash, access.userId])).rows[0]!;
        const version = await insertVersion(tx, access, created, { parentRevision: null, reason: action === 'branches' ? 'Branched from retained version' : 'Duplicated', inputRevisions: vector ?? {} });
        if (action === 'branches') await tx.query("INSERT INTO artifact_version_pins(id,workspace_id,artifact_id,revision,kind,retainer_id,holding_artifact_id) VALUES($1,$2,$3,$4,'branch',$5,$5)", [randomUUID(), access.workspace.id, row.id, body.parentRevision, created.id]);
        changed = { row: created, version };
      } else {
        let status: ArtifactRow['status'] | undefined;
        if (action === 'archive') status = 'archived';
        if (action === 'trash') status = 'trashed';
        if (action === 'restore') {
          if (row.status === 'trashed') status = row.trash_previous_status ?? 'draft';
          else if (row.status === 'archived') {
            const previous = (await tx.query<{ status: ArtifactRow['status'] }>("SELECT status FROM artifact_versions WHERE workspace_id=$1 AND artifact_id=$2 AND revision<$3 AND status NOT IN ('archived','trashed') ORDER BY revision DESC LIMIT 1", [access.workspace.id, row.id, row.current_revision])).rows[0];
            status = previous?.status ?? 'draft';
          } else throw new ArtifactConflict();
        }
        if (action === 'restore-version') status = 'draft';
        changed = await nextVersion(tx, access, row, { reason: body.reason ?? action, inputRevisions: vector ?? {}, ...(action === 'rename' ? { title: body.title } : {}), ...(action === 'move' ? { projectId: body.projectId } : {}), ...(status ? { status } : {}), ...(action === 'trash' ? { trashPreviousStatus: row.status } : {}), ...(action === 'restore-version' ? { contentRef: { id: selectedRow.content_id, hash: selectedRow.content_hash }, title: selectedVersion!.title } : {}) });
      }
      const kind = action === 'duplicate' || action === 'branches' ? 'artifact.created' : action === 'move' ? 'artifact.moved' : action === 'archive' ? 'artifact.archived' : action === 'trash' ? 'artifact.trashed' : action === 'restore' || action === 'restore-version' ? 'artifact.restored' : 'artifact.changed';
      const event: WorkspaceEventInput = { projectId: changed.row.project_id, accessClass: changed.row.access_class, kind, objectId: changed.row.id, revision: changed.row.current_revision, payload: {} };
      const cursor = await appendWorkspaceEvents(tx, access, action === 'move' && row.project_id !== changed.row.project_id ? [{ ...event, projectId: row.project_id }, event] : [event]);
      const result = await mutationResult(tx, access, changed.row, changed.version, state, cursor);
      await saveReceipt(tx, access, operationId, `artifact.${action}`, hash, result);
      return result;
    });
  }
  async function purge(principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof PurgeArtifactSchema>) {
    validate(IdSchema, operationId); validate(IdSchema, artifactId);
    const body = validate(PurgeArtifactSchema, input), hash = operationBodyHash({ artifactId, body });
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      if (access.membership.role !== 'owner') throw new IdentityError('FORBIDDEN', 'artifacts.errors.forbidden');
      await operationLock(tx, body.workspaceId, operationId);
      const replay = await receipt<z.infer<typeof ArtifactPurgeResultSchema>>(tx, access, operationId, 'artifact.purge', hash);
      if (replay) return ArtifactPurgeResultSchema.parse({ ...replay, viewer: viewer(access) });
      const { row } = await loadArtifact(tx, access, artifactId, { scope: 'edit', lock: true });
      assertMutationEpoch(access, body.expectedAuthzVersion); assertRevision(row, body.baseRevision);
      if (row.status !== 'trashed' || body.confirmationTitle !== row.title || (!body.immediate && (!row.trashed_at || Date.now() - row.trashed_at.getTime() < 30 * 86400000))) throw new ArtifactConflict();
      const used = await tx.query('SELECT id FROM artifact_version_pins WHERE workspace_id=$1 AND artifact_id=$2 AND (holding_artifact_id IS NULL OR holding_artifact_id<>$2) LIMIT 1', [access.workspace.id, row.id]);
      if (used.rowCount) throw new IdentityError('CONFLICT', 'artifacts.errors.inUse');
      const tombstone = (await tx.query<{ deleted_at: Date }>('INSERT INTO artifact_tombstones(workspace_id,artifact_id,deleted_by) VALUES($1,$2,$3) RETURNING deleted_at', [access.workspace.id, row.id, access.userId])).rows[0]!;
      await tx.query('DELETE FROM artifact_version_pins WHERE workspace_id=$1 AND holding_artifact_id=$2', [access.workspace.id, row.id]);
      await tx.query('DELETE FROM artifacts WHERE workspace_id=$1 AND id=$2', [access.workspace.id, row.id]);
      const cursor = await appendWorkspaceEvents(tx, access, [{ projectId: row.project_id, accessClass: row.access_class, kind: 'artifact.purged', objectId: row.id, revision: row.current_revision, payload: {} }]);
      const result = ArtifactPurgeResultSchema.parse({ viewer: viewer(access), artifactId: row.id, deletedAt: tombstone.deleted_at.toISOString(), cleanupPending: true, cursor });
      await saveReceipt(tx, access, operationId, 'artifact.purge', hash, result);
      return result;
    });
  }
  return {
    rename: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof RenameArtifactSchema>) => mutate(principal, operationId, artifactId, 'rename', RenameArtifactSchema, input),
    move: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof MoveArtifactSchema>) => mutate(principal, operationId, artifactId, 'move', MoveArtifactSchema, input),
    archive: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof ArtifactMutationSchema>) => mutate(principal, operationId, artifactId, 'archive', ArtifactMutationSchema, input),
    trash: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof ArtifactMutationSchema>) => mutate(principal, operationId, artifactId, 'trash', ArtifactMutationSchema, input),
    restore: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof ArtifactMutationSchema>) => mutate(principal, operationId, artifactId, 'restore', ArtifactMutationSchema, input),
    duplicate: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof DuplicateArtifactSchema>) => mutate(principal, operationId, artifactId, 'duplicate', DuplicateArtifactSchema, input),
    branch: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof BranchArtifactSchema>) => mutate(principal, operationId, artifactId, 'branches', BranchArtifactSchema, input),
    restoreVersion: (principal: IdentityPrincipal, operationId: string, artifactId: string, input: z.input<typeof RestoreArtifactVersionSchema>) => mutate(principal, operationId, artifactId, 'restore-version', RestoreArtifactVersionSchema, input),
    purge,
  };
}
