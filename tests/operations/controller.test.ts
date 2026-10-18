import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { CommandGroupInput } from '@/contracts/commands';
import type { LocalDraft } from '@/features/artifacts/client/local-records';
import { createPlanController } from '@/features/operations/client/controller';
import { insertEntry, updateEntry, type OperationalPlanContent, type OperationalPlanEntry } from '@/features/operations/domain/model';
import { receipt, snapshot as artifactSnapshot } from '../artifacts/client/fixtures';

const entryId = 'task-1';
function plan(title = 'Prepare proposal', description?: string): OperationalPlanContent {
  return {
    kind: 'plan', schemaVersion: 1, timezone: 'Asia/Almaty',
    entries: [{ id: entryId, title, ...(description ? { description } : {}), status: 'todo', resourceIds: [], dependencies: [], assignments: [], checklist: [], availabilityVersionIds: [] }],
  };
}

function planSnapshot(content = plan()): ArtifactSnapshot {
  const base = artifactSnapshot();
  return { ...base, artifact: { ...base.artifact, kind: 'plan' }, content, history: [] };
}

afterEach(() => vi.useRealTimers());

describe('plan save coordination', () => {
  it('rebases a newer row edit when a structural save is acknowledged before enqueue unwinds', async () => {
    vi.useFakeTimers();
    let current = planSnapshot(), drafts: LocalDraft[] = [];
    const listeners = new Set<() => void>(), sent: CommandGroupInput[] = [], phases: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const emit = () => listeners.forEach((listener) => listener());
    const session = {
      getSnapshot: () => ({ phase: 'ready', snapshot: current, storageReady: true, drafts, pending: [] }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      writeDraft: vi.fn(async (draft: LocalDraft) => {
        const previous = drafts.find((item) => item.artifactId === draft.artifactId);
        if (previous?.generation === draft.generation && JSON.stringify(previous) !== JSON.stringify(draft)) {
          throw new Error('changed-draft-generation');
        }
        if (!previous || previous.generation <= draft.generation) drafts = [structuredClone(draft)];
      }),
      enqueue: vi.fn(async (command: CommandGroupInput) => { sent.push(command); if (sent.length === 1) await firstPending; }),
      flush: vi.fn(async () => true),
      discardReviewed: vi.fn(async () => { drafts = []; return true; }),
      retrySave: vi.fn(async () => undefined),
    } as unknown as ArtifactSession;
    const controller = createPlanController(session, () => 'Edit work plan');
    controller.mount();
    const unsubscribe = controller.subscribe(() => phases.push(controller.getSnapshot().phase));
    try {
      const inserted: OperationalPlanEntry = { id: 'new-task', title: 'Add task', status: 'todo', resourceIds: [], dependencies: [], assignments: [], checklist: [], availabilityVersionIds: [] };
      const structuralEdit = insertEntry(plan(), inserted);
      expect(controller.change(structuralEdit, 'structure')).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toHaveLength(1);

      const editedInsert = updateEntry(structuralEdit, inserted.id, { title: 'Rapid new title', description: 'Rapid new description' });
      const rapidEdits = updateEntry(editedInsert, entryId, { title: 'Rapid existing title' });
      expect(controller.change(rapidEdits, 'typing')).toBe(true);

      const first = sent[0]!;
      const committed = receipt(first), revision = first.commands[0]!.baseRevision + 1;
      current = { ...current, artifact: { ...current.artifact, currentRevision: revision }, version: { ...current.version, revision }, content: structuralEdit, history: [committed.historyGroup] };
      drafts = []; emit();
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toHaveLength(1);

      releaseFirst();
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toHaveLength(2);
      expect(sent[1]!.commands[0]!.baseRevision).toBe(revision);
      expect(sent[0]!.commands[0]!.operations).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'insert', targetId: inserted.id })]));
      expect(sent[1]!.commands[0]!.operations).toEqual(expect.arrayContaining([
        expect.objectContaining({ op: 'set', targetId: inserted.id }),
        expect.objectContaining({ op: 'set', targetId: entryId }),
      ]));
      expect(sent[1]!.commands[0]!.operations).not.toEqual(expect.arrayContaining([expect.objectContaining({ op: 'insert' })]));
      expect(drafts[0]).toMatchObject({ baseRevision: revision, content: rapidEdits });
      expect(controller.getSnapshot()).toMatchObject({ content: rapidEdits, phase: 'saving' });

      const second = sent[1]!, committedSecond = receipt(second), nextRevision = second.commands[0]!.baseRevision + 1;
      current = { ...current, artifact: { ...current.artifact, currentRevision: nextRevision }, version: { ...current.version, revision: nextRevision }, content: rapidEdits, history: [committed.historyGroup, committedSecond.historyGroup] };
      drafts = []; emit();
      expect(controller.getSnapshot()).toMatchObject({ content: rapidEdits, phase: 'ready' });
      expect(phases).not.toContain('failed');
    } finally { unsubscribe(); releaseFirst(); controller.dispose(); }
  });
});
