import type { Pool } from 'pg';
import {
  ApplyPreparedCalculationRequestSchema,
  PrepareCalculationRequestSchema,
  type ApplyPreparedCalculationRequest,
  type PrepareCalculationRequest,
  type PreparedCalculation,
} from '@/contracts/calculations';
import type { CommandReceipt } from '@/features/artifacts/contracts';
import { collectSourceRefs } from '@/features/artifacts/domain/content-state';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { createArtifactService } from '@/features/artifacts/server/service';
import {
  ArtifactConflict,
  assertMutationEpoch,
  assertRevision,
  assertSources,
  loadArtifact,
  loadState,
  operationBodyHash,
  operationLock,
  receipt,
  requireActiveProject,
  sourceVector,
} from '@/features/artifacts/server/service-support';
import { identityTransaction, withWorkspaceAccessInTransaction, type IdentityPrincipal } from '@/features/identity/server/access';
import { validate } from '@/features/identity/server/http';
import { assertPreparedCalculation, prepareCalculation } from '../domain/calculation';
import { requireTable } from '../domain/model';

function commandRequest(input: ApplyPreparedCalculationRequest, operationId: string) {
  const prepared = input.prepared;
  return {
    workspaceId: input.workspaceId,
    expectedAuthzVersion: input.expectedAuthzVersion,
    group: {
      commandGroupId: operationId,
      metadataAt: prepared.preparedAt,
      expectedArtifactRevisions: { [prepared.artifactId]: prepared.baseRevision },
      expectedSourceRevisions: prepared.expectedSourceRevisions,
      commands: [{
        commandId: operationId,
        artifactId: prepared.artifactId,
        baseRevision: prepared.baseRevision,
        kind: 'table' as const,
        expectedSourceRevisions: prepared.expectedSourceRevisions,
        reason: input.reason,
        operations: prepared.updates.map((update) => ({ targetId: update.cellId, op: 'set' as const, value: update.cell as unknown as JsonValue, beforeHash: update.beforeHash })),
      }],
    },
  };
}

function samePrepared(left: PreparedCalculation, right: PreparedCalculation): boolean {
  return left.preparedHash === right.preparedHash
    && left.inputHash === right.inputHash
    && left.calculationHash === right.calculationHash
    && left.contentHash === right.contentHash;
}

export function createCalculationService(pool: Pool) {
  const artifacts = createArtifactService(pool);
  async function prepare(principal: IdentityPrincipal, input: unknown): Promise<PreparedCalculation> {
    const body: PrepareCalculationRequest = validate(PrepareCalculationRequestSchema, input);
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      assertMutationEpoch(access, body.expectedAuthzVersion);
      const { row } = await loadArtifact(tx, access, body.artifactId, { scope: 'edit', lock: true });
      if (row.kind !== 'table') throw new ArtifactConflict();
      assertRevision(row, body.baseRevision);
      await requireActiveProject(tx, access, row.project_id);
      const { state } = await loadState(tx, row), refs = collectSourceRefs(state);
      const vector = await sourceVector(tx, access, refs);
      if (vector === null) throw new ArtifactConflict();
      await assertSources(tx, access, refs, vector, true);
      return prepareCalculation({
        artifactId: row.id,
        projectId: row.project_id,
        baseRevision: row.current_revision,
        contentHash: row.content_hash,
        preparedAt: new Date().toISOString(),
        expectedSourceRevisions: vector,
        content: requireTable(state.content),
        sheetId: body.sheetId,
      });
    }));
  }

  async function apply(principal: IdentityPrincipal, operationId: string, input: unknown): Promise<CommandReceipt> {
    const body: ApplyPreparedCalculationRequest = validate(ApplyPreparedCalculationRequestSchema, input);
    const prepared = assertPreparedCalculation(body.prepared), request = commandRequest({ ...body, prepared }, operationId);
    const bodyHash = operationBodyHash({ body: request, origin: 'import' });
    return identityTransaction(pool, (tx) => withWorkspaceAccessInTransaction(tx, principal, { workspaceId: body.workspaceId, scope: 'edit' }, async (tx, access) => {
      // Access is checked before replay: revocation never exposes an old receipt.
      const initial = await loadArtifact(tx, access, prepared.artifactId, { expectedProjectId: prepared.projectId, scope: 'edit', retain: false });
      if (initial.row.kind !== 'table') throw new ArtifactConflict();
      await operationLock(tx, body.workspaceId, operationId);
      const replay = await receipt<CommandReceipt>(tx, access, operationId, 'commands', bodyHash);
      if (replay) return replay;
      assertMutationEpoch(access, body.expectedAuthzVersion);
      const { row } = await loadArtifact(tx, access, prepared.artifactId, { expectedProjectId: prepared.projectId, scope: 'edit', lock: true });
      assertRevision(row, prepared.baseRevision);
      if (row.content_hash !== prepared.contentHash) throw new ArtifactConflict(undefined, row.current_revision);
      await requireActiveProject(tx, access, row.project_id);
      const { state } = await loadState(tx, row), refs = collectSourceRefs(state);
      await assertSources(tx, access, refs, prepared.expectedSourceRevisions, true);
      const fresh = prepareCalculation({
        artifactId: row.id,
        projectId: row.project_id,
        baseRevision: row.current_revision,
        contentHash: row.content_hash,
        preparedAt: prepared.preparedAt,
        expectedSourceRevisions: prepared.expectedSourceRevisions,
        content: requireTable(state.content),
        sheetId: prepared.sheetId,
      });
      // Cached client values, exact inputs, formulas and target hashes are all
      // non-authoritative. Only this transaction's recomputation may commit.
      if (!samePrepared(prepared, fresh)) throw new ArtifactConflict(undefined, row.current_revision);
      return artifacts.applyInTransaction(tx, principal, request, 'import');
    }));
  }
  return { prepare, apply };
}

export type CalculationService = ReturnType<typeof createCalculationService>;
