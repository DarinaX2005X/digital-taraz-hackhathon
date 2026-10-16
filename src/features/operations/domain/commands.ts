import type { CommandGroupDraft } from '@/features/artifacts/client/grouping';

import { createEditorArtifactState, expectedSourceRevisions } from '@/features/artifacts/client/snapshot-state';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import { ContentValidationError, hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import { ArtifactDraft, type ArtifactOperation } from '@/features/artifacts/domain/operations';
import type { DependencyEdge } from '@/contracts/dependency-edges';
import { requirePlan, validateOperationalPlan, type OperationalPlanContent } from './model';

function json(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new ContentValidationError('non-json-value');
  return JSON.parse(encoded) as JsonValue;
}
const same = (a: unknown, b: unknown) => hashJson(json(a ?? null)) === hashJson(json(b ?? null));

export function planDraft(snapshot: ArtifactSnapshot) {
  requirePlan(snapshot.content);
  const graph = new MerkleJson();
  return new ArtifactDraft(graph, graph.encode(json(createEditorArtifactState(snapshot))));
}

export function planOperationsCommand(
  snapshot: ArtifactSnapshot,
  operations: ArtifactOperation[],
  reason: string,
  options: { metadataAt?: string; dependencyEdges?: DependencyEdge[] } = {},
): CommandGroupDraft {
  const sources = expectedSourceRevisions(snapshot);
  return {
    metadataAt: options.metadataAt ?? new Date().toISOString(),
    expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision },
    expectedSourceRevisions: sources,
    ...(options.dependencyEdges?.length ? { dependencyEdges: options.dependencyEdges } : {}),
    commands: [{ artifactId: snapshot.artifact.id, baseRevision: snapshot.artifact.currentRevision, kind: 'plan', operations, expectedSourceRevisions: sources, reason }],
  };
}

/** Builds checked canonical entry operations; stable IDs survive insert, remove and move. */
export async function planCommand(snapshot: ArtifactSnapshot, rawDesired: OperationalPlanContent, reason: string): Promise<CommandGroupDraft | null> {
  const before = requirePlan(snapshot.content), desired = validateOperationalPlan(rawDesired);
  if (before.timezone !== desired.timezone) throw new ContentValidationError('operations.errors.timezoneRequiresPlanSettings');
  const oldIds = before.entries.map((entry) => entry.id), desiredIds = desired.entries.map((entry) => entry.id);
  if (new Set(desiredIds).size !== desiredIds.length) throw new ContentValidationError('duplicate-element-id');
  const desiredById = new Map(desired.entries.map((entry) => [entry.id, entry]));
  const draft = planDraft(snapshot), operations: ArtifactOperation[] = [], metadataAt = new Date().toISOString();
  const context = { actorId: snapshot.viewer.userId, at: metadataAt, origin: 'human' as const, reason };
  async function append(operation: ArtifactOperation) {
    await draft.apply([operation], context); operations.push(operation);
    if (operations.length > 1000) throw new ContentValidationError('operations.errors.editLimit');
  }
  // Remove first so a deleted predecessor cannot invalidate a later placement.
  for (const id of oldIds.filter((id) => !desiredById.has(id))) {
    const target = await draft.target(id);
    if (!target) throw new ContentValidationError('missing-target');
    await append({ targetId: id, op: 'remove', beforeHash: target.hash });
  }
  // Insert from the end: the next desired sibling is always present.
  let beforeId: string | null = null;
  for (const entry of [...desired.entries].reverse()) {
    const target = await draft.target(entry.id);
    if (!target) await append({ targetId: entry.id, op: 'insert', beforeHash: null, value: json({ node: entry, beforeId }) });
    beforeId = entry.id;
  }
  // Update complete entry values. Artifact operations protect stable IDs.
  for (const entry of desired.entries) {
    const old = before.entries.find((item) => item.id === entry.id);
    if (!old || same(old, entry)) continue;
    const target = await draft.target(entry.id);
    if (!target) throw new ContentValidationError('missing-target');
    await append({ targetId: entry.id, op: 'set', beforeHash: target.hash, value: json(entry) });
  }
  // Apply a deterministic order after content edits. Moving from the end keeps
  // the `beforeId` anchor stable and yields exactly the requested order.
  beforeId = null;
  for (const entry of [...desired.entries].reverse()) {
    const state = await draft.state();
    const currentOrder = requirePlan(state.content).entries.map((item) => item.id);
    const current = currentOrder.indexOf(entry.id), expectedNext = beforeId;
    const actualNext = currentOrder[current + 1] ?? null;
    if (actualNext !== expectedNext) {
      const target = await draft.target(entry.id);
      if (!target) throw new ContentValidationError('missing-target');
      await append({ targetId: entry.id, op: 'move', beforeHash: target.hash, value: json({ beforeId }) });
    }
    beforeId = entry.id;
  }
  if (!same(requirePlan((await draft.state()).content), desired)) throw new ContentValidationError('operations.errors.commandMismatch');
  return operations.length ? planOperationsCommand(snapshot, operations, reason, { metadataAt }) : null;
}

export async function singleEntryCommand(
  snapshot: ArtifactSnapshot,
  operation: 'set' | 'insert' | 'remove' | 'move',
  targetId: string,
  value: JsonValue | undefined,
  reason: string,
  dependencyEdges?: DependencyEdge[],
): Promise<CommandGroupDraft> {
  const target = await planDraft(snapshot).target(targetId);
  if (operation !== 'insert' && !target) throw new ContentValidationError('missing-target');
  if (operation === 'insert' && target) throw new ContentValidationError('duplicate-element-id');
  const command: ArtifactOperation = { targetId, op: operation, beforeHash: target?.hash ?? null, ...(value === undefined ? {} : { value }) };
  return planOperationsCommand(snapshot, [command], reason, { dependencyEdges });
}

/** Persists a human planning lock in artifact metadata without changing task content. */
export async function entryLockCommand(
  snapshot: ArtifactSnapshot,
  targetId: string,
  locked: boolean,
  reason: string,
): Promise<CommandGroupDraft> {
  const draft = planDraft(snapshot);
  const target = await draft.target(targetId);
  if (!target) throw new ContentValidationError('missing-target');
  const trimmedReason = reason.trim();
  if (locked && !trimmedReason) throw new ContentValidationError('operations.errors.lockReasonRequired');
  const value: JsonValue = locked ? { locked: true, reason: trimmedReason } : { locked: false };
  return planOperationsCommand(snapshot, [{ targetId, op: 'lock', beforeHash: target.hash, value }], reason);
}

