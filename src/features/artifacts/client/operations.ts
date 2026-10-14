import { z } from "zod";
import { IdSchema, InstantSchema } from "@/contracts/primitives";
import { ErrorEnvelopeSchema } from "@/contracts/errors";
import { ArtifactHistoryActionSchema, ArtifactMutationSchema, BranchArtifactSchema, DuplicateArtifactSchema, MoveArtifactSchema, PurgeArtifactSchema, RenameArtifactSchema, RestoreArtifactVersionSchema } from "../contracts";
import { ArtifactSubmissionError } from "./autosave";
import { PrivacyBoundaryError, type ArtifactPrivacy, type PrivacyLease } from "./privacy";

const fields = { operationId: IdSchema, artifactId: IdSchema, createdAt: InstantSchema, state: z.enum(["ready", "uncertain", "rejected", "authentication-required"]), failure: ErrorEnvelopeSchema.optional() };
export const ArtifactOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...fields, kind: z.literal("undo"), body: ArtifactHistoryActionSchema }),
  z.strictObject({ ...fields, kind: z.literal("redo"), body: ArtifactHistoryActionSchema }),
  z.strictObject({ ...fields, kind: z.literal("rename"), body: RenameArtifactSchema }),
  z.strictObject({ ...fields, kind: z.literal("move"), body: MoveArtifactSchema }),
  z.strictObject({ ...fields, kind: z.literal("archive"), body: ArtifactMutationSchema }),
  z.strictObject({ ...fields, kind: z.literal("trash"), body: ArtifactMutationSchema }),
  z.strictObject({ ...fields, kind: z.literal("restore"), body: ArtifactMutationSchema }),
  z.strictObject({ ...fields, kind: z.literal("duplicate"), body: DuplicateArtifactSchema, expectedKind: z.enum(["table", "document", "design", "plan"]) }),
  z.strictObject({ ...fields, kind: z.literal("branch"), body: BranchArtifactSchema, expectedKind: z.enum(["table", "document", "design", "plan"]) }),
  z.strictObject({ ...fields, kind: z.literal("restore-version"), body: RestoreArtifactVersionSchema }),
  z.strictObject({ ...fields, kind: z.literal("purge"), body: PurgeArtifactSchema }),
]).superRefine((operation, context) => {
  if ((operation.kind === "undo" || operation.kind === "redo") && (operation.operationId !== operation.body.commandGroupId || operation.body.expectedArtifactRevisions[operation.artifactId] === undefined)) context.addIssue({ code: "custom", message: "History identity must match its reviewed group." });
});
export type ArtifactOperation = z.infer<typeof ArtifactOperationSchema>;
export type ArtifactOperationJournal = {
  putOperation: (operation: ArtifactOperation) => Promise<void>;
  listOperations: (artifactId: string) => Promise<ArtifactOperation[]>;
  removeOperation: (operationId: string) => Promise<void>;
};
export type OperationPhase = "idle" | "pending" | "uncertain" | "rejected" | "authentication-required" | "access-changed" | "storage-error";
export type OperationSnapshot = Readonly<{ phase: OperationPhase; operation?: ArtifactOperation; error?: unknown }>;
export function operationArtifactIds(operation: ArtifactOperation): string[] {
  return operation.kind === "undo" || operation.kind === "redo" ? Object.keys(operation.body.expectedArtifactRevisions) : [operation.artifactId];
}

