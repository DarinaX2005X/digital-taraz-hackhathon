import type { CommandGroupInput } from "@/contracts/commands";
import { ArtifactSnapshotSchema, type ArtifactSnapshot, type ArtifactVersion, type ArtifactVersionDetail } from "../contracts";
import { createArtifactAutosave, ArtifactSubmissionError, type ArtifactAutosave, type AutosaveState } from "./autosave";
import { prepareHistoryOperation } from "./checked-history";
import { executeArtifactOperation, type ArtifactOperationResult } from "./execute-operation";
import { openArtifactCache, type ArtifactCache, type ArtifactCacheOptions } from "./indexed-db";
import { LocalDraftSchema, type LocalDraft, type PendingCommand } from "./local-records";
import { createArtifactOperations, type ArtifactOperation, type ArtifactOperations, type OperationSnapshot } from "./operations";
import { createArtifactPrivacy, PrivacyBoundaryError, type ArtifactPrivacy, type CacheAuthority } from "./privacy";
import { artifactClient, artifactSubmit, type ArtifactClient } from "./transport";
import { assertBoundedJson, hashJson } from "../domain/canonical";

export type ArtifactSessionState = Readonly<{
  phase: "ready" | "authentication-required" | "access-changed" | "deleted";
  snapshot?: ArtifactSnapshot;
  versions: ArtifactVersion[];
  nextBeforeRevision: number | null;
  selectedRevision?: number;
  selectedVersion?: ArtifactVersionDetail;
  loading: boolean;
  versionLoading: boolean;
  versionsLoading: boolean;
  storageReady: boolean;
  drafts: LocalDraft[];
  pending: PendingCommand[];
  autosave?: AutosaveState;
  operation: OperationSnapshot;
  error?: unknown;
  storageError?: unknown;
  createdArtifact?: { id: string; projectId: string; title: string };
}>;
type Options = {
  initial: ArtifactSnapshot;
  client?: ArtifactClient;
  cache?: ArtifactCacheOptions;
  isIdentityCurrent?: () => boolean;
  onAuthenticationRequired?: () => void;
  onConfirmed?: (artifactIds: string[]) => void;
};

function snapshotAuthority(snapshot: ArtifactSnapshot): CacheAuthority {
  return { ...snapshot.viewer, artifactIds: [...new Set([snapshot.artifact.id, ...snapshot.history.flatMap((group) => group.artifacts.map((artifact) => artifact.artifactId))])] };
}
function recoveryHash(value: unknown) { assertBoundedJson(value); return hashJson(value); }
function hiddenState(phase: ArtifactSessionState["phase"]): ArtifactSessionState {
  return { phase, versions: [], nextBeforeRevision: null, loading: false, versionLoading: false, versionsLoading: false, storageReady: false, drafts: [], pending: [], operation: { phase: "idle" } };
}

