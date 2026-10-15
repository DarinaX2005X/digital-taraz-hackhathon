import type { CommandGroupInput } from '@/contracts/commands';
import type { SourceFreshness } from '@/features/artifacts/contracts';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import { createCommandGrouping, TYPING_GROUP_DELAY_MS } from '@/features/artifacts/client/grouping';
import { createEditorArtifactState, expectedSourceRevisions } from '@/features/artifacts/client/snapshot-state';
import { collectSourceRefs } from '@/features/artifacts/domain/content-state';
import type { ArtifactState } from '@/features/artifacts/domain/targets';
import { ArtifactDraft } from '@/features/artifacts/domain/operations';
import { MerkleJson } from '@/features/artifacts/domain/merkle-json';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { applyDesignAction, designFromState, type DesignAction, type DesignActionResult } from '../domain/actions';
import type { DesignContent } from '../domain/model';

type Phase = 'ready' | 'dirty' | 'saving' | 'recovery' | 'conflict' | 'failed' | 'hidden';
export type DesignControllerState = Readonly<{ content: DesignContent; phase: Phase; localSaved: boolean; error?: unknown }>;
type Entry = { before: ArtifactState; result: DesignActionResult; reason: string; metadataAt: string; generation: number; typingKey?: string; freshness: readonly SourceFreshness[] };
type Flight = { entry: Entry; group: CommandGroupInput; baseRevision: number };

/** Gestures queue against exact preceding state; only our own receipt advances that base.
 * Fabric has no separate history. Unsent typing on one layer replaces a single group. */
