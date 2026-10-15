import type { CommandGroupDraft } from '@/features/artifacts/client/grouping';
import type { ArtifactSnapshot, SourceFreshness } from '@/features/artifacts/contracts';
import type { SourceRef } from '@/contracts/artifacts';
import { createEditorArtifactState, expectedSourceRevisions as currentSourceRevisions } from '@/features/artifacts/client/snapshot-state';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import { ArtifactDraft, type ArtifactOperation } from '@/features/artifacts/domain/operations';
import { ContentValidationError, hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { asJson, nodeId, readDocument, type DocumentContent, type DocumentNode } from './document';

function same(a: unknown, b: unknown) { return hashJson(a as JsonValue) === hashJson(b as JsonValue); }
function ids(node: DocumentNode): Set<string> {
  const all = new Set<string>();
  const visit = (item: DocumentNode) => { const id = nodeId(item); if (id) all.add(id); item.content?.forEach(visit); };
  visit(node); return all;
}

export function documentDraft(snapshot: ArtifactSnapshot): ArtifactDraft {
  readDocument(snapshot.content);
  const state = createEditorArtifactState(snapshot);
  const graph = new MerkleJson();
  return new ArtifactDraft(graph, graph.encode(state as unknown as JsonValue));
}

/** Structural edits use an atomic ancestor replacement only when reparenting cannot be split safely. */
export async function documentOperations(snapshot: ArtifactSnapshot, desired: DocumentContent, reason: string): Promise<ArtifactOperation[]> {
  const before = readDocument(snapshot.content), after = readDocument(desired);
  if (nodeId(before.document) !== nodeId(after.document)) throw new ContentValidationError('cannot-change-stable-id');
  const draft = documentDraft(snapshot), operations: ArtifactOperation[] = [];
  const context = { actorId: snapshot.viewer.userId, at: new Date().toISOString(), origin: 'human' as const, reason };
  async function add(targetId: string, op: ArtifactOperation['op'], value?: JsonValue) {
    const target = await draft.target(targetId);
    const operation: ArtifactOperation = { targetId, op, beforeHash: target?.hash ?? null, ...(value !== undefined ? { value } : {}) };
    await draft.apply([operation], context); operations.push(operation);
    if (operations.length > 1000) throw new ContentValidationError('too-many-operations');
  }
  async function visit(old: DocumentNode, next: DocumentNode) {
    if (same(old, next)) return;
    const targetId = nodeId(old);
    if (!targetId) throw new ContentValidationError('missing-stable-id');
    const oldChildren = old.content ?? [], newChildren = next.content ?? [];
    const oldIds = oldChildren.map(nodeId), newIds = newChildren.map(nodeId);
    const ownUnchanged = same({ ...old, content: [] }, { ...next, content: [] });
    if (ownUnchanged && oldChildren.length === newChildren.length && oldIds.every((id, i) => id && id === newIds[i])) {
      for (let i = 0; i < oldChildren.length; i++) await visit(oldChildren[i]!, newChildren[i]!);
      return;
    }
    // Lists and table geometry must remain valid at every canonical command boundary.
    const canReconcile = old.type === 'doc' && next.type === 'doc' && ownUnchanged && oldIds.every(Boolean) && newIds.every(Boolean);
    if (canReconcile) {
      const oldAll = ids(old), newAll = ids(next);
      const added = newChildren.filter((item) => !oldIds.includes(nodeId(item)));
      const removed = oldChildren.filter((item) => !newIds.includes(nodeId(item)));
      const reparented = added.some((item) => [...ids(item)].some((id) => oldAll.has(id))) || removed.some((item) => [...ids(item)].some((id) => newAll.has(id)));
      if (!reparented) {
        // Insert first so deleting the last previous paragraph never produces an empty document.
        for (const item of added) await add(nodeId(item)!, 'insert', { parentId: targetId, beforeId: null, node: asJson(item) });
        for (const item of removed) await add(nodeId(item)!, 'remove');
        for (let i = newChildren.length - 1; i >= 0; i--) {
          const item = newChildren[i]!, id = nodeId(item)!, current = await draft.target(id);
          if (current?.position !== i) await add(id, 'move', { parentId: targetId, beforeId: nodeId(newChildren[i + 1]!) ?? null });
        }
        for (const item of newChildren) { const original = oldChildren.find((candidate) => nodeId(candidate) === nodeId(item)); if (original) await visit(original, item); }
        return;
      }
    }
    await add(targetId, 'set', asJson(next));
  }
  await visit(before.document, after.document);
  const actual = (await draft.state()).content;
  if (!same(actual, desired)) throw new ContentValidationError('document-command-mismatch');
  return operations;
}

export async function documentCommand(snapshot: ArtifactSnapshot, desired: DocumentContent, reason: string): Promise<CommandGroupDraft | null> {
  const operations = await documentOperations(snapshot, desired, reason);
  return operations.length ? commandForOperations(snapshot, operations, reason) : null;
}

export function commandForOperations(snapshot: ArtifactSnapshot, operations: ArtifactOperation[], reason: string, afterSourceRefs: readonly SourceRef[] = [], additionalFreshness: readonly SourceFreshness[] = []): CommandGroupDraft {
  const expectedSourceRevisions = currentSourceRevisions(snapshot, afterSourceRefs, additionalFreshness);
  return {
    expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision }, expectedSourceRevisions,
    commands: [{ artifactId: snapshot.artifact.id, baseRevision: snapshot.artifact.currentRevision, kind: 'document', operations, expectedSourceRevisions, reason }],
  };
}

export async function documentLock(snapshot: ArtifactSnapshot, targetId: string, locked: boolean, reason: string): Promise<CommandGroupDraft> {
  const target = await documentDraft(snapshot).target(targetId);
  if (!target) throw new ContentValidationError('missing-target');
  return commandForOperations(snapshot, [{ targetId, op: 'lock', beforeHash: target.hash, value: { locked, ...(locked ? { reason } : {}) } }], reason);
}