/** One explicit operation at a time; an uncertain request keeps its original body and ID. */
export function createArtifactOperations<T>(options: {
  privacy: ArtifactPrivacy; journal: ArtifactOperationJournal; artifactId: string;
  execute: (operation: ArtifactOperation, lease: PrivacyLease, replay: boolean) => Promise<T>;
  onConfirmed?: (operation: ArtifactOperation, result: T) => void;
  onRevoked?: (artifactIds: string[]) => Promise<void>;
}) {
  let state: OperationSnapshot = { phase: "idle" };
  let active: Promise<T | undefined> | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  function publish(next: OperationSnapshot) { state = next; for (const listener of listeners) listener(); }
  const unsubscribe = options.privacy.subscribe(() => {
    publish(options.privacy.state === "closed" ? { phase: "access-changed" } : { ...state, phase: "authentication-required" });
  });

  async function recoverNext(): Promise<boolean> {
    if (disposed) return false;
    const lease = options.privacy.capture([options.artifactId]);
    try {
      const records = await options.journal.listOperations(options.artifactId);
      options.privacy.assert(lease);
      if (disposed) return false;
      const operation = records[0];
      publish(operation ? { phase: operation.state === "rejected" ? "rejected" : operation.state === "authentication-required" ? "authentication-required" : "uncertain", operation } : { phase: "idle" });
      return true;
    } catch (error) {
      if (disposed || lease.signal.aborted) return false;
      if (error instanceof PrivacyBoundaryError) { options.privacy.close(); return false; }
      publish({ phase: "storage-error", error });
      return false;
    }
  }

  async function attempt(input: ArtifactOperation, replay: boolean): Promise<T | undefined> {
    const operation = ArtifactOperationSchema.parse(input);
    const lease = options.privacy.capture(operationArtifactIds(operation));
    if (operation.body.workspaceId !== lease.authority.workspaceId || (!replay && operation.body.expectedAuthzVersion !== lease.authority.authzVersion)) throw new PrivacyBoundaryError();
    // A crash after this transaction is indistinguishable from a lost response, so recover conservatively.
    const sending = { ...operation, state: "uncertain" as const, failure: undefined };
    try { await options.journal.putOperation(sending); options.privacy.assert(lease); if (disposed) return; }
    catch (error) {
      if (disposed || lease.signal.aborted) return;
      if (error instanceof PrivacyBoundaryError) options.privacy.close();
      else publish({ phase: "storage-error", operation, error });
      return;
    }
    publish({ phase: "pending", operation: sending });
    try {
      const result = await options.execute(structuredClone(sending), lease, replay);
      options.privacy.assert(lease);
      if (disposed) return;
      await options.journal.removeOperation(operation.operationId);
      options.privacy.assert(lease);
      if (disposed) return;
      // Another tab may have left more unresolved work. Acknowledgement must not hide it.
      await recoverNext();
      options.privacy.assert(lease);
      if (disposed) return;
      try { options.onConfirmed?.(operation, result); } catch (error) { publish({ ...state, error }); }
      return result;
    } catch (error) {
      if (disposed || lease.signal.aborted) return;
      if (error instanceof PrivacyBoundaryError) { options.privacy.close(); return; }
      const status = error instanceof ArtifactSubmissionError ? error.status : 0;
      const failure = error instanceof ArtifactSubmissionError ? error.envelope : undefined;
      if (status === 403 || status === 404 || failure?.code === "FORBIDDEN" || failure?.code === "NOT_FOUND") {
        options.privacy.close();
        try { await options.onRevoked?.(operationArtifactIds(operation)); } catch { /* Closed authority still prevents disclosure when device cleanup fails. */ }
        return;
      }
      const phase = status === 401 || failure?.code === "UNAUTHENTICATED" ? "authentication-required"
        : failure && [400, 409, 422].includes(status) ? "rejected" : "uncertain";
      const retained = ArtifactOperationSchema.parse({ ...operation, state: phase, ...(failure ? { failure } : {}) });
      try { await options.journal.putOperation(retained); options.privacy.assert(lease); }
      catch (storageError) { if (!lease.signal.aborted && !disposed) publish({ phase: "storage-error", operation: sending, error: storageError }); return; }
      if (phase === "authentication-required") options.privacy.suspend();
      publish({ phase, operation: retained, error });
    }
  }

  function start(operation: ArtifactOperation, replay: boolean) {
    if (disposed) return Promise.reject(new PrivacyBoundaryError());
    if (active) return active;
    active = (async () => {
      if (!replay && (!(await recoverNext()) || state.phase !== "idle")) throw new Error("artifacts.errors.pending");
      return attempt(operation, replay);
    })().finally(() => { active = undefined; });
    return active;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async recover() {
      if (active || state.operation) throw new Error("Recover before starting another operation.");
      await recoverNext();
    },
    run(operation: ArtifactOperation) {
      if (active || state.phase !== "idle" || state.operation) return Promise.reject(new Error("artifacts.errors.pending"));
      return start(operation, false);
    },
    retry() {
      if (state.phase === "storage-error" && !state.operation) return recoverNext().then(() => undefined);
      if (!state.operation || state.phase === "rejected") return Promise.resolve(undefined);
      return start(state.operation, true);
    },
    async dismissRejected() {
      if (active || state.phase !== "rejected" || !state.operation) return false;
      const lease = options.privacy.capture(operationArtifactIds(state.operation));
      await options.journal.removeOperation(state.operation.operationId);
      options.privacy.assert(lease);
      await recoverNext();
      return true;
    },
    dispose() { disposed = true; unsubscribe(); state = { phase: "access-changed" }; listeners.clear(); },
  };
}
export type ArtifactOperations<T = unknown> = ReturnType<typeof createArtifactOperations<T>>;
