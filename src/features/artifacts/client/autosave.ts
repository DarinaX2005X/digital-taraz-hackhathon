import { CommandGroupInputSchema, type CommandGroupInput } from "@/contracts/commands";
import { ErrorEnvelopeSchema, type ErrorEnvelope } from "@/contracts/errors";
import { CommandReceiptSchema, type ArtifactCommandRequest, type CommandReceipt } from "../contracts";
import { type ArtifactCache } from "./indexed-db";
import { LocalDraftSchema, PendingCommandSchema, type LocalDraft, type PendingCommand } from "./local-records";
import { PrivacyBoundaryError, type ArtifactPrivacy, type CacheAuthority } from "./privacy";

export class ArtifactSubmissionError extends Error {
  readonly envelope?: ErrorEnvelope;
  constructor(readonly kind: "network" | "timeout" | "server" | "invalid-response", envelope?: ErrorEnvelope) {
    super(`artifacts.errors.${kind}`);
    this.name = "ArtifactSubmissionError";
    this.envelope = envelope ? ErrorEnvelopeSchema.parse(envelope) : undefined;
  }
}

export type AutosaveStatus = "saved" | "local-only" | "saving" | "uncertain" | "conflict" | "authentication-required" | "access-changed" | "storage-error" | "failed";
export type AutosaveState = Readonly<{ status: AutosaveStatus; pendingCount: number; dirtyCount: number; locallyPersisted: boolean; failure?: ErrorEnvelope }>;
export type ArtifactSubmit = (input: ArtifactCommandRequest, options: { signal: AbortSignal; expectedUserId: string; idempotencyKey: string }) => Promise<CommandReceipt>;
type Options = { privacy: ArtifactPrivacy; cache: ArtifactCache; submit: ArtifactSubmit; now?: () => string; onConfirmed?: (receipt: CommandReceipt) => void; flushGroups?: () => void };