export function createDesignController(session: ArtifactSession) {
  let snapshot = session.getSnapshot().snapshot!;
  let projection = createEditorArtifactState(snapshot);
  let state: DesignControllerState = { content: designFromState(projection), phase: 'ready', localSaved: true };
  let generation = 0, readySeen = false, disposed = false, mountGeneration = 0, rebasing = false;
  let flight: Flight | undefined, unsubscribe: (() => void) | undefined;
  const queue: Entry[] = [], listeners = new Set<() => void>(), waiters = new Set<(ok: boolean) => void>();
  let actions = Promise.resolve(), persistence = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
  function publish(patch: Partial<DesignControllerState>) {
    if (disposed) return;
    state = { ...state, ...patch }; listeners.forEach((listener) => listener());
    if (['ready', 'recovery', 'conflict', 'failed', 'hidden'].includes(state.phase)) {
      waiters.forEach((resolve) => resolve(state.phase === 'ready')); waiters.clear();
    }
  }
  function cancelTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function persist(entry: Entry) {
    persistence = persistence.then(async () => {
      if (disposed || state.phase === 'hidden') return;
      await session.writeDraft({ artifactId: snapshot.artifact.id, baseRevision: snapshot.artifact.currentRevision, schemaVersion: 1,
        generation: entry.generation, content: designFromState(entry.result.state), updatedAt: new Date().toISOString() });
      if (generation === entry.generation) publish({ localSaved: true });
    }).catch((error: unknown) => { publish({ phase: 'failed', localSaved: false, error }); });
    return persistence;
  }
  function schedule(delay: number) { cancelTimer(); timer = setTimeout(() => { timer = undefined; void submit(); }, delay); }
  async function submit() {
    cancelTimer();
    if (disposed || flight || rebasing || !queue.length || !['ready', 'dirty', 'saving'].includes(state.phase)) return;
    const entry = queue[0]!;
    try {
      await persistence;
      if (disposed || flight || queue[0] !== entry || !['ready', 'dirty', 'saving'].includes(state.phase)) return;
      const sourceRevisions = expectedSourceRevisions(snapshot, collectSourceRefs(entry.result.state), entry.freshness);
      let group: CommandGroupInput | undefined;
      const grouping = createCommandGrouping({ onReady(value) { group = value; } });
      grouping.stage({ metadataAt: entry.metadataAt, expectedArtifactRevisions: { [snapshot.artifact.id]: snapshot.artifact.currentRevision }, expectedSourceRevisions: sourceRevisions,
        commands: [{ artifactId: snapshot.artifact.id, baseRevision: snapshot.artifact.currentRevision, kind: 'design', operations: entry.result.operations, expectedSourceRevisions: sourceRevisions, reason: entry.reason }] }, 'format');
      grouping.dispose();
      flight = { entry, group: group!, baseRevision: snapshot.artifact.currentRevision }; queue.shift();
      publish({ phase: 'saving', error: undefined });
      await session.enqueue(group!, { [snapshot.artifact.id]: entry.generation });
    } catch (error) {
      if(flight&&!session.getSnapshot().pending.some((pending)=>pending.group.commandGroupId===flight!.group.commandGroupId)){
        queue.unshift(flight.entry);flight=undefined;
      }
      publish({ phase: 'failed', error });
    }
  }
  function receive() {
    if (disposed) return;
    const next = session.getSnapshot();
    if (next.phase !== 'ready' || !next.snapshot) { cancelTimer(); publish({ phase: 'hidden' }); return; }
    if (!next.storageReady) return;
    if(state.phase==='hidden'&&(next.drafts.length||next.pending.length||queue.length||flight)){
      publish({phase:'recovery'});return;
    }
    if (!readySeen) {
      readySeen = true; generation = Math.max(0, ...next.drafts.map((item) => item.generation));
      if (next.drafts.length || next.pending.length) { publish({ phase: 'recovery' }); return; }
    }
    if (state.phase === 'recovery') {
      if (next.drafts.length || next.pending.length) return;
      queue.length=0;flight=undefined;
      snapshot = next.snapshot; projection = createEditorArtifactState(snapshot);
      publish({ content: designFromState(projection), phase: 'ready', localSaved: true }); return;
    }
    if (next.autosave?.status === 'conflict') { cancelTimer(); publish({ phase: 'conflict' }); return; }
    if (['uncertain', 'failed', 'storage-error'].includes(next.autosave?.status ?? '')) { cancelTimer(); publish({ phase: 'failed', error: next.autosave?.failure }); return; }
    if (next.snapshot.artifact.currentRevision !== snapshot.artifact.currentRevision) {
      const ours = flight && next.snapshot.artifact.currentRevision === flight.baseRevision + 1 && next.snapshot.history.some((item) => item.commandGroupId === flight!.group.commandGroupId);
      if (ours) {
        snapshot = next.snapshot; flight = undefined;
        if (queue.length) {
          rebasing = true;
          // Only acknowledged local commands may change this basis. Foreign revisions stop editing.
          actions = actions.then(async () => {
            let base = createEditorArtifactState(snapshot);
            for (const entry of queue) {
              const graph = new MerkleJson(), draft = new ArtifactDraft(graph, graph.encode(base as unknown as JsonValue));
              const operations = [];
              for (const previous of entry.result.operations) {
                const operation = { ...previous, beforeHash: (await draft.target(previous.targetId))?.hash ?? null };
                await draft.apply([operation], { actorId: snapshot.viewer.userId, origin: 'human', reason: entry.reason, at: entry.metadataAt });
                operations.push(operation);
              }
              entry.before = base; base = await draft.state(); entry.result = { ...entry.result, state: base, operations };
            }
            projection = base; rebasing = false;
            publish({ content: designFromState(projection), phase: 'dirty', error: undefined });
            if (queue.length) await persist(queue.at(-1)!);
            schedule(0);
          }).catch((error: unknown) => { rebasing = false; publish({ phase: 'failed', error }); });
        }
        else { projection = createEditorArtifactState(snapshot); publish({ content: designFromState(projection), phase: 'ready', localSaved: true, error: undefined }); }
      } else if (queue.length || flight) { cancelTimer(); publish({ phase: 'conflict' }); }
      else { snapshot = next.snapshot; projection = createEditorArtifactState(snapshot); publish({ content: designFromState(projection), phase: 'ready', localSaved: true }); }
    } else {
      snapshot = next.snapshot;
      if (!queue.length && !flight && state.phase === 'hidden') publish({ phase: 'ready' });
    }
  }
  function dispose() { disposed = true; cancelTimer(); unsubscribe?.(); waiters.forEach((resolve) => resolve(false)); waiters.clear(); listeners.clear(); }
  async function flush(): Promise<boolean> {
    cancelTimer(); await actions; cancelTimer(); await persistence;
    if (state.phase === 'ready' && !queue.length && !flight) return session.flush();
    if (['hidden', 'failed', 'conflict', 'recovery'].includes(state.phase)) return false;
    await submit();
    if (state.phase === 'ready') return session.flush();
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { waiters.delete(done); resolve(false); }, 30_000);
      function done(ok: boolean) { clearTimeout(timeout); resolve(ok); }
      waiters.add(done);
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount() { const mine = ++mountGeneration; unsubscribe ??= session.subscribe(receive); receive(); return () => { queueMicrotask(() => { if (mine === mountGeneration) dispose(); }); }; },
    action(action: DesignAction, reason: string, options: { typingKey?: string; sourceFreshness?: readonly SourceFreshness[] } = {}): Promise<DesignActionResult | undefined> {
      let result: DesignActionResult | undefined;
      const operation = actions.then(async () => {
        if (disposed || !readySeen || !['ready', 'dirty', 'saving'].includes(state.phase) || !snapshot.permissions.edit || ['archived', 'trashed'].includes(snapshot.artifact.status)) return;
        const tail = queue.at(-1), replace = options.typingKey && tail?.typingKey === options.typingKey;
        const before = replace ? tail!.before : projection;
        const metadataAt = new Date().toISOString();
        result = await applyDesignAction(before, action, { context: { actorId: snapshot.viewer.userId, origin: 'human', reason, at: metadataAt } });
        if (disposed || session.getSnapshot().phase !== 'ready') return;
        if (!result.operations.length) return;
        const entry: Entry = { before, result, reason, metadataAt, generation: ++generation, typingKey: options.typingKey, freshness: options.sourceFreshness ?? [] };
        if (replace) queue.pop(); queue.push(entry); projection = result.state;
        publish({ content: designFromState(projection), phase: flight ? 'saving' : 'dirty', localSaved: false, error: undefined });
        void persist(entry); schedule(options.typingKey ? TYPING_GROUP_DELAY_MS : 0);
      });
      // One failed input must not poison later editing; it is reported to its caller.
      actions = operation.catch(() => undefined);
      return operation.then(() => result);
    },
    flush,
    async retry() {
      if (['hidden', 'conflict', 'recovery'].includes(state.phase)) return;
      if (flight) { await session.retrySave(); receive(); }
      else if (queue.length) { publish({ phase: 'dirty', error: undefined }); await persist(queue.at(-1)!); await submit(); }
    },
    dispose,
  };
}
export type DesignController = ReturnType<typeof createDesignController>;
