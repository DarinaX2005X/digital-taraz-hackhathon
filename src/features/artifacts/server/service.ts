import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { IdSchema, RevisionSchema } from '../../../contracts/primitives';
import { identityTransaction, withWorkspaceAccess, withWorkspaceAccessInTransaction, type IdentityPrincipal } from '../../identity/server/access';
import { IdentityError, validate } from '../../identity/server/http';
import { readSourceFreshness } from '../../sources/server/source-heads';
import { ArtifactAccessRequestSchema, ArtifactAccessResultSchema, ArtifactHistorySchema, ArtifactMutationResultSchema, ArtifactSnapshotSchema, ArtifactVersionDetailSchema, ArtifactVersionPageSchema, CreateArtifactSchema, type ArtifactMutationResult, type ArtifactSnapshot, type CreateArtifact } from '../contracts';
import { assertBoundedJson } from '../domain/canonical';
import { collectSourceRefs, createArtifactState } from '../domain/content-state';
import type { JsonValue } from '../domain/content-models';
import { createChunkStore } from './chunk-store';
import { createCommandHistory, readHistoryGroups } from './command-history';
import { createArtifactLifecycle } from './lifecycle';
import { artifactColumns, assertMutationEpoch, authorizeProject, branchParent, envelope, insertVersion, loadArtifact, loadState, loadVersion, missingTargets, notFound, operationBodyHash, operationLock, permissions, readCursor, receipt, requireActiveProject, saveReceipt, sourceVector, versionDto, viewer, type ArtifactRow, type VersionRow } from './service-support';
import { appendWorkspaceEvents } from './workspace-events';
import { createArtifactCatalog } from './catalog';

const ReadArtifactSchema = z.strictObject({ workspaceId: IdSchema, artifactId: IdSchema, expectedProjectId: IdSchema.optional() });
const VersionsSchema = ReadArtifactSchema.extend({ beforeRevision: RevisionSchema.optional(), limit: z.number().int().min(1).max(50).default(30) });
const VersionDetailSchema = ReadArtifactSchema.extend({ revision: RevisionSchema });

