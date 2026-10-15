import { describe, expect, it } from 'vitest';
import { createArtifactState } from '@/features/artifacts/domain/content-state';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import { ArtifactDraft, inverseInputs, type OperationContext } from '@/features/artifacts/domain/operations';
import { applyDesignAction, designFromState, prepareDesignAction, type DesignAction } from '@/features/designs/domain/actions';
import { layerLocations } from '@/features/designs/domain/model';
import { at, content, ids, snapshot, state, textLayer } from './fixtures';

const context: OperationContext = { actorId: ids.user, at, origin: 'human', reason: 'Change design' };
function options() { let sequence = 0; return { context, makeId: () => `new-${++sequence}` }; }
const run = (action: DesignAction) => applyDesignAction(state(), action, options());

describe('design actions use the authoritative artifact journal', () => {
  it('guards edits and removals with authorized current source heads while keeping pinned bindings', async () => {
    const initial = snapshot(), sourceRef = { sourceId: '7c48e4e5-0264-477a-881b-a453cc78c7fb', sourceVersionId: '087b67b3-07e1-475d-ad5a-ad1e3d74efb3', revision: 2 };
    initial.artifact.sourceRefs = [sourceRef];
    initial.artifact.bindings = [{ targetElementId: 'title', sourceRef, transformId: 'display-text', updateMode: 'propose' }];
    initial.sourceFreshness = [{ sourceRef, status: 'stale', sourceStatus: 'stale', currentRevision: 3 }];
    const edit = await prepareDesignAction(initial, { type: 'translate', ids: ['photo'], x: 10, y: 0 }, 'Move photo', { at });
    expect(edit.command.expectedSourceRevisions).toEqual({ [sourceRef.sourceId]: 3 });
    expect(edit.state.bindings.title!.sourceRef.revision).toBe(2);
    const removal = await prepareDesignAction(initial, { type: 'unbind', id: 'title' }, 'Unlink title', { at });
    expect(removal.command.commands[0]!.expectedSourceRevisions).toEqual({ [sourceRef.sourceId]: 3 });
    initial.sourceFreshness = [{ sourceRef, status: 'unknown', sourceStatus: 'unknown' }];
    await expect(prepareDesignAction(initial, { type: 'remove', ids: ['title'] }, 'Remove title')).rejects.toThrow('source-current-revision-unavailable');
  });
  it('requires authorized freshness for newly bound sources, never treating the pinned revision as current', async () => {
    const sourceRef = { sourceId: '7c48e4e5-0264-477a-881b-a453cc78c7fb', sourceVersionId: '087b67b3-07e1-475d-ad5a-ad1e3d74efb3', revision: 2 };
    const action: DesignAction = { type: 'bind', id: 'title', sourceRef, transformId: 'display-text', value: 'New title' };
    await expect(prepareDesignAction(snapshot(), action, 'Bind title')).rejects.toThrow('source-current-revision-unavailable');
    const result = await prepareDesignAction(snapshot(), action, 'Bind title', { at, sourceFreshness: [{ sourceRef, status: 'stale', sourceStatus: 'stale', currentRevision: 4 }] });
    expect(result.command.expectedSourceRevisions).toEqual({ [sourceRef.sourceId]: 4 });
    expect(result.state.bindings.title!.sourceRef).toEqual(sourceRef);
  });
  it('groups stable layers, transforms and ungroups them with exact undo/redo', async () => {
    const initial = state(), grouped = await applyDesignAction(initial, { type: 'group', ids: ['title', 'photo'] }, options());
    const layers = designFromState(grouped.state).pages[0]!.layers, group = layers[0]!;
    expect(group.id).toBe('new-1'); expect(group.layers!.map((layer) => layer.id)).toEqual(['title', 'photo']);
    expect(group.layers![0]!.text).toBe('Қазақша title'); expect(group.layers![1]!.assetId).toBe(ids.image);
    expect(group.layers![1]!.transform).toMatchObject({ x: 290, y: 380 });
    const transformed = await applyDesignAction(grouped.state, { type: 'update-layer', id: group.id, patch: { transform: { ...group.transform, x: 80, y: 100, rotation: 35 } } }, options());
    const ungrouped = await applyDesignAction(transformed.state, { type: 'ungroup', ids: [group.id] }, options());
    expect(designFromState(ungrouped.state).pages[0]!.layers.map((layer) => layer.id)).toEqual(['title', 'photo', 'price']);
    const graph = new MerkleJson(), draft = new ArtifactDraft(graph, graph.encode(initial as unknown as JsonValue));
    const receipt = await draft.apply(grouped.operations, context);
    expect((await draft.state()).content).toEqual(grouped.state.content);
    const undo = await draft.apply(inverseInputs(receipt.inverse), { ...context, origin: 'history' }, receipt.inverse);
    expect((await draft.state()).content).toEqual(initial.content);
    await draft.apply(inverseInputs(undo.inverse), { ...context, origin: 'history' }, undo.inverse);
    expect((await draft.state()).content).toEqual(grouped.state.content);
  });
  it('preserves source bindings while moving/grouping and clones pinned references under new IDs', async () => {
    const original = state(), sourceRef = { sourceId: '7c48e4e5-0264-477a-881b-a453cc78c7fb', sourceVersionId: '087b67b3-07e1-475d-ad5a-ad1e3d74efb3', revision: 2 };
    original.bindings.title = { targetElementId: 'title', sourceRef, transformId: 'display-text', updateMode: 'propose' };
    const result = await applyDesignAction(original, { type: 'duplicate', ids: ['title'] }, options());
    expect(result.state.bindings['new-1']).toMatchObject({ targetElementId: 'new-1', sourceRef });
    expect(result.state.bindings.title).toEqual(original.bindings.title);
    expect(layerLocations(designFromState(result.state)).get('new-1')!.layer.text).toBe('Қазақша title');
  });
  it('respects locks including descendants and lets the person explicitly unlock', async () => {
    const initial = state(); initial.locks.title = { actorId: ids.user, at, reason: 'Keep title' };
    for (const action of [{ type: 'remove', ids: ['title'] }, { type: 'group', ids: ['title', 'photo'] }, { type: 'style', ids: ['title'], style: { fill: '#ffffff' } }] satisfies DesignAction[]) await expect(applyDesignAction(initial, action, options())).rejects.toThrow('locked');
    const unlocked = await applyDesignAction(initial, { type: 'lock', ids: ['title'], locked: false }, options());
    expect(unlocked.state.locks.title).toBeUndefined();
    expect((await applyDesignAction(unlocked.state, { type: 'remove', ids: ['title'] }, options())).selection).toEqual([]);
    const grouped = await run({ type: 'group', ids: ['title', 'photo'] }); grouped.state.locks.title = initial.locks.title!;
    await expect(applyDesignAction(grouped.state, { type: 'translate', ids: ['new-1'], x: 10, y: 0 }, options())).rejects.toThrow('locked');
  });
  it.each([
    ['front', ['title'], ['photo', 'price', 'title']], ['back', ['price'], ['price', 'title', 'photo']],
    ['forward', ['title'], ['photo', 'title', 'price']], ['backward', ['price'], ['title', 'price', 'photo']],
    ['front', ['title', 'photo'], ['price', 'title', 'photo']], ['back', ['photo', 'price'], ['photo', 'price', 'title']],
  ] as const)('moves selected layers %s while preserving relative order', async (direction, selected, expected) => {
    const result = await run({ type: 'order', ids: [...selected], direction });
    expect(designFromState(result.state).pages[0]!.layers.map((layer) => layer.id)).toEqual(expected);
  });
  it('edits pages and duplicates nested layers without reusing IDs or changing the original', async () => {
    const original = content(), initial = createArtifactState(original);
    const duplicate = await applyDesignAction(initial, { type: 'duplicate-page', id: 'page' }, options());
    const pages = designFromState(duplicate.state).pages;
    expect(pages).toHaveLength(2); expect(pages[0]).toEqual(original.pages[0]);
    expect(pages[1]!.layers.map((layer) => layer.id)).toEqual(['new-2', 'new-3', 'new-4']);
    const updated = await applyDesignAction(duplicate.state, { type: 'update-page', id: pages[1]!.id, patch: { width: 1920, height: 1080 } }, options());
    expect(designFromState(updated.state).pages[1]!.width).toBe(1920);
    const removed = await applyDesignAction(updated.state, { type: 'remove-page', id: 'page' }, options());
    expect(designFromState(removed.state).pages).toHaveLength(1);
    await expect(run({ type: 'remove-page', id: 'page' })).rejects.toThrow('last-page');
  });
  it('rejects invalid input and preserves the supplied state after failed actions', async () => {
    const initial = state(), unchanged = structuredClone(initial);
    await expect(applyDesignAction(initial, { type: 'update-layer', id: 'photo', patch: { assetId: 'not-an-id' } }, options())).rejects.toThrow();
    await expect(applyDesignAction(initial, { type: 'translate', ids: ['title'], x: Number.NaN, y: 0 }, options())).rejects.toThrow();
    await expect(applyDesignAction(initial, { type: 'insert-layer', pageId: 'page', layer: textLayer('title') }, options())).rejects.toThrow();
    expect(initial).toEqual(unchanged);
  });
  it('builds one canonical command against the exact authorized revision and rejects stale target hashes', async () => {
    const initial = snapshot(), prepared = await prepareDesignAction(initial, { type: 'translate', ids: ['title', 'photo'], x: 20, y: 10 }, 'Move selected layers', { at });
    expect(prepared.command.commands).toHaveLength(1); expect(prepared.command.commands[0]!.operations).toHaveLength(2);
    expect(prepared.command.expectedArtifactRevisions).toEqual({ [ids.artifact]: 1 });
    const graph = new MerkleJson(), draft = new ArtifactDraft(graph, graph.encode(state() as unknown as JsonValue));
    await draft.apply([{ targetId: 'photo', op: 'set', value: { ...content().pages[0]!.layers[1]!, hidden: true } as unknown as JsonValue, beforeHash: (await draft.target('photo'))!.hash }], context);
    const root = draft.root;
    await expect(draft.apply(prepared.operations, context)).rejects.toThrow('before-hash'); expect(draft.root).toBe(root);
    initial.permissions.edit = false;
    await expect(prepareDesignAction(initial, { type: 'remove', ids: ['title'] }, 'Remove')).rejects.toThrow('read-only');
  });
});
