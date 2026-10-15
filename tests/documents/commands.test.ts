import { describe, expect, it } from 'vitest';
import { commandForOperations, documentCommand, documentDraft, documentLock, documentOperations } from '@/features/documents/domain/commands';
import { inverseInputs } from '@/features/artifacts/domain/operations';
import { document, paragraph, snapshot } from './fixtures';

describe('direct document command adapter', () => {
  it('addresses one edited paragraph and preserves unrelated target hashes through undo and redo', async () => {
    const before = snapshot(), next = document([paragraph('first', 'Қызмет бағасы: 12 000 ₸'), paragraph('second', 'Delivery in Taraz')]);
    const commands = await documentOperations(before, next, 'Changed price');
    expect(commands.map((command) => command.targetId)).toEqual(['first']);
    const draft = documentDraft(before), otherHash = (await draft.target('second'))!.hash;
    const context = { actorId: before.viewer.userId, at: before.artifact.updatedAt, origin: 'human' as const, reason: 'Changed price' };
    const applied = await draft.apply(commands, context);
    expect((await draft.state()).content).toEqual(next);
    expect((await draft.target('second'))!.hash).toBe(otherHash);
    const undone = await draft.apply(inverseInputs(applied.inverse), { ...context, origin: 'history' }, applied.inverse);
    expect((await draft.state()).content).toEqual(before.content);
    await draft.apply(inverseInputs(undone.inverse), { ...context, origin: 'history' }, undone.inverse);
    expect((await draft.state()).content).toEqual(next);
  });
  it('uses insertion, removal and moves for new blocks, with hashes from each preceding operation', async () => {
    const before = snapshot();
    const next = document([paragraph('third', 'New condition'), paragraph('second', 'Delivery in Taraz'), paragraph('first', 'Ұсыныс')]);
    const changes = await documentOperations(before, next, 'Reorder conditions');
    expect(changes.some((change) => change.op === 'insert')).toBe(true);
    expect(changes.some((change) => change.op === 'move')).toBe(true);
    expect(changes.every((change) => change.targetId !== 'root')).toBe(true);
    const removing = await documentOperations(before, document([paragraph('new-only', 'Replaced content')]), 'Replace paragraph');
    expect(removing[0]!.op).toBe('insert');
    expect(removing.filter((change) => change.op === 'remove')).toHaveLength(2);
  });
  it('retains paragraph IDs when wrapping in a list and atomically changes only the structural ancestor', async () => {
    const before = snapshot();
    const after = document([{ type: 'bulletList', attrs: { id: 'list' }, content: [{ type: 'listItem', attrs: { id: 'item' }, content: [paragraph('first', 'Ұсыныс')] }] }, paragraph('second', 'Delivery in Taraz')]);
    const changes = await documentOperations(before, after, 'Make list');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.targetId).toBe('root');
    const nested = snapshot(after), edited = structuredClone(after);
    edited.document.content![0]!.content![0]!.content![0]!.content = [{ type: 'text', text: 'New list wording' }];
    expect((await documentOperations(nested, edited, 'Edit list'))[0]!.targetId).toBe('first');
  });
  it('formats a heading directly, rejects root-ID replacement, and makes no command for unchanged content', async () => {
    const before = snapshot(), next = structuredClone(before.content);
    next.document.content![0] = { type: 'heading', attrs: { id: 'first', level: 2 }, content: [{ type: 'text', text: 'Ұсыныс', marks: [{ type: 'bold' }] }] };
    expect((await documentOperations(before, next, 'Heading'))[0]!.targetId).toBe('first');
    expect(await documentCommand(before, before.content, 'Unchanged')).toBeNull();
    next.document.attrs!.id = 'different-root';
    await expect(documentOperations(before, next, 'Replace')).rejects.toThrow('cannot-change-stable-id');
  });
  it('preserves a bound source and records a manual override; locks protect only against AI changes', async () => {
    const before = snapshot();
    const sourceRef = { sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 3 };
    before.artifact = { ...before.artifact, sourceRefs: [sourceRef], bindings: [{ targetElementId: 'first', sourceRef, transformId: 'identity', updateMode: 'propose' }] };
    before.sourceFreshness = [{ sourceRef, status: 'current', sourceStatus: 'current', currentRevision: 3, currentVersionId: sourceRef.sourceVersionId }];
    const next = document([paragraph('first', 'Local wording'), paragraph('second', 'Delivery in Taraz')]);
    const command = await documentCommand(before, next, 'Local exception');
    expect(command!.expectedSourceRevisions).toEqual({ [sourceRef.sourceId]: 3 });
    const draft = documentDraft(before), context = { actorId: before.viewer.userId, at: before.artifact.updatedAt, origin: 'human' as const, reason: 'Local exception' };
    await draft.apply(command!.commands[0]!.operations, context);
    expect((await draft.target('first'))!.binding).toMatchObject({ sourceRef, override: { reason: 'Local exception' } });
    const lock = await documentLock(before, 'second', true, 'Approved terms');
    const protectedDraft = documentDraft(before);
    await protectedDraft.apply(lock.commands[0]!.operations, context);
    await expect(protectedDraft.apply([{ targetId: 'second', op: 'set', beforeHash: (await protectedDraft.target('second'))!.hash, value: paragraph('second', 'AI rewrite') as never }], { ...context, origin: 'ai' })).rejects.toThrow('locked');
  });
  it('guards a manual edit with the current source head while preserving stale pinned provenance', async () => {
    const before = snapshot();
    const sourceRef = { sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 2 };
    before.artifact.sourceRefs = [sourceRef];
    before.sourceFreshness = [{ sourceRef, status: 'stale', sourceStatus: 'stale', currentRevision: 3, currentVersionId: crypto.randomUUID() }];
    const next = document([paragraph('first', 'My own wording'), paragraph('second', 'Delivery in Taraz')]);
    const result = await documentCommand(before, next, 'Manual wording');
    expect(result!.expectedSourceRevisions).toEqual({ [sourceRef.sourceId]: 3 });
    expect(result!.commands[0]!.expectedSourceRevisions).toEqual(result!.expectedSourceRevisions);
    expect(before.artifact.sourceRefs).toEqual([sourceRef]);
  });
  it('guards both removed and newly added source refs and refuses an unknown current head', () => {
    const before = snapshot();
    const oldRef = { sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 2 };
    const newRef = { sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 4 };
    before.artifact.sourceRefs = [oldRef];
    before.sourceFreshness = [{ sourceRef: oldRef, status: 'stale', sourceStatus: 'stale', currentRevision: 3 }];
    const operation = { targetId: 'first', op: 'unbind' as const, beforeHash: null };
    expect(() => commandForOperations(before, [operation], 'Change binding', [newRef])).toThrow('source-current-revision-unavailable');
    const command = commandForOperations(before, [operation], 'Change binding', [newRef], [{ sourceRef: newRef, status: 'stale', sourceStatus: 'stale', currentRevision: 5 }]);
    expect(command.expectedSourceRevisions).toEqual({ [oldRef.sourceId]: 3, [newRef.sourceId]: 5 });
    before.sourceFreshness = [{ sourceRef: oldRef, status: 'unknown', sourceStatus: 'unknown' }];
    expect(() => commandForOperations(before, [operation], 'Edit')).toThrow('source-current-revision-unavailable');
  });
});