export function createArtifactService(pool: Pool) {
  async function access(principal: IdentityPrincipal, input: z.input<typeof ArtifactAccessRequestSchema>) {
    const body = validate(ArtifactAccessRequestSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, workspace) => {
      const authorizedArtifactIds: string[] = [], editableArtifactIds: string[] = [], unavailableArtifactIds: string[] = [];
      for (const id of [...body.artifactIds].sort()) {
        try {
          const { row, access: granted } = await loadArtifact(tx, workspace, id);
          authorizedArtifactIds.push(id);
          if (permissions(row, granted).edit) {
            const project = (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [body.workspaceId, row.project_id])).rows[0];
            if (project?.status === 'active') editableArtifactIds.push(id);
          }
        } catch (error) {
          if (!(error instanceof IdentityError) || !['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error;
          unavailableArtifactIds.push(id);
        }
      }
      return ArtifactAccessResultSchema.parse({ viewer: viewer(workspace), authorizedArtifactIds, editableArtifactIds, unavailableArtifactIds });
    });
  }
  async function read(principal: IdentityPrincipal, input: z.input<typeof ReadArtifactSchema>): Promise<ArtifactSnapshot> {
    const body = validate(ReadArtifactSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const cursor = await readCursor(tx, access);
      const authorized = await loadArtifact(tx, access, body.artifactId, { expectedProjectId: body.expectedProjectId });
      const { row } = authorized, { state } = await loadState(tx, row), version = await loadVersion(tx, row);
      const project = (await tx.query<{ status: string }>('SELECT status FROM projects WHERE workspace_id=$1 AND id=$2', [body.workspaceId, row.project_id])).rows[0];
      return ArtifactSnapshotSchema.parse({ viewer: viewer(access), artifact: envelope(row, state), content: state.content, version: { ...versionDto(version), ...await branchParent(tx, access, row.id) }, permissions: permissions(row, authorized.access, project?.status === 'active'), sourceFreshness: await readSourceFreshness(tx, access, collectSourceRefs(state)), history: await readHistoryGroups(tx, access, row.id), cursor, locks: state.locks, missingTargets: missingTargets(state) });
    });
  }
  async function readRoute(principal: IdentityPrincipal, input: { projectId: string; artifactId: string }): Promise<ArtifactSnapshot> {
    const body = validate(z.strictObject({ projectId: IdSchema, artifactId: IdSchema }), input);
    const metadata = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM artifacts WHERE id=$1 AND project_id=$2', [body.artifactId, body.projectId])).rows[0];
    if (!metadata) throw notFound();
    return read(principal, { workspaceId: metadata.workspace_id, artifactId: body.artifactId, expectedProjectId: body.projectId });
  }
  async function create(principal: IdentityPrincipal, operationId: string, input: z.input<typeof CreateArtifactSchema>): Promise<ArtifactMutationResult> {
    return identityTransaction(pool, (tx) => createInTransaction(tx, principal, operationId, input));
  }
  /** Persists the artifact, version, event and receipt in the caller's active transaction. */
  async function createInTransaction(transaction: PoolClient, principal: IdentityPrincipal, operationId: string, input: z.input<typeof CreateArtifactSchema>): Promise<ArtifactMutationResult> {
    validate(IdSchema, operationId); assertBoundedJson(input, { bytes: 22 * 1024 * 1024, depth: 70 });
    const body: CreateArtifact = validate(CreateArtifactSchema, input), hash = operationBodyHash(body);
    const state = createArtifactState(body.content, body.sourceRefs, body.bindings);
    return withWorkspaceAccessInTransaction(transaction, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      await authorizeProject(tx, access, body.projectId, 'edit', body.accessClass === 'confidential');
      await operationLock(tx, body.workspaceId, operationId);
      const replay = await receipt<ArtifactMutationResult>(tx, access, operationId, 'artifact.create', hash);
      if (replay) { await loadArtifact(tx, access, replay.artifact.id); return ArtifactMutationResultSchema.parse({ ...replay, viewer: viewer(access) }); }
      assertMutationEpoch(access, body.expectedAuthzVersion);
      await requireActiveProject(tx, access, body.projectId);
      const vector = await sourceVector(tx, access, collectSourceRefs(state));
      if (vector === null) throw new IdentityError('CONFLICT', 'artifacts.errors.sourcesUnavailable');
      await tx.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [`artifact-content:${access.workspace.id}`]);
      const store = createChunkStore(tx, body.workspaceId), root = store.graph.encode(state as unknown as JsonValue), contentRef = await store.persist(root);
      const row = (await tx.query<ArtifactRow>(`INSERT INTO artifacts(id,workspace_id,project_id,kind,schema_version,current_revision,title,access_class,content_id,content_hash,created_by) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10) RETURNING ${artifactColumns}`, [randomUUID(), body.workspaceId, body.projectId, body.content.kind, body.content.schemaVersion, body.title, body.accessClass, contentRef.id, contentRef.hash, access.userId])).rows[0]!;
      const version = await insertVersion(tx, access, row, { reason: 'Created', parentRevision: null, inputRevisions: vector });
      const cursor = await appendWorkspaceEvents(tx, access, [{ projectId: row.project_id, accessClass: row.access_class, kind: 'artifact.created', objectId: row.id, revision: row.current_revision, payload: {} }]);
      const result = ArtifactMutationResultSchema.parse({ viewer: viewer(access), artifact: envelope(row, state), version: versionDto(version), cursor });
      await saveReceipt(tx, access, operationId, 'artifact.create', hash, result);
      return result;
    });
  }
  async function history(principal: IdentityPrincipal, input: z.input<typeof ReadArtifactSchema>) {
    const body = validate(ReadArtifactSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const cursor = await readCursor(tx, access); await loadArtifact(tx, access, body.artifactId, { expectedProjectId: body.expectedProjectId });
      return ArtifactHistorySchema.parse({ viewer: viewer(access), artifactId: body.artifactId, groups: await readHistoryGroups(tx, access, body.artifactId), cursor });
    });
  }
  async function versions(principal: IdentityPrincipal, input: z.input<typeof VersionsSchema>) {
    const body = validate(VersionsSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      await loadArtifact(tx, access, body.artifactId, { expectedProjectId: body.expectedProjectId });
      const rows = (await tx.query<VersionRow>('SELECT v.*,u.name AS author_name FROM artifact_versions v JOIN identity_users u ON u.id=v.author_id WHERE v.workspace_id=$1 AND v.artifact_id=$2 AND ($3::integer IS NULL OR v.revision<$3) ORDER BY v.revision DESC LIMIT $4', [access.workspace.id, body.artifactId, body.beforeRevision ?? null, body.limit + 1])).rows;
      const parent = await branchParent(tx, access, body.artifactId);
      return ArtifactVersionPageSchema.parse({ viewer: viewer(access), artifactId: body.artifactId, versions: rows.slice(0, body.limit).map((row) => ({ ...versionDto(row), ...parent })), nextBeforeRevision: rows.length > body.limit ? rows[body.limit - 1]!.revision : null });
    });
  }
  async function version(principal: IdentityPrincipal, input: z.input<typeof VersionDetailSchema>) {
    const body = validate(VersionDetailSchema, input);
    return withWorkspaceAccess(pool, principal, { workspaceId: body.workspaceId, scope: 'read' }, async (tx, access) => {
      const { row } = await loadArtifact(tx, access, body.artifactId, { expectedProjectId: body.expectedProjectId }), selected = await loadVersion(tx, row, body.revision);
      const historical = { ...row, project_id: selected.project_id, current_revision: selected.revision, content_id: selected.content_id, content_hash: selected.content_hash, schema_version: selected.schema_version, title: selected.title, status: selected.status, updated_at: selected.created_at };
      // The artifact's current project is the access authority, including its retained versions.
      const { state } = await loadState(tx, historical);
      return ArtifactVersionDetailSchema.parse({ viewer: viewer(access), artifact: envelope(historical, state), version: { ...versionDto(selected), ...await branchParent(tx, access, row.id) }, content: state.content, sourceFreshness: await readSourceFreshness(tx, access, collectSourceRefs(state)), locks: state.locks, missingTargets: missingTargets(state), headRevision: row.current_revision });
    });
  }
  return { create, createInTransaction, read, readRoute, access, history, versions, version, list: createArtifactCatalog(pool), ...createCommandHistory(pool), ...createArtifactLifecycle(pool) };
}
export type ArtifactService = ReturnType<typeof createArtifactService>;