/** Private data is published only for the current identity; revalidation never replays a write. */
export function createArtifactSession(options: Options) {
  const initial = ArtifactSnapshotSchema.parse(options.initial);
  const client = options.client ?? artifactClient;
  const artifactId = initial.artifact.id;
  const listeners = new Set<() => void>();
  const guardedDrafts = new Map<string, LocalDraft>();
  const reads = new Map<string, AbortController>();
  let viewer = initial.viewer;
  let state: ArtifactSessionState = { ...hiddenState("ready"), snapshot: initial, loading: true };
  let privacy: ArtifactPrivacy | undefined;
  let cache: ArtifactCache | undefined;
  let autosave: ArtifactAutosave | undefined;
  let operations: ArtifactOperations<ArtifactOperationResult> | undefined;
  let unsubscribe: (() => void)[] = [];
  let disposed = false;
  let epoch = 0;
  let rebuilding: Promise<void> | undefined;
  let initialized = false;
  let eventCursor = initial.cursor;

  function publish(patch: Partial<ArtifactSessionState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function current(expected = epoch) {
    if (disposed || expected !== epoch) throw new PrivacyBoundaryError();
    if (options.isIdentityCurrent?.() === false) { suspend(); throw new PrivacyBoundaryError(); }
  }
  function stopReads() { for (const controller of reads.values()) controller.abort(); reads.clear(); }
  function stopWriters() {
    for (const stop of unsubscribe) stop(); unsubscribe = [];
    operations?.dispose(); operations = undefined;
    autosave?.dispose(); autosave = undefined;
    privacy?.close(); privacy = undefined;
  }
  function mask(phase: ArtifactSessionState["phase"]) {
    state = hiddenState(phase);
    for (const listener of listeners) listener();
  }
  function hide(phase: ArtifactSessionState["phase"]) {
    epoch += 1;
    stopReads(); stopWriters();
    mask(phase);
  }
  function suspend(notify = false) {
    if (disposed) return;
    hide("authentication-required");
    if (notify) options.onAuthenticationRequired?.();
  }
  async function revoke(ids = [artifactId]) {
    const previous = cache;
    hide("access-changed");
    for (const id of ids) guardedDrafts.delete(id);
    try { await previous?.clearArtifacts(ids); }
    catch (error) { publish({ storageError: error }); }
  }
  async function fail(error: unknown, expected: number) {
    if (disposed || expected !== epoch) return;
    if (options.isIdentityCurrent?.() === false) { suspend(); return; }
    if (error instanceof ArtifactSubmissionError && error.status === 401) { suspend(true); return; }
    if (error instanceof ArtifactSubmissionError && [403, 404].includes(error.status)) { await revoke(); return; }
    if (error instanceof PrivacyBoundaryError) { hide("access-changed"); return; }
    publish({ error, loading: false, versionLoading: false, versionsLoading: false });
  }
  function reading(key: string) {
    current();
    reads.get(key)?.abort();
    const controller = new AbortController(); reads.set(key, controller);
    const expected = epoch;
    return {
      controller, expected,
      assert() { current(expected); if (controller.signal.aborted || reads.get(key) !== controller) throw new PrivacyBoundaryError(); },
      done() { if (reads.get(key) === controller) reads.delete(key); },
    };
  }

  async function readRecovery() {
    if (!cache || !privacy) return;
    const expected = epoch;
    const pending = await cache.listPending(artifactId);
    const ids = [...new Set([artifactId, ...pending.flatMap((record) => record.group.commands.map((command) => command.artifactId))])];
    const drafts: LocalDraft[] = [];
    for (const id of ids) {
      const draft = await cache.getDraft(id);
      if (draft) {
        const memory = guardedDrafts.get(id);
        if (!memory || memory.generation < draft.generation) guardedDrafts.set(id, draft);
      }
      const available = guardedDrafts.get(id);
      if (available) drafts.push(available);
    }
    current(expected);
    publish({ drafts, pending });
  }

  async function authorizeRecovery(snapshot: ArtifactSnapshot, nextCache: ArtifactCache, nextPrivacy: ArtifactPrivacy, expected: number) {
    const candidates = await nextCache.recoveryTargetIds(artifactId);
    current(expected);
    const allowed = new Set(snapshotAuthority(snapshot).artifactIds);
    const denied: string[] = [];
    for (let start = 0; start < candidates.length; start += 100) {
      const response = await client.access(candidates.slice(start, start + 100), { viewer: snapshot.viewer, signal: nextPrivacy.capture().signal });
      current(expected);
      for (const id of response.authorizedArtifactIds) allowed.add(id);
      for (const id of response.unavailableArtifactIds) { denied.push(id); allowed.delete(id); guardedDrafts.delete(id); }
    }
    if (!allowed.has(artifactId)) throw new ArtifactSubmissionError("server", undefined, 404);
    await nextCache.revalidate({ ...snapshot.viewer, artifactIds: [...allowed] }, denied);
    current(expected);
  }

  async function bind(snapshot: ArtifactSnapshot) {
    current();
    stopReads(); stopWriters();
    cache?.close(); cache = undefined;
    const expected = ++epoch;
    viewer = snapshot.viewer;
    eventCursor = snapshot.cursor;
    const selectedRevision = state.selectedRevision;
    const changedAuthority = state.snapshot?.viewer.authzVersion !== snapshot.viewer.authzVersion;
    publish({ phase: "ready", snapshot, loading: true, storageReady: false, drafts: [], pending: [], error: undefined, storageError: undefined, ...(changedAuthority ? { versions: [], nextBeforeRevision: null, selectedVersion: undefined } : {}), selectedRevision });
    const nextPrivacy = createArtifactPrivacy(snapshotAuthority(snapshot));
    privacy = nextPrivacy;
    try {
      const nextCache = await openArtifactCache(nextPrivacy, options.cache);
      if (disposed || expected !== epoch) { nextCache.close(); return; }
      cache = nextCache;
      await authorizeRecovery(snapshot, nextCache, nextPrivacy, expected);
      for (const [id, draft] of guardedDrafts) if (nextPrivacy.authority.artifactIds.includes(id)) await nextCache.putDraft(draft);
      current(expected);
      const submit = artifactSubmit(client);
      const nextAutosave = createArtifactAutosave({ privacy: nextPrivacy, cache: nextCache, submit: async (input, requestOptions) => {
        current(expected); const result = await submit(input, requestOptions); current(expected); return result;
      }, recoveryArtifactId: artifactId,
        onConfirmed(receipt, generations) {
          if (disposed || expected !== epoch) return;
          for (const [id, generation] of Object.entries(generations)) if ((guardedDrafts.get(id)?.generation ?? Infinity) <= generation) guardedDrafts.delete(id);
          options.onConfirmed?.(receipt.artifacts.map((artifact) => artifact.artifactId));
          void refreshMetadata();
        }, onAccessDenied: (ids) => recheckDenied(ids, expected),
      });
      const nextOperations = createArtifactOperations({ privacy: nextPrivacy, journal: nextCache, artifactId,
        execute: async (operation, lease, replay) => { current(expected); const result = await executeArtifactOperation(client, operation, lease, replay); current(expected); return result; },
        onConfirmed(operation, result) { if (!disposed && expected === epoch) void confirmedOperation(operation, result); },
        onRevoked: (ids) => recheckDenied(ids, expected),
      });
      autosave = nextAutosave; operations = nextOperations;
      unsubscribe = [nextAutosave.subscribe(() => {
        if (disposed || expected !== epoch) return;
        if (nextPrivacy.state === "suspended") { suspend(true); return; }
        if (nextPrivacy.state === "closed") { stopReads(); mask("access-changed"); return; }
        publish({ autosave: nextAutosave.getSnapshot() });
      }), nextOperations.subscribe(() => {
        if (disposed || expected !== epoch) return;
        if (nextPrivacy.state === "suspended") { suspend(true); return; }
        if (nextPrivacy.state === "closed") { stopReads(); mask("access-changed"); return; }
        publish({ operation: nextOperations.getSnapshot() });
      })];
      await nextAutosave.recover(); await nextOperations.recover(); await readRecovery();
      current(expected);
      publish({ loading: false, storageReady: true, autosave: nextAutosave.getSnapshot(), operation: nextOperations.getSnapshot() });
    } catch (error) {
      if (disposed || expected !== epoch) return;
      if (error instanceof ArtifactSubmissionError && [401, 403, 404].includes(error.status)) { await fail(error, expected); return; }
      if (error instanceof PrivacyBoundaryError) { await fail(error, expected); return; }
      publish({ loading: false, storageReady: false, storageError: error });
    }
  }

  async function refreshMetadata() {
    if (disposed || state.phase !== "ready") return;
    const read = reading("snapshot");
    try {
      const snapshot = await client.snapshot(artifactId, { viewer, signal: read.controller.signal, allowAuthorityAdvance: true });
      read.assert();
      if (snapshot.viewer.authzVersion !== viewer.authzVersion) {
        await bind(snapshot);
      } else {
        publish({ snapshot, error: undefined });
        await readRecovery();
      }
    } catch (error) { if (!read.controller.signal.aborted) await fail(error, read.expected); }
    finally { read.done(); }
  }

  async function refresh() {
    if (rebuilding) return rebuilding;
    if (operations?.getSnapshot().phase === "pending" || autosave?.getSnapshot().status === "saving") return;
    const read = reading("refresh");
    publish({ loading: true, error: undefined });
    rebuilding = (async () => {
      try {
        const snapshot = await client.snapshot(artifactId, { viewer, signal: read.controller.signal, allowAuthorityAdvance: true });
        read.assert();
        await bind(snapshot);
      } catch (error) { if (!read.controller.signal.aborted) await fail(error, read.expected); }
      finally { read.done(); rebuilding = undefined; }
    })();
    return rebuilding;
  }

  async function recheckDenied(ids: string[], operationEpoch: number) {
    if (disposed || operationEpoch !== epoch) return;
    const previous = cache;
    hide("access-changed");
    const expected = epoch;
    try {
      current(expected);
      const response = await client.access(ids, { viewer, allowAuthorityAdvance: true });
      current(expected);
      if (response.unavailableArtifactIds.length) {
        await previous?.clearArtifacts(response.unavailableArtifactIds);
        for (const id of response.unavailableArtifactIds) guardedDrafts.delete(id);
      }
      if (!response.unavailableArtifactIds.includes(artifactId)) await refresh();
    } catch (error) {
      if (error instanceof ArtifactSubmissionError && error.status === 403) {
        guardedDrafts.clear();
        try { await previous?.clearPrivate(); } catch (cleanupError) { publish({ storageError: cleanupError }); }
      } else await fail(error, expected);
    }
  }

  async function confirmedOperation(operation: ArtifactOperation, result: ArtifactOperationResult) {
    options.onConfirmed?.(operation.kind === "undo" || operation.kind === "redo" ? Object.keys(operation.body.expectedArtifactRevisions) : [operation.artifactId]);
    if (operation.kind === "purge") {
      const previous = cache;
      guardedDrafts.delete(artifactId); hide("deleted");
      try { await previous?.clearArtifacts([artifactId]); } catch (error) { publish({ storageError: error }); }
      return;
    }
    if ((operation.kind === "branch" || operation.kind === "duplicate") && "artifact" in result) {
      const read = reading("created");
      try {
        const created = await client.snapshot(result.artifact.id, { viewer, signal: read.controller.signal });
        read.assert(); publish({ createdArtifact: { id: created.artifact.id, projectId: created.artifact.projectId, title: created.artifact.title } });
      } catch (error) { if (!read.controller.signal.aborted) await fail(error, read.expected); }
      finally { read.done(); }
    }
    await refreshMetadata();
  }

  async function loadVersions(more = false) {
    const beforeRevision = more ? state.nextBeforeRevision : undefined;
    if (more && beforeRevision === null) return;
    const read = reading("versions");
    publish({ versionsLoading: true });
    try {
      const page = await client.versions(artifactId, { viewer, signal: read.controller.signal }, { ...(typeof beforeRevision === "number" ? { beforeRevision } : {}), limit: 30 });
      read.assert();
      const versions = more ? [...state.versions] : [];
      for (const version of page.versions) if (!versions.some((item) => item.id === version.id)) versions.push(version);
      publish({ versions, nextBeforeRevision: page.nextBeforeRevision, versionsLoading: false, error: undefined });
    } catch (error) { if (!read.controller.signal.aborted) await fail(error, read.expected); }
    finally { read.done(); }
  }

  async function selectVersion(revision?: number) {
    if (revision === undefined) { reads.get("version")?.abort(); publish({ selectedRevision: undefined, selectedVersion: undefined, versionLoading: false }); return; }
    const read = reading("version");
    publish({ selectedRevision: revision, selectedVersion: undefined, versionLoading: true });
    try {
      const selectedVersion = await client.version(artifactId, revision, { viewer, signal: read.controller.signal });
      read.assert(); publish({ selectedVersion, versionLoading: false, error: undefined });
    } catch (error) { if (!read.controller.signal.aborted) await fail(error, read.expected); }
    finally { read.done(); }
  }

  function writable() {
    current();
    if (state.phase !== "ready" || !state.storageReady || !autosave || !operations || !cache) throw new PrivacyBoundaryError();
    return { autosave, operations, cache };
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async initialize() { if (initialized || disposed) return; initialized = true; await bind(initial); if (state.phase === "ready") await loadVersions(); },
    refresh, loadVersions, selectVersion,
    async pollEvents() {
      if (state.phase !== "ready" || state.loading || operations?.getSnapshot().phase === "pending" || autosave?.getSnapshot().status === "saving") return false;
      const read = reading("events");
      try {
        const page = await client.events(eventCursor, { viewer, signal: read.controller.signal });
        read.assert();
        if (page.resetRequired) {
          await refresh();
          if (state.phase === "ready") await loadVersions();
        } else {
          const affected = new Set([artifactId, ...(state.snapshot?.history.flatMap((group) => group.artifacts.map((item) => item.artifactId)) ?? [])]);
          if (page.events.some((event) => affected.has(event.objectId) || event.kind.startsWith("source.") || event.kind === "project.access-changed")) {
            await refreshMetadata();
            if (state.phase === "ready") await loadVersions();
          }
          current(read.expected);
          eventCursor = page.cursor;
        }
        return page.hasMore || page.events.length > 0;
      } catch (error) { if (!read.controller.signal.aborted) { await fail(error, read.expected); throw error; } return false; }
      finally { read.done(); }
    },
    async readRecoveryArtifact(id: string) {
      current();
      const lease = privacy?.capture([id]);
      if (!lease) throw new PrivacyBoundaryError();
      const read = reading(`recovery:${id}`);
      try {
        const snapshot = await client.snapshot(id, { viewer, signal: read.controller.signal });
        read.assert(); privacy?.assert(lease);
        return snapshot;
      } catch (error) {
        if (error instanceof ArtifactSubmissionError && [403, 404].includes(error.status)) await recheckDenied([id], read.expected);
        else if (!read.controller.signal.aborted) await fail(error, read.expected);
        throw error;
      } finally { read.done(); }
    },
    suspend,
    async resume() { current(); await refresh(); if (state.phase === "ready") { await loadVersions(); if (state.selectedRevision !== undefined) await selectVersion(state.selectedRevision); } },
    async switchAccount() {
      guardedDrafts.clear(); const previous = cache; hide("access-changed");
      try { await previous?.clearUserPrivate(); return true; } catch (error) { publish({ storageError: error }); return false; }
    },
    async writeDraft(input: LocalDraft) {
      const draft = LocalDraftSchema.parse(input);
      const ready = writable();
      if (!state.snapshot?.permissions.edit) throw new PrivacyBoundaryError();
      privacy?.capture([draft.artifactId]);
      if ((guardedDrafts.get(draft.artifactId)?.generation ?? -1) <= draft.generation) guardedDrafts.set(draft.artifactId, draft);
      publish({ drafts: [...guardedDrafts.values()] });
      return ready.autosave.writeDraft(draft);
    },
    enqueue(group: CommandGroupInput, generations: Record<string, number>) { const ready = writable(); if (ready.operations.getSnapshot().operation) return Promise.reject(new Error("artifacts.errors.pending")); return ready.autosave.enqueue(group, generations); },
    async retrySave() { const ready = writable(); await ready.autosave.retry(); await readRecovery(); },
    async run(operation: ArtifactOperation) {
      const ready = writable();
      if (ready.autosave.getSnapshot().pendingCount || ready.autosave.getSnapshot().dirtyCount) throw new Error("artifacts.errors.pending");
      return ready.operations.run(operation);
    },
    async branchReviewedDraft(operation: ArtifactOperation, reviewed: LocalDraft) {
      const ready = writable();
      const expected = epoch;
      if (!state.snapshot?.permissions.duplicate || operation.kind !== "branch" || operation.artifactId !== artifactId
        || reviewed.artifactId !== artifactId || operation.body.parentRevision !== reviewed.baseRevision
        || !operation.body.content || recoveryHash(operation.body.content) !== recoveryHash(reviewed.content)
        || state.pending.some((record) => record.state !== "conflict")) throw new Error("artifacts.errors.pending");
      const latest = await ready.cache.getDraft(artifactId);
      current(expected);
      if (!latest || latest.generation !== reviewed.generation || recoveryHash(latest) !== recoveryHash(reviewed)) throw new Error("artifacts.recovery.changed");
      // Saving a branch never discards the original draft or replays its rejected command.
      return ready.operations.run(operation);
    },
    retryOperation() { return writable().operations.retry(); },
    async dismissRejected() { const dismissed = await writable().operations.dismissRejected(); if (dismissed) await refresh(); return dismissed; },
    async prepareHistory(action: "undo" | "redo", groupId: string) {
      const ready = writable();
      if (!(await ready.autosave.flush()) || ready.operations.getSnapshot().operation) throw new Error("artifacts.errors.pending");
      const read = reading("history");
      try {
        const history = await client.history(artifactId, { viewer, signal: read.controller.signal });
        read.assert();
        const group = history.groups.find((item) => item.commandGroupId === groupId);
        if (!group) throw new PrivacyBoundaryError();
        const snapshot = state.snapshot!;
        publish({ snapshot: { ...snapshot, history: history.groups, cursor: history.cursor } });
        return { group, operation: prepareHistoryOperation(history, groupId, action) };
      } catch (error) { await fail(error, read.expected); throw error; }
      finally { read.done(); }
    },
    async discardReviewed(reviewed = { drafts: state.drafts, pending: state.pending }) {
      const ready = writable();
      if (state.pending.some((record) => record.state !== "conflict") || ready.operations.getSnapshot().operation) return false;
      const { drafts, pending } = reviewed;
      await ready.cache.discardReviewed(drafts, pending);
      for (const draft of drafts) if (guardedDrafts.get(draft.artifactId)?.generation === draft.generation) guardedDrafts.delete(draft.artifactId);
      await refresh(); return true;
    },
    async flush() { if (!autosave || !state.storageReady || state.phase !== "ready") return false; current(); return !operations?.getSnapshot().operation && await autosave.flush(); },
    async confirmedSignedOut() { guardedDrafts.clear(); const previous = cache; hide("authentication-required"); try { await previous?.clearUserPrivate(); return true; } catch (error) { publish({ storageError: error }); return false; } },
    dispose() { disposed = true; epoch += 1; stopReads(); stopWriters(); cache?.close(); guardedDrafts.clear(); listeners.clear(); },
  };
}
export type ArtifactSession = ReturnType<typeof createArtifactSession>;
