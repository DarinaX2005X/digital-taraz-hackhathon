import type { CommandGroupInput } from '@/contracts/commands';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import { createCommandGrouping, TYPING_GROUP_DELAY_MS, type CommandGroupDraft } from '@/features/artifacts/client/grouping';
import { hashJson } from '@/features/artifacts/domain/canonical';
import { sheetCommand } from '../domain/commands';
import { requireTable, type TableContent } from '../domain/model';
import { editableChange } from '../domain/editing';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
const asJson = (value: unknown) => value as JsonValue;

type Phase = 'ready' | 'dirty' | 'saving' | 'conflict' | 'failed' | 'recovery' | 'hidden';
export type SheetControllerState = Readonly<{ content: TableContent; phase: Phase; localSaved: boolean; error?: unknown }>;
type Flight = { id: string; revision: number; generation: number; content: TableContent };
const equal = (a: TableContent, b: TableContent) => hashJson(asJson(a)) === hashJson(asJson(b));

/** Один подтверждённый baseRevision на отправку; последующий ввод остаётся отдельным черновиком. */
export function createSheetController(session: ArtifactSession, reason: () => string) {
  let snapshot = session.getSnapshot().snapshot!;
  let state: SheetControllerState = { content: requireTable(snapshot.content), phase: 'ready', localSaved: true };
  let generation = 0, acknowledged = 0, readySeen = false, disposed = false, building = false;
  let flight: Flight | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let persistence = Promise.resolve();
  const listeners = new Set<() => void>();
  const idleWaiters = new Set<(saved: boolean) => void>();
  function publish(patch: Partial<SheetControllerState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
    if (['ready', 'conflict', 'failed', 'recovery', 'hidden'].includes(state.phase)) {
      for (const resolve of idleWaiters) resolve(state.phase === 'ready');
      idleWaiters.clear();
    }
  }
  function cancelTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function persist(content: TableContent, version: number, currentGeneration: number) {
    persistence = persistence.then(async () => {
      if (disposed) return;
      await session.writeDraft({ artifactId: snapshot.artifact.id, schemaVersion: 1, baseRevision: version, generation: currentGeneration, content, updatedAt: new Date().toISOString() });
      if (currentGeneration === generation) publish({ localSaved: true });
    }).catch((error: unknown) => { publish({ phase: 'failed', localSaved: false, error }); });
    return persistence;
  }
  function group(draft: CommandGroupDraft): CommandGroupInput {
    let result: CommandGroupInput | undefined;
    const grouping = createCommandGrouping({ onReady(value) { result = value; } });
    grouping.stage(draft, 'format'); grouping.dispose();
    return result!;
  }
  function schedule(delay = TYPING_GROUP_DELAY_MS) {
    cancelTimer();
    timer = setTimeout(() => { timer = undefined; void submit(); }, delay);
  }
  async function submit(prepared?: CommandGroupDraft) {
    cancelTimer();
    if (disposed || building || flight || !['dirty', 'ready'].includes(state.phase)) return;
    building = true;
    const base = snapshot, content = state.content, currentGeneration = generation;
    try {
      await persistence;
      if (state.phase === 'failed' || state.phase === 'hidden') return;
      const draft = prepared ?? await sheetCommand(base, content, reason());
      if (snapshot.artifact.currentRevision !== base.artifact.currentRevision) { schedule(0); return; }
      if (!draft) {
        if (currentGeneration !== generation) { schedule(); return; }
        if (generation !== acknowledged) {
          const own = session.getSnapshot().drafts.filter((item) => item.artifactId === base.artifact.id && item.generation === currentGeneration);
          if (own.length && !await session.discardReviewed({ drafts: own, pending: [] })) throw new Error('sheet-draft-not-cleared');
        }
        acknowledged = generation; publish({ phase: 'ready', localSaved: true }); return;
      }
      const command = group(draft);
      flight = { id: command.commandGroupId, revision: base.artifact.currentRevision, generation: currentGeneration, content };
      publish({ phase: 'saving', error: undefined });
      await session.enqueue(command, { [base.artifact.id]: currentGeneration });
    } catch (error) { publish({ phase: 'failed', error }); }
    finally { building = false; }
  }
  function receive() {
    if (disposed) return;
    const next = session.getSnapshot();
    if (next.phase !== 'ready' || !next.snapshot) { cancelTimer(); publish({ phase: 'hidden' }); return; }
    if (!next.storageReady) return;
    if (!readySeen) {
      readySeen = true;
      generation = Math.max(0, ...next.drafts.map((draft) => draft.generation)); acknowledged = generation;
      if (next.drafts.length || next.pending.length) { publish({ phase: 'recovery' }); return; }
    }
    if (state.phase === 'recovery') {
      if (next.drafts.length || next.pending.length) return;
      snapshot = next.snapshot; publish({ content: requireTable(snapshot.content), phase: 'ready', localSaved: true }); return;
    }
    if (next.autosave?.status === 'conflict') { cancelTimer(); publish({ phase: 'conflict' }); return; }
    if (['uncertain', 'failed', 'storage-error'].includes(next.autosave?.status ?? '')) { cancelTimer(); publish({ phase: 'failed', error: next.autosave?.failure }); return; }
    if (next.snapshot.artifact.currentRevision !== snapshot.artifact.currentRevision) {
      const own = flight && next.snapshot.artifact.currentRevision === flight.revision + 1 && next.snapshot.history.some((item) => item.commandGroupId === flight!.id);
      if (own && flight) {
        acknowledged = flight.generation; snapshot = next.snapshot; flight = undefined;
        if (generation > acknowledged) {
          publish({ phase: 'dirty' }); void persist(state.content, snapshot.artifact.currentRevision, generation); schedule(0);
        } else publish({ content: requireTable(snapshot.content), phase: 'ready', localSaved: true });
      } else if (generation !== acknowledged || flight) {
        cancelTimer(); publish({ phase: 'conflict' });
      } else { snapshot = next.snapshot; publish({ content: requireTable(snapshot.content), phase: 'ready', localSaved: true }); }
    } else {
      // Source heads and permissions can change without changing document content.
      // Keep pinned provenance, but prepare the next mutation against fresh heads.
      snapshot = next.snapshot;
      if (state.phase === 'hidden') publish({ phase: generation === acknowledged ? 'ready' : 'recovery' });
    }
  }
  let unsubscribe: (() => void) | undefined;
  let mountGeneration = 0;
  function dispose() { disposed = true; cancelTimer(); unsubscribe?.(); idleWaiters.forEach((resolve) => resolve(false)); idleWaiters.clear(); listeners.clear(); }
  async function flush(): Promise<boolean> {
    cancelTimer(); await persistence;
    if (state.phase === 'ready' && generation === acknowledged) return session.flush();
    if (['hidden', 'failed', 'conflict', 'recovery'].includes(state.phase)) return false;
    await submit();
    if (state.phase === 'ready') return session.flush();
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { idleWaiters.delete(done); resolve(false); }, 30_000);
      function done(saved: boolean) { clearTimeout(timeout); resolve(saved); }
      idleWaiters.add(done);
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount() {
      const mine = ++mountGeneration;
      unsubscribe ??= session.subscribe(receive);
      receive();
      return () => { queueMicrotask(() => { if (mine === mountGeneration) dispose(); }); };
    },
    change(content: TableContent, boundary: 'typing' | 'format' | 'paste' = 'typing') {
      if (disposed || !readySeen || !['ready', 'dirty', 'saving'].includes(state.phase) || !session.getSnapshot().snapshot?.permissions.edit) return false;
      const validated = editableChange(state.content, content);
      if (equal(validated, state.content)) return true;
      generation += 1;
      publish({ content: validated, phase: flight ? 'saving' : 'dirty', localSaved: false, error: undefined });
      void persist(validated, snapshot.artifact.currentRevision, generation);
      schedule(boundary === 'typing' ? TYPING_GROUP_DELAY_MS : 0);
      return true;
    },
    flush,
    async command(build: (base: ArtifactSnapshot) => Promise<CommandGroupDraft>) {
      if (!await flush()) return false;
      generation += 1; publish({ phase: 'dirty', localSaved: false });
      await persist(state.content, snapshot.artifact.currentRevision, generation);
      await submit(await build(snapshot)); return flush();
    },
    async retry() { await session.retrySave(); receive(); if (!flight && state.phase === 'failed' && !session.getSnapshot().pending.length) { publish({ phase: 'dirty', error: undefined }); await submit(); } },
    dispose,
  };
}
export type SheetController = ReturnType<typeof createSheetController>;

