import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import type { CommandGroupInput } from '@/contracts/commands';
import { createDocumentController } from '@/features/documents/client/controller';
import { document, paragraph, snapshot } from './fixtures';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { LocalDraft } from '@/features/artifacts/client/local-records';
import { receipt } from '../artifacts/client/fixtures';
import { documentCommand } from '@/features/documents/domain/commands';

function harness(initial = snapshot(), recovered: LocalDraft[] = []) {
  let current: ArtifactSnapshot = initial, drafts = recovered;
  const listeners = new Set<() => void>(), sent: CommandGroupInput[] = [];
  const emit = () => listeners.forEach((listener) => listener());
  const session = {
    getSnapshot: () => ({ phase: 'ready', snapshot: current, storageReady: true, drafts, pending: [] }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    writeDraft: vi.fn(async (draft: LocalDraft) => { drafts = [draft]; }),
    enqueue: vi.fn(async (command: CommandGroupInput) => { sent.push(command); }),
    flush: vi.fn(async () => true),
    discardReviewed: vi.fn(async () => { drafts = []; return true; }),
  };
  const controller = createDocumentController(session as unknown as ArtifactSession, () => 'Manual edit');
  controller.mount();
  return { controller, session, sent, changeSnapshot(next: ArtifactSnapshot) { current = next; emit(); }, acknowledge(index: number, content: ArtifactSnapshot['content']) {
    const command = sent[index]!, committed = receipt(command), revision = command.commands[0]!.baseRevision + 1;
    current = { ...current, artifact: { ...current.artifact, currentRevision: revision }, version: { ...current.version, revision }, content, history: [committed.historyGroup, ...current.history] };
    drafts = []; emit();
  } };
}

afterEach(() => vi.useRealTimers());

describe('document controller source refresh', () => {
  it('uses refreshed source heads even when the artifact revision did not change', async () => {
    vi.useFakeTimers();
    const initial = snapshot();
    const sourceRef = { sourceId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), revision: 2 };
    initial.artifact.sourceRefs = [sourceRef];
    initial.sourceFreshness = [{ sourceRef, status: 'current', sourceStatus: 'current', currentRevision: 2 }];
    let current = initial;
    const listeners = new Set<() => void>();
    const sent: CommandGroupInput[] = [];
    const session = {
      getSnapshot: () => ({ phase: 'ready', snapshot: current, storageReady: true, drafts: [], pending: [] }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      writeDraft: vi.fn(async () => undefined),
      enqueue: vi.fn(async (command: CommandGroupInput) => { sent.push(command); }),
      flush: vi.fn(async () => true),
    } as unknown as ArtifactSession;
    const controller = createDocumentController(session, () => 'Manual edit');
    controller.mount();
    current = { ...initial, sourceFreshness: [{ sourceRef, status: 'stale', sourceStatus: 'stale', currentRevision: 3 }] };
    listeners.forEach((listener) => listener());
    expect(controller.change(document([paragraph('first', 'Changed manually'), paragraph('second', 'Delivery in Taraz')]))).toBe(true);
    await vi.advanceTimersByTimeAsync(710);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.expectedSourceRevisions).toEqual({ [sourceRef.sourceId]: 3 });
    expect(current.artifact.sourceRefs[0]!.revision).toBe(2);
    controller.dispose();
  });
});

