import type { CommandGroupInput } from '@/contracts/commands';

import type { ArtifactSession } from '@/features/artifacts/client/session';
import { createCommandGrouping, TYPING_GROUP_DELAY_MS, type CommandGroupDraft } from '@/features/artifacts/client/grouping';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { planCommand } from '../domain/commands';
import { requirePlan, validateOperationalPlan, type OperationalPlanContent } from '../domain/model';

type Phase = 'ready' | 'dirty' | 'saving' | 'applying' | 'conflict' | 'failed' | 'recovery' | 'hidden';
export type PlanControllerState = Readonly<{ content: OperationalPlanContent; phase: Phase; localSaved: boolean; error?: unknown }>;
type Flight = { id: string; revision: number; generation: number };
const same = (a: OperationalPlanContent, b: OperationalPlanContent) => hashJson(a as unknown as JsonValue) === hashJson(b as unknown as JsonValue);

/** Shares artifact drafts, autosave receipts and history with every other editor. */
export function createPlanController(session: ArtifactSession, reason: () => string) {
  let currentReason = reason;
  let snapshot = session.getSnapshot().snapshot!;
  let state: PlanControllerState = { content: requirePlan(snapshot.content), phase: 'ready', localSaved: true };
  let generation = 0, acknowledged = 0, readySeen = false, disposed = false, building = false, commandBusy = false;
  let flight: Flight | undefined, timer: ReturnType<typeof setTimeout> | undefined, persistence = Promise.resolve();
  const listeners = new Set<() => void>(), waiters = new Set<(saved: boolean) => void>();
  function publish(patch: Partial<PlanControllerState>) {
    if (disposed) return;
    state = { ...state, ...patch }; listeners.forEach((listener) => listener());
    if (['ready', 'conflict', 'failed', 'recovery', 'hidden'].includes(state.phase)) { waiters.forEach((resolve) => resolve(state.phase === 'ready')); waiters.clear(); }
  }
  function cancelTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function persist(content: OperationalPlanContent, revision: number, currentGeneration: number) {
    persistence = persistence.then(async () => {
      if (disposed) return;
      await session.writeDraft({ artifactId: snapshot.artifact.id, schemaVersion: 1, baseRevision: revision, generation: currentGeneration, content, updatedAt: new Date().toISOString() });
      if (currentGeneration === generation) publish({ localSaved: true });
    }).catch((error: unknown) => publish({ phase: 'failed', localSaved: false, error }));
    return persistence;
  }
  function group(draft: CommandGroupDraft): CommandGroupInput {
    let result: CommandGroupInput | undefined;
    const grouping = createCommandGrouping({ onReady(value) { result = value; } });
    grouping.stage(draft, 'format'); grouping.dispose(); return result!;
  }
  function schedule(delay = TYPING_GROUP_DELAY_MS) { cancelTimer(); timer = setTimeout(() => { timer = undefined; void submit(); }, delay); }
  async function submit(prepared?: CommandGroupDraft) {
    cancelTimer();
    if (disposed || building || flight || !['dirty', 'ready', ...(prepared ? ['applying'] as const : [])].includes(state.phase)) return;
    building = true;
    const base = snapshot, content = state.content, currentGeneration = generation;
    try {
      await persistence;
      if (state.phase === 'failed' || state.phase === 'hidden') return;
      const draft = prepared ?? await planCommand(base, content, currentReason());
      if (snapshot.artifact.currentRevision !== base.artifact.currentRevision) { if (prepared) publish({ phase: 'conflict' }); else schedule(0); return; }
      if (!draft) {
        if (currentGeneration !== generation) { schedule(); return; }
        if (generation !== acknowledged) {
          const own = session.getSnapshot().drafts.filter((item) => item.artifactId === base.artifact.id && item.generation === currentGeneration);
          if (own.length && !await session.discardReviewed({ drafts: own, pending: [] })) throw new Error('plan-draft-not-cleared');
        }
        acknowledged = generation; publish({ phase: 'ready', localSaved: true }); return;
      }
      const command = group(draft);
      flight = { id: command.commandGroupId, revision: base.artifact.currentRevision, generation: currentGeneration };
      publish({ phase: 'saving', error: undefined });
      await session.enqueue(command, { [base.artifact.id]: currentGeneration });
    } catch (error) { publish({ phase: 'failed', error }); }
    finally {
      building = false;
      // A metadata refresh may acknowledge the first save before enqueue
      // returns. Reschedule the newer generation after that narrow race.
      if (!disposed && !flight && state.phase === 'dirty' && generation > acknowledged) schedule(0);
    }
  }
  function receive() {
    if (disposed) return;
    const next = session.getSnapshot();
    if (next.phase !== 'ready' || !next.snapshot) { cancelTimer(); publish({ phase: 'hidden' }); return; }
    if (!next.storageReady) return;
    if (!readySeen) {
      readySeen = true; generation = Math.max(0, ...next.drafts.map((draft) => draft.generation)); acknowledged = generation;
      if (next.drafts.length || next.pending.length) { publish({ phase: 'recovery' }); return; }
    }
    if (state.phase === 'recovery') {
      if (next.drafts.length || next.pending.length) return;
      snapshot = next.snapshot; publish({ content: requirePlan(snapshot.content), phase: 'ready', localSaved: true }); return;
    }
    if (next.autosave?.status === 'conflict') { cancelTimer(); publish({ phase: 'conflict' }); return; }
    if (['uncertain', 'failed', 'storage-error'].includes(next.autosave?.status ?? '')) { cancelTimer(); publish({ phase: 'failed', error: next.autosave?.failure }); return; }
    if (next.snapshot.artifact.currentRevision !== snapshot.artifact.currentRevision) {
      const own = flight && next.snapshot.artifact.currentRevision === flight.revision + 1 && next.snapshot.history.some((item) => item.commandGroupId === flight!.id);
      if (own && flight) {
        acknowledged = flight.generation; snapshot = next.snapshot; flight = undefined;
        if (generation > acknowledged) { publish({ phase: 'dirty' }); void persist(state.content, snapshot.artifact.currentRevision, generation); schedule(0); }
        else publish({ content: requirePlan(snapshot.content), phase: 'ready', localSaved: true });
      } else if (generation !== acknowledged || flight) { cancelTimer(); publish({ phase: 'conflict' }); }
      else { snapshot = next.snapshot; publish({ content: requirePlan(snapshot.content), phase: 'ready', localSaved: true }); }
    } else snapshot = next.snapshot;
  }
  let unsubscribe: (() => void) | undefined, mountGeneration = 0;
  function dispose() { disposed = true; cancelTimer(); unsubscribe?.(); waiters.forEach((resolve) => resolve(false)); waiters.clear(); listeners.clear(); }
  async function flush(): Promise<boolean> {
    cancelTimer(); await persistence;
    if (state.phase === 'ready' && generation === acknowledged) return session.flush();
    if (['hidden', 'failed', 'conflict', 'recovery'].includes(state.phase)) return false;
    await submit();
    if (state.phase === 'ready') return session.flush();
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { waiters.delete(done); resolve(false); }, 30_000);
      function done(saved: boolean) { clearTimeout(timeout); resolve(saved); }
      waiters.add(done);
    });
  }
  return {
    getSnapshot: () => state,
    setReason(next: () => string) { currentReason = next; },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    mount() { const mine = ++mountGeneration; unsubscribe ??= session.subscribe(receive); receive(); return () => { queueMicrotask(() => { if (mine === mountGeneration) dispose(); }); }; },
    change(content: OperationalPlanContent, boundary: 'typing' | 'format' | 'structure' = 'typing') {
      if (disposed || commandBusy || !readySeen || !['ready', 'dirty', 'saving'].includes(state.phase) || !session.getSnapshot().snapshot?.permissions.edit) return false;
      const validated = validateOperationalPlan(content);
      if (same(validated, state.content)) return true;
      generation += 1; publish({ content: validated, phase: flight ? 'saving' : 'dirty', localSaved: false, error: undefined });
      void persist(validated, snapshot.artifact.currentRevision, generation); schedule(boundary === 'typing' ? TYPING_GROUP_DELAY_MS : 0); return true;
    },
    flush,
    async command(build: (base: ArtifactSnapshot) => Promise<CommandGroupDraft>, desired: OperationalPlanContent) {
      if (commandBusy || !session.getSnapshot().snapshot?.permissions.edit) return false;
      commandBusy = true;
      try {
        if (!await flush()) return false;
        publish({ phase: 'applying' });
        const baseRevision = snapshot.artifact.currentRevision, prepared = await build(snapshot);
        if (snapshot.artifact.currentRevision !== baseRevision) throw new Error('plan-command-base-changed');
        generation += 1; publish({ content: validateOperationalPlan(desired), localSaved: false });
        await persist(state.content, baseRevision, generation); await submit(prepared); return flush();
      } catch (error) { publish({ phase: generation === acknowledged ? 'ready' : 'failed', error }); throw error; }
      finally { commandBusy = false; }
    },
    async retry() { await session.retrySave(); receive(); if (!flight && state.phase === 'failed' && !session.getSnapshot().pending.length) { publish({ phase: 'dirty', error: undefined }); await submit(); } },
    dispose,
  };
}

export type PlanController = ReturnType<typeof createPlanController>;

