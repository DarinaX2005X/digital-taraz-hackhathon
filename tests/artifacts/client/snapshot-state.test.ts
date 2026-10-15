import { describe, expect, it } from 'vitest';
import { createEditorArtifactState, expectedSourceRevisions } from '@/features/artifacts/client/snapshot-state';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import { ArtifactDraft } from '@/features/artifacts/domain/operations';
import { createArtifactTargetResolver } from '@/features/artifacts/domain/targets';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { ids, snapshot } from './fixtures';

const sourceRef = { sourceId: '3401f1f2-2f6c-4e01-8a8d-427863d9658d', sourceVersionId: 'f87c6f66-625e-4028-a410-1618c471b8ac', revision: 1 };
const lock = { reason: 'Keep checked wording', actorId: ids.user, at: '2026-10-14T00:00:00.000Z' };
const binding = (targetElementId: string) => ({ targetElementId, sourceRef, transformId: 'copy', updateMode: 'propose' as const });
function example() {
  const value = snapshot();
  value.content = { kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: 'root' }, content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [] }] } };
  return value;
}

describe('editor state reconstruction from authorized snapshots', () => {
  it('guards manual edits with the current source head while retaining pinned provenance', () => {
    const value = example();
    value.artifact.sourceRefs = [sourceRef, { ...sourceRef, revision: 2 }];
    value.sourceFreshness = value.artifact.sourceRefs.map((ref) => ({ sourceRef: ref, sourceStatus: 'stale', status: 'stale', currentRevision: 3 }));
    expect(expectedSourceRevisions(value)).toEqual({ [sourceRef.sourceId]: 3 });
    expect(value.artifact.sourceRefs.map((ref) => ref.revision)).toEqual([1, 2]);
  });
  it('includes removed and newly bound sources but excludes unrelated freshness', () => {
    const value = example(), added = { ...sourceRef, sourceId: ids.otherArtifact }, unrelated = { ...sourceRef, sourceId: ids.otherWorkspace };
    value.artifact.sourceRefs = [sourceRef];
    value.sourceFreshness = [{ sourceRef, sourceStatus: 'stale', status: 'stale', currentRevision: 3 }];
    expect(expectedSourceRevisions(value, [])).toEqual({ [sourceRef.sourceId]: 3 });
    expect(() => expectedSourceRevisions(value, [added])).toThrow('source-current-revision-unavailable');
    expect(expectedSourceRevisions(value, [added], [{ sourceRef: added, sourceStatus: 'current', status: 'current', currentRevision: 1 }, { sourceRef: unrelated, sourceStatus: 'unknown', status: 'unknown' }])).toEqual({ [sourceRef.sourceId]: 3, [added.sourceId]: 1 });
  });
  it('fails closed for missing, unknown or inconsistent source heads', () => {
    const value = example(); value.artifact.sourceRefs = [sourceRef];
    expect(() => expectedSourceRevisions(value)).toThrow('source-current-revision-unavailable');
    value.sourceFreshness = [{ sourceRef, sourceStatus: 'unknown', status: 'unknown' }];
    expect(() => expectedSourceRevisions(value)).toThrow('source-current-revision-unavailable');
    value.sourceFreshness = [{ sourceRef, sourceStatus: 'stale', status: 'stale', currentRevision: 2 }];
    expect(() => expectedSourceRevisions(value, [], [{ sourceRef, sourceStatus: 'stale', status: 'stale', currentRevision: 3 }])).toThrow('source-current-revision-conflict');
  });
  it('preserves declared missing bindings and locks without mutating the snapshot', async () => {
    const value = example();
    value.artifact.sourceRefs = [sourceRef]; value.artifact.bindings = [binding('removed')];
    value.locks = { removed: lock }; value.missingTargets = ['removed'];
    const before = structuredClone(value), state = createEditorArtifactState(value);
    expect(state.bindings.removed).toEqual(binding('removed')); expect(state.locks.removed).toEqual(lock);
    expect(state.retiredTargets).toEqual({ removed: true }); expect(state.sourceRefs).toEqual([]);
    expect(value).toEqual(before);
    const graph = new MerkleJson(), draft = new ArtifactDraft(graph, graph.encode(state as unknown as JsonValue));
    expect(await draft.target('removed')).toBeNull();
    await expect(draft.apply([{ targetId: 'removed', op: 'insert', beforeHash: null, value: { parentId: 'root', beforeId: null, node: { type: 'paragraph', attrs: { id: 'removed' }, content: [] } } }], { actorId: ids.user, origin: 'human', at: lock.at, reason: 'Verify stable IDs' })).rejects.toThrow('cannot-reuse-retired-id');
  });
  it('keeps existing bound/locked target hashes identical to snapshot resolution', async () => {
    const value = example();
    value.artifact.sourceRefs = [sourceRef]; value.artifact.bindings = [binding('p1')]; value.locks = { p1: lock };
    const state = createEditorArtifactState(value), graph = new MerkleJson();
    const draft = new ArtifactDraft(graph, graph.encode(state as unknown as JsonValue));
    expect(await draft.target('p1')).toEqual(createArtifactTargetResolver(value.content, value.artifact.bindings, value.locks)('p1'));
  });
  it('rejects undeclared missing metadata, present missing IDs and undeclared source refs', () => {
    const value = example(); value.artifact.sourceRefs = [sourceRef]; value.artifact.bindings = [binding('removed')];
    expect(() => createEditorArtifactState(value)).toThrow('missing-binding-target');
    value.missingTargets = ['removed', 'p1'];
    expect(() => createEditorArtifactState(value)).toThrow('missing-target-is-present');
    value.missingTargets = ['removed']; value.artifact.sourceRefs = [];
    expect(() => createEditorArtifactState(value)).toThrow('binding-source-not-declared');
  });
});