describe('document save coordination', () => {
  it('keeps typing after a sent generation and saves it against the acknowledgement', async () => {
    vi.useFakeTimers(); const h = harness();
    const first = document([paragraph('first', 'First'), paragraph('second', 'Delivery in Taraz')]);
    const second = document([paragraph('first', 'Second'), paragraph('second', 'Delivery in Taraz')]);
    h.controller.change(first); await vi.advanceTimersByTimeAsync(710);
    expect(h.sent).toHaveLength(1);
    h.controller.change(second); h.acknowledge(0, first);
    expect(h.controller.getSnapshot().content).toEqual(second);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.commands[0]!.baseRevision).toBe(2);
    h.acknowledge(1, second);
    expect(h.controller.getSnapshot().phase).toBe('ready');
    expect(await h.controller.flush()).toBe(true); h.controller.dispose();
  });
  it('keeps the local content when another edit changes the revision', async () => {
    vi.useFakeTimers(); const h = harness(), local = document([paragraph('first', 'Local')]);
    h.controller.change(local); await vi.advanceTimersByTimeAsync(1);
    const other = snapshot(document([paragraph('first', 'Other')])); other.artifact.currentRevision += 1; other.version.revision += 1;
    h.changeSnapshot(other);
    expect(h.controller.getSnapshot()).toMatchObject({ content: local, phase: 'conflict' });
    expect(await h.controller.flush()).toBe(false); expect(h.sent).toHaveLength(0); h.controller.dispose();
  });
  it('does not overwrite a recovered local draft with fresh editor input', () => {
    const initial = snapshot(); const h = harness(initial, [{ artifactId: initial.artifact.id, baseRevision: 1, schemaVersion: 1, generation: 5, updatedAt: new Date().toISOString(), content: document([paragraph('first', 'Recovered')]) }]);
    expect(h.controller.getSnapshot().phase).toBe('recovery');
    expect(h.controller.change(document())).toBe(false); h.controller.dispose();
  });
  it('blocks typing while an atomic metadata command is being prepared', async () => {
    const h = harness(); let rejectBuild!: (reason: Error) => void;
    let started!: () => void; const preparing = new Promise<void>((resolve) => { started = resolve; });
    const action = h.controller.command(() => new Promise((_resolve, reject) => { rejectBuild = reject; started(); }));
    await preparing;
    expect(h.controller.change(document([paragraph('first', 'Racing input')]))).toBe(false);
    rejectBuild(new Error('Source changed'));
    await expect(action).rejects.toThrow('Source changed');
    expect(h.controller.getSnapshot().phase).toBe('ready'); h.controller.dispose();
  });
  it('requires edit permission for both typing and metadata commands', async () => {
    const initial = snapshot(); initial.permissions.edit = false; const h = harness(initial);
    expect(h.controller.change(document([paragraph('first', 'Denied')]))).toBe(false);
    const build = vi.fn(); expect(await h.controller.command(build)).toBe(false); expect(build).not.toHaveBeenCalled(); h.controller.dispose();
  });
  it('persists the complete inserted field content before its canonical command is sent', async () => {
    vi.useFakeTimers(); const h = harness();
    const desired = document([{ type: 'paragraph', attrs: { id: 'first' }, content: [{ type: 'dataField', attrs: { id: 'linked', value: '12 000 ₸' } }] }]);
    const action = h.controller.command(async (base) => (await documentCommand(base, desired, 'Insert linked value'))!, desired);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toHaveLength(1);
    expect(h.session.writeDraft).toHaveBeenLastCalledWith(expect.objectContaining({ content: desired }));
    h.acknowledge(0, desired); expect(await action).toBe(true); h.controller.dispose();
  });
  it('retains an unsaved failure when local persistence fails', async () => {
    vi.useFakeTimers(); const h = harness(); h.session.writeDraft.mockRejectedValueOnce(new Error('Quota'));
    h.controller.change(document([paragraph('first', 'Local')])); await vi.advanceTimersByTimeAsync(710);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'failed', localSaved: false }); expect(h.sent).toHaveLength(0); h.controller.dispose();
  });
  it('updates the history reason language without replacing in-progress document text', async () => {
    vi.useFakeTimers(); const h = harness(), edited = document([paragraph('first', 'Өз мәтінім')]);
    h.controller.change(edited); h.controller.setReason(() => 'Құжатты қолмен өзгерту');
    await vi.advanceTimersByTimeAsync(710);
    expect(h.sent[0]!.commands[0]!.reason).toBe('Құжатты қолмен өзгерту');
    expect(h.controller.getSnapshot().content).toEqual(edited); h.controller.dispose();
  });
});
