import { describe, expect, it } from 'vitest';
import { createDemoSeed } from '../../src/features/demo/domain/sample';
import { createDemoStore, demoArtifact } from '../../src/features/demo/domain/store';
import { artifactDraft, selectableGroups } from '../../src/features/dependencies/domain/proposal';
import { createArtifactTargetResolver } from '../../src/features/artifacts/domain/targets';
import { createArtifactState } from '../../src/features/artifacts/domain/content-state';
import { hashJson } from '../../src/features/artifacts/domain/canonical';
import type { ArtifactContent, JsonValue } from '../../src/features/artifacts/domain/content-models';
async function changePrice(store: ReturnType<typeof createDemoStore>, value: number) {
  const snapshot = store.snapshot(store.seed.tableId), target = (await artifactDraft(demoArtifact(snapshot)).target(store.seed.priceTargetId))!;
  return store.apply({ commandGroupId: crypto.randomUUID(), expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision }, expectedSourceRevisions: { [store.seed.sourceRef.sourceId]: 1 }, commands: [{ commandId: crypto.randomUUID(), artifactId: snapshot.artifact.id, kind: 'table', baseRevision: snapshot.artifact.currentRevision, expectedSourceRevisions: { [store.seed.sourceRef.sourceId]: 1 }, reason: 'Sample price edit', operations: [{ targetId: target.targetId, op: 'set', beforeHash: target.hash, value: { v: value, t: 2 } }] }] });
}
describe('isolated example uses canonical editing and connected proposals', () => {
  it.each(['ru', 'kk', 'en'] as const)('updates exact estimate/document values and reopens saved %s content', async (locale) => {
    let saved = ''; const store = createDemoStore(createDemoSeed(locale), { persist: (value) => { saved = value; } });
    expect(saved).toBe('');
    const before = createArtifactTargetResolver(store.snapshot(store.seed.documentId).content)('personal-phrase')!.value;
    await changePrice(store, 3000.25);
    const proposal = await store.prepare();
    expect(proposal.changes.filter((change) => change.state === 'ready')).toHaveLength(3);
    const applied = await store.accept(proposal, selectableGroups(proposal));
    expect(applied.artifacts).toHaveLength(2);
    const doc = store.snapshot(store.seed.documentId);
    expect(createArtifactTargetResolver(doc.content)('personal-phrase')!.value).toEqual(before);
    expect(JSON.stringify(createArtifactTargetResolver(doc.content)('total-amount')!.value)).toContain('000');
    const reopened = createDemoStore(createDemoSeed(locale), { saved });
    expect(reopened.snapshot(reopened.seed.documentId).content).toEqual(doc.content);
    await reopened.client.historyAction('undo', { workspaceId: doc.viewer.workspaceId, expectedAuthzVersion: 1, commandGroupId: crypto.randomUUID(), targetCommandGroupId: applied.commandGroupId, expectedArtifactRevisions: applied.committedRevisionVector, expectedSourceRevisions: { [store.seed.sourceRef.sourceId]: 1 } }, { viewer: doc.viewer });
    expect(createArtifactTargetResolver(reopened.snapshot(reopened.seed.documentId).content)('total-amount')!.value).toEqual(createArtifactTargetResolver(store.seed.snapshots[1]!.content)('total-amount')!.value);
  });
  it('guards a stale sample proposal and preserves an independently edited phrase', async () => {
    const store = createDemoStore(createDemoSeed('ru')); await changePrice(store, 3000);
    const proposal = await store.prepare(); await changePrice(store, 3500);
    await expect(store.accept(proposal, selectableGroups(proposal))).rejects.toThrow('sample-proposal-stale');
    expect(store.snapshot(store.seed.documentId).artifact.currentRevision).toBe(0);
  });
  it('serves editors entirely through its injected transport', async () => {
    const store = createDemoStore(createDemoSeed('en')), initial = store.snapshot(store.seed.documentId), opts = { viewer: initial.viewer };
    expect((await store.client.snapshot(initial.artifact.id, opts)).content).toEqual(initial.content);
    expect((await store.client.versions(initial.artifact.id, opts)).versions).toHaveLength(1);
    expect((await store.client.access([initial.artifact.id], opts)).authorizedArtifactIds).toEqual([initial.artifact.id]);
    expect((await store.client.events('0', opts)).events).toEqual([]);
  });
  it('keeps property binding map keys private when reporting missing demo targets', async () => {
    const seed = createDemoSeed('en'), planSnapshot = seed.snapshots[0]!;
    const plan: ArtifactContent = { kind: 'plan', schemaVersion: 1, timezone: 'Asia/Qyzylorda', entries: [{ id: 'review-offer', title: 'Review 100 ₸ offer', status: 'todo', resourceIds: [], dependencies: [], checklist: [], availabilityVersionIds: [] }] };
    const bindings = [{ targetElementId: 'review-offer', targetProperty: 'text' as const, sourceRef: seed.sourceRef, transformId: 'offer-title', updateMode: 'propose' as const }];
    const artifactState = createArtifactState(plan, [seed.sourceRef], bindings), contentRef = { id: crypto.randomUUID(), hash: hashJson(artifactState as unknown as JsonValue) };
    planSnapshot.artifact = { ...planSnapshot.artifact, kind: 'plan', contentRef, bindings }; planSnapshot.content = plan; planSnapshot.version = { ...planSnapshot.version, contentRef, snapshotHash: contentRef.hash };
    const store = createDemoStore(seed), snapshot = store.snapshot(seed.tableId), target = (await artifactDraft(demoArtifact(snapshot)).target('review-offer', 'text'))!;
    await store.apply({ commandGroupId: crypto.randomUUID(), expectedArtifactRevisions: { [seed.tableId]: 0 }, expectedSourceRevisions: { [seed.sourceRef.sourceId]: 1 }, commands: [{ commandId: crypto.randomUUID(), artifactId: seed.tableId, kind: 'plan', baseRevision: 0, expectedSourceRevisions: { [seed.sourceRef.sourceId]: 1 }, reason: 'Update title', operations: [{ targetId: 'review-offer', targetProperty: 'text', op: 'set', beforeHash: target.hash, value: 'Review updated offer' }] }] });
    expect(store.snapshot(seed.tableId).missingTargets).toEqual([]);
    expect(store.snapshot(seed.tableId).artifact.bindings.map((binding) => binding.targetProperty)).toEqual(['text']);
  });
});
