import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import type { CommandGroupInput } from '@/contracts/commands';
import { createDocumentController } from '@/features/documents/client/controller';
import { document, paragraph, snapshot } from './fixtures';

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