/** Durable outbox; it never retries a rejected/ambiguous command without an explicit call. */
export function createArtifactAutosave(options: Options) {
  const { privacy, cache } = options;
  const listeners = new Set<() => void>();
  const queue: PendingCommand[] = [];
  const dirty = new Map<string, { generation: number; persisted: boolean }>();
  const draftWrites = new Set<Promise<void>>();
  let state: AutosaveState = { status: "saved", pendingCount: 0, dirtyCount: 0, locallyPersisted: true };
  let running: Promise<void> | undefined;
  let blocked = false;
  let disposed = false;

  function publish(status: AutosaveStatus, failure?: ErrorEnvelope) {
    state = { status, pendingCount: queue.length, dirtyCount: dirty.size, locallyPersisted: [...dirty.values()].every((draft) => draft.persisted), ...(failure ? { failure } : {}) };
    for (const listener of listeners) listener();
  }

  const unsubscribe = privacy.subscribe(() => {
    blocked = true;
    if (privacy.state === "closed") { queue.length = 0; dirty.clear(); }
    publish(privacy.state === "closed" ? "access-changed" : "authentication-required");
  });

  function assertOpen() { if (disposed) throw new PrivacyBoundaryError(); privacy.capture(); }

  function validateReceipt(raw: unknown, record: PendingCommand): CommandReceipt {
    const parsed = CommandReceiptSchema.safeParse(raw);
    if (!parsed.success) throw new ArtifactSubmissionError("invalid-response");
    const receipt = parsed.data;
    if (receipt.commandGroupId !== record.group.commandGroupId || receipt.historyGroup.commandGroupId !== receipt.commandGroupId
      || receipt.historyGroup.actorId !== privacy.authority.userId || receipt.artifacts.length !== record.group.commands.length
      || Object.keys(receipt.committedRevisionVector).length !== record.group.commands.length
      || record.group.commands.some((command) => receipt.committedRevisionVector[command.artifactId] !== command.baseRevision + 1
        || receipt.artifacts.filter((item) => item.artifactId === command.artifactId && item.revision === command.baseRevision + 1).length !== 1)) {
      throw new ArtifactSubmissionError("invalid-response");
    }
    return receipt;
  }

  async function retainFailure(record: PendingCommand, error: unknown) {
    blocked = true;
    if (error instanceof PrivacyBoundaryError) { privacy.close(); return; }
    const failure = error instanceof ArtifactSubmissionError ? error.envelope : undefined;
    if (failure?.code === "FORBIDDEN" || failure?.code === "NOT_FOUND") {
      queue.length = 0; dirty.clear();
      try { await cache.clearPrivate(); } catch { /* Privacy is closed even if the device refuses cleanup. */ }
      publish("access-changed");
      return;
    }
    if (failure?.code === "UNAUTHENTICATED") {
      record.state = "authentication-required";
      try { await cache.putPending(record); } catch { /* The already-written outbox is still not acknowledged. */ }
      privacy.suspend();
      publish("authentication-required", failure);
      return;
    }
    if (failure?.code === "CONFLICT") {
      record.state = "conflict"; record.conflict = failure;
      try { await cache.putPending(record); } catch { publish("storage-error", failure); return; }
      publish("conflict", failure);
      return;
    }
    record.state = "uncertain";
    try { await cache.putPending(record); } catch { publish("storage-error", failure); return; }
    publish(failure ? "failed" : "uncertain", failure);
  }

  async function drain() {
    while (queue.length && !blocked && !disposed) {
      const record = queue[0]!;
      const lease = privacy.capture(record.group.commands.map((command) => command.artifactId));
      try { await cache.putPending(record); } catch (error) {
        if (error instanceof PrivacyBoundaryError) { privacy.close(); return; }
        blocked = true; publish("storage-error"); return;
      }
      privacy.assert(lease);
      publish("saving");
      try {
        const raw = await options.submit({ workspaceId: lease.authority.workspaceId, expectedAuthzVersion: lease.authority.authzVersion, group: structuredClone(record.group) }, { signal: lease.signal, expectedUserId: lease.authority.userId, idempotencyKey: record.group.commandGroupId });
        privacy.assert(lease);
        const receipt = validateReceipt(raw, record);
        await cache.acknowledge(record);
        privacy.assert(lease);
        queue.shift();
        for (const [artifactId, generation] of Object.entries(record.draftGenerations)) {
          if ((dirty.get(artifactId)?.generation ?? Infinity) <= generation) dirty.delete(artifactId);
        }
        try { options.onConfirmed?.(receipt); } catch { blocked = true; publish("failed"); return; }
        publish(queue.length || dirty.size ? "local-only" : "saved");
      } catch (error) {
        if (lease.signal.aborted || disposed) return;
        await retainFailure(record, error);
      }
    }
  }

  function start(): Promise<void> {
    if (running) return running;
    running = drain().finally(() => { running = undefined; });
    return running;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async writeDraft(input: LocalDraft): Promise<void> {
      assertOpen();
      const value = LocalDraftSchema.parse(input);
      const lease = privacy.capture([value.artifactId]);
      if ((dirty.get(value.artifactId)?.generation ?? -1) > value.generation) return;
      dirty.set(value.artifactId, { generation: value.generation, persisted: false });
      publish(blocked ? state.status : "local-only", state.failure);
      const writing = cache.putDraft(value);
      draftWrites.add(writing);
      try {
        await writing;
        privacy.assert(lease);
        if (dirty.get(value.artifactId)?.generation === value.generation) dirty.set(value.artifactId, { generation: value.generation, persisted: true });
        if (!disposed && privacy.state === "active") publish(blocked ? state.status : "local-only", state.failure);
      } catch (error) {
        if (!disposed && !lease.signal.aborted && privacy.state === "active") {
          if (error instanceof PrivacyBoundaryError) privacy.close();
          else publish("storage-error");
        }
        throw error;
      } finally { draftWrites.delete(writing); }
    },
    async enqueue(input: CommandGroupInput, generations: Record<string, number>): Promise<void> {
      assertOpen();
      const group = CommandGroupInputSchema.parse(input);
      const lease = privacy.capture(group.commands.map((command) => command.artifactId));
      const existing = queue.find((record) => record.group.commandGroupId === group.commandGroupId);
      if (existing) {
        if (JSON.stringify(existing.group) !== JSON.stringify(group)) throw new TypeError("A command ID cannot be reused with changed content.");
        return running ?? Promise.resolve();
      }
      const record = PendingCommandSchema.parse({ group, state: "ready", createdAt: options.now?.() ?? new Date().toISOString(), draftGenerations: generations });
      queue.push(record);
      publish(blocked ? state.status : "local-only", state.failure);
      try { await cache.putPending(record); privacy.assert(lease); } catch (error) {
        if (lease.signal.aborted || disposed) return;
        if (error instanceof PrivacyBoundaryError) { privacy.close(); return; }
        blocked = true; publish("storage-error"); return;
      }
      return blocked ? undefined : start();
    },
    async recover(): Promise<void> {
      assertOpen();
      if (running || queue.length) throw new Error("Recover before adding new commands.");
      const lease = privacy.capture();
      const records = await cache.listPending();
      const recovered = new Map<string, { generation: number; persisted: boolean }>();
      for (const record of records) for (const [artifactId, generation] of Object.entries(record.draftGenerations)) recovered.set(artifactId, { generation, persisted: true });
      for (const artifactId of lease.authority.artifactIds) {
        const draft = await cache.getDraft(artifactId);
        if (draft && draft.generation >= (recovered.get(artifactId)?.generation ?? -1)) recovered.set(artifactId, { generation: draft.generation, persisted: true });
      }
      privacy.assert(lease);
      queue.push(...records);
      blocked = records.length > 0;
      for (const [id, value] of recovered) dirty.set(id, value);
      const head = records[0];
      publish(head?.state === "conflict" ? "conflict" : head?.state === "authentication-required" ? "authentication-required" : head || dirty.size ? "local-only" : "saved", head?.conflict);
    },
    resumeAfterAuthentication(authority: CacheAuthority): void {
      if (authority.authzVersion !== privacy.authority.authzVersion) { privacy.close(); throw new PrivacyBoundaryError(); }
      privacy.resume(authority);
      blocked = true;
      publish("local-only");
    },
    async retry(): Promise<void> {
      assertOpen();
      if (queue[0]?.state === "conflict") return;
      blocked = false;
      await start();
    },
    async flush(): Promise<boolean> {
      assertOpen();
      options.flushGroups?.();
      await Promise.allSettled([...draftWrites]);
      await (running ?? (blocked ? Promise.resolve() : start()));
      return !blocked && queue.length === 0 && dirty.size === 0 && state.status === "saved";
    },
    prepareConfirmedSignOut(decision: "save" | "discard"): Promise<boolean> {
      return decision === "save" ? this.flush() : Promise.resolve(true);
    },
    async confirmedSignedOut(): Promise<boolean> {
      try { await cache.clearUserPrivate(); return true; } catch { return false; }
    },
    dispose() { disposed = true; unsubscribe(); privacy.close(); queue.length = 0; dirty.clear(); listeners.clear(); },
  };
}

export type ArtifactAutosave = ReturnType<typeof createArtifactAutosave>;
