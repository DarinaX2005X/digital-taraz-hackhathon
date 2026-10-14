import { z } from "zod";
import { IdSchema } from "@/contracts/primitives";
import { ArtifactHistorySchema, type ArtifactHistory } from "../contracts";
import { LocalDraftSchema, PendingCommandSchema, type LocalDraft, type PendingCommand } from "./local-records";
import { ArtifactOperationSchema, operationArtifactIds, type ArtifactOperation } from "./operations";
import { CacheAuthoritySchema, PrivacyBoundaryError, type ArtifactPrivacy, type PrivacyLease, type CacheAuthority } from "./privacy";

const DATABASE_VERSION = 2;
const STORES = ["authority", "drafts", "pending", "history", "operations"] as const;
type StoreName = typeof STORES[number];
type Stored<T> = { key: string[]; partition: string; authzVersion: number; value: T; sequence?: number };
type EpochRecord = { partition: string; token: string; authzVersion: number; nextSequence: number };

export class ArtifactStorageError extends Error {
  constructor(readonly reason: "unavailable" | "quota" | "corrupt" | "blocked" | "failed") {
    super(`artifacts.storage.${reason}`); this.name = "ArtifactStorageError";
  }
}

function storageError(error: unknown): Error {
  if (error instanceof ArtifactStorageError || error instanceof PrivacyBoundaryError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") return new ArtifactStorageError("quota");
  return new ArtifactStorageError("failed");
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function completion(transaction: IDBTransaction, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { try { transaction.abort(); } catch { /* A committed transaction cannot be aborted. */ } };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    transaction.oncomplete = () => { cleanup(); resolve(); };
    transaction.onabort = () => { cleanup(); reject(signal?.aborted ? new PrivacyBoundaryError() : transaction.error); };
    transaction.onerror = () => { /* Abort reports the transaction's final failure. */ };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function openDatabase(factory: IDBFactory | undefined, name: string): Promise<IDBDatabase> {
  if (!factory) throw new ArtifactStorageError("unavailable");
  return new Promise((resolve, reject) => {
    let settled = false;
    let opening: IDBOpenDBRequest;
    try { opening = factory.open(name, DATABASE_VERSION); } catch (error) { reject(storageError(error)); return; }
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains("authority")) db.createObjectStore("authority", { keyPath: "partition" });
      for (const name of ["drafts", "pending", "history", "operations"] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "key" }).createIndex("partition", "partition");
      }
    };
    opening.onblocked = () => { settled = true; reject(new ArtifactStorageError("blocked")); };
    opening.onerror = () => { settled = true; reject(storageError(opening.error)); };
    opening.onsuccess = () => {
      if (settled) { opening.result.close(); return; }
      opening.result.onversionchange = () => opening.result.close();
      resolve(opening.result);
    };
  });
}

export type ArtifactCacheOptions = { factory?: IDBFactory; databaseName?: string; createId?: () => string };

/** All reads and writes check both the live account epoch and the persisted revocation epoch. */
export async function openArtifactCache(privacy: ArtifactPrivacy, options: ArtifactCacheOptions = {}) {
  const lease = privacy.capture();
  const database = await openDatabase(options.factory ?? globalThis.indexedDB, options.databaseName ?? "tirlik-artifact-drafts");
  const partition = `${lease.authority.userId}/${lease.authority.workspaceId}`;
  const createId = options.createId ?? (() => crypto.randomUUID());
  let closed = false;
  let token = "";

  async function transaction<T>(names: StoreName[], mode: IDBTransactionMode, current: PrivacyLease | undefined, run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    if (closed) throw new ArtifactStorageError("unavailable");
    if (current) privacy.assert(current);
    const tx = database.transaction(names, mode);
    const done = completion(tx, current?.signal);
    // Attach a handler immediately, before a request can reject during an abort.
    void done.catch(() => undefined);
    try {
      const result = await run(tx);
      await done;
      if (current) privacy.assert(current);
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may have already finished. */ }
      await done.catch(() => undefined);
      if (current?.signal.aborted) throw new PrivacyBoundaryError();
      throw storageError(error);
    }
  }

  async function deletePartition(tx: IDBTransaction, target: string) {
    for (const name of ["drafts", "pending", "history", "operations"] as const) {
      const store = tx.objectStore(name);
      const keys = await request(store.index("partition").getAllKeys(target));
      for (const key of keys) store.delete(key);
    }
  }

  async function revalidateRecords(tx: IDBTransaction, authority: CacheAuthority, previousVersion: number, denied: Set<string> = new Set()) {
    const allowed = new Set(authority.artifactIds);
    if ([...denied].some((id) => allowed.has(id))) throw new PrivacyBoundaryError();
    for (const name of ["drafts", "pending", "operations", "history"] as const) {
      const store = tx.objectStore(name);
      const records = await request(store.index("partition").getAll(partition)) as Stored<unknown>[];
      for (const record of records) {
        let ids: string[];
        let value: unknown = record.value;
        if (name === "drafts") ids = [LocalDraftSchema.parse(value).artifactId];
        else if (name === "pending") {
          const pending = PendingCommandSchema.parse(value);
          value = { ...pending, expectedAuthzVersion: pending.expectedAuthzVersion ?? record.authzVersion };
          ids = pending.group.commands.map((command) => command.artifactId);
        } else if (name === "operations") ids = operationArtifactIds(ArtifactOperationSchema.parse(value));
        else {
          const history = ArtifactHistorySchema.parse(value);
          ids = [history.artifactId, ...history.groups.flatMap((group) => group.artifacts.map((artifact) => artifact.artifactId))];
        }
        if (ids.some((id) => denied.has(id)) || (name === "history" && previousVersion !== authority.authzVersion)) { store.delete(record.key); continue; }
        // A partial fresh response does not revoke other artifacts: leave them quarantined at their prior epoch.
        if (ids.every((id) => allowed.has(id))) store.put({ ...record, value, authzVersion: authority.authzVersion });
      }
    }
  }

  try {
    privacy.assert(lease);
    token = await transaction([...STORES], "readwrite", lease, async (tx) => {
      const store = tx.objectStore("authority");
      const record = await request(store.get(partition)) as EpochRecord | undefined;
      if (record && record.authzVersion > lease.authority.authzVersion) throw new PrivacyBoundaryError();
      await revalidateRecords(tx, lease.authority, record?.authzVersion ?? lease.authority.authzVersion);
      const next = record?.authzVersion === lease.authority.authzVersion ? record.token : IdSchema.parse(createId());
      store.put({ partition, token: next, authzVersion: lease.authority.authzVersion, nextSequence: record?.nextSequence ?? 0 });
      return next;
    });
  } catch (error) { database.close(); throw error; }

  async function verify(tx: IDBTransaction, current: PrivacyLease) {
    const record = await request(tx.objectStore("authority").get(partition)) as EpochRecord | undefined;
    privacy.assert(current);
    if (record?.token !== token || record.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
    return record;
  }

  function stored<T>(id: string, value: T, current: PrivacyLease): Stored<T> {
    return { key: [partition, id], partition, authzVersion: current.authority.authzVersion, value };
  }

  async function read<T>(name: "drafts" | "pending" | "history", id: string, schema: z.ZodType<T>, artifactIds: string[]): Promise<T | undefined> {
    const current = privacy.capture(artifactIds);
    return transaction(["authority", name], "readonly", current, async (tx) => {
      await verify(tx, current);
      const record = await request(tx.objectStore(name).get([partition, id])) as Stored<unknown> | undefined;
      if (!record) return undefined;
      if (record.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
      const parsed = schema.safeParse(record.value);
      if (!parsed.success) throw new ArtifactStorageError("corrupt");
      return parsed.data;
    });
  }

  return {
    async putDraft(input: LocalDraft): Promise<void> {
      const value = LocalDraftSchema.parse(input);
      const current = privacy.capture([value.artifactId]);
      await transaction(["authority", "drafts"], "readwrite", current, async (tx) => {
        await verify(tx, current);
        const store = tx.objectStore("drafts");
        const previous = await request(store.get([partition, value.artifactId])) as Stored<LocalDraft> | undefined;
        if (previous && previous.value.generation > value.generation) return;
        if (previous?.value.generation === value.generation && JSON.stringify(previous.value) !== JSON.stringify(value)) throw new ArtifactStorageError("corrupt");
        store.put(stored(value.artifactId, value, current));
      });
    },
    getDraft: (artifactId: string) => read("drafts", IdSchema.parse(artifactId), LocalDraftSchema, [artifactId]),
    async putHistory(input: ArtifactHistory): Promise<void> {
      const value = ArtifactHistorySchema.parse(input);
      const current = privacy.capture([value.artifactId, ...value.groups.flatMap((group) => group.artifacts.map((artifact) => artifact.artifactId))]);
      if (value.viewer.userId !== current.authority.userId || value.viewer.workspaceId !== current.authority.workspaceId || value.viewer.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
      await transaction(["authority", "history"], "readwrite", current, async (tx) => {
        await verify(tx, current);
        tx.objectStore("history").put(stored(value.artifactId, value, current));
      });
    },
    async getHistory(artifactId: string): Promise<ArtifactHistory | undefined> {
      const value = await read("history", IdSchema.parse(artifactId), ArtifactHistorySchema, [artifactId]);
      if (!value) return undefined;
      const current = privacy.capture(value.groups.flatMap((group) => group.artifacts.map((artifact) => artifact.artifactId)));
      if (value.viewer.userId !== current.authority.userId || value.viewer.workspaceId !== current.authority.workspaceId || value.viewer.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
      return value;
    },
    async putPending(input: PendingCommand): Promise<void> {
      const parsed = PendingCommandSchema.parse(input);
      const current = privacy.capture(parsed.group.commands.map((command) => command.artifactId));
      const value = { ...parsed, expectedAuthzVersion: parsed.expectedAuthzVersion ?? current.authority.authzVersion };
      if (value.expectedAuthzVersion > current.authority.authzVersion) throw new PrivacyBoundaryError();
      await transaction(["authority", "pending"], "readwrite", current, async (tx) => {
        const authority = await verify(tx, current);
        const store = tx.objectStore("pending");
        const old = await request(store.get([partition, value.group.commandGroupId])) as Stored<PendingCommand> | undefined;
        if (old && (JSON.stringify(old.value.group) !== JSON.stringify(value.group) || old.value.expectedAuthzVersion !== value.expectedAuthzVersion)) throw new ArtifactStorageError("corrupt");
        if (old && (!Number.isSafeInteger(old.sequence) || old.sequence! < 1)) throw new ArtifactStorageError("corrupt");
        const sequence = old?.sequence ?? authority.nextSequence + 1;
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ArtifactStorageError("corrupt");
        if (!old) tx.objectStore("authority").put({ ...authority, nextSequence: sequence });
        store.put({ ...stored(value.group.commandGroupId, value, current), sequence });
      });
    },
    async listPending(artifactId?: string): Promise<PendingCommand[]> {
      if (artifactId !== undefined) privacy.capture([IdSchema.parse(artifactId)]);
      const current = privacy.capture();
      return transaction(["authority", "pending"], "readonly", current, async (tx) => {
        await verify(tx, current);
        const records = await request(tx.objectStore("pending").index("partition").getAll(partition)) as Stored<unknown>[];
        const sequences = new Set<number>();
        for (const record of records) {
          if (!Number.isSafeInteger(record.sequence) || record.sequence! < 1 || sequences.has(record.sequence!)) throw new ArtifactStorageError("corrupt");
          sequences.add(record.sequence!);
        }
        return records.sort((a, b) => a.sequence! - b.sequence!).flatMap((record) => {
          const parsed = PendingCommandSchema.safeParse(record.value);
          if (!parsed.success) throw new ArtifactStorageError("corrupt");
          if (artifactId !== undefined && !parsed.data.group.commands.some((command) => command.artifactId === artifactId)) return [];
          if (record.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
          privacy.assert(current, parsed.data.group.commands.map((command) => command.artifactId));
          return [parsed.data];
        });
      });
    },
    /** Candidate IDs only, never authority or display data. Re-read each candidate through the server before recovery. */
    async recoveryTargetIds(artifactId: string): Promise<string[]> {
      const current = privacy.capture([IdSchema.parse(artifactId)]);
      return transaction(["authority", "pending", "operations"], "readonly", current, async (tx) => {
        await verify(tx, current);
        const ids = new Set([artifactId]);
        const pending = await request(tx.objectStore("pending").index("partition").getAll(partition)) as Stored<unknown>[];
        for (const record of pending) {
          const value = PendingCommandSchema.parse(record.value);
          const affected = value.group.commands.map((command) => command.artifactId);
          if (affected.includes(artifactId)) for (const id of affected) ids.add(id);
        }
        const operations = await request(tx.objectStore("operations").index("partition").getAll(partition)) as Stored<unknown>[];
        for (const record of operations) {
          const value = ArtifactOperationSchema.parse(record.value);
          if (operationArtifactIds(value).includes(artifactId)) for (const id of operationArtifactIds(value)) ids.add(id);
        }
        if (ids.size > 1000) throw new ArtifactStorageError("corrupt");
        return [...ids];
      });
    },
    async putOperation(input: ArtifactOperation): Promise<void> {
      const value = ArtifactOperationSchema.parse(input);
      const current = privacy.capture(operationArtifactIds(value));
      if (value.body.workspaceId !== current.authority.workspaceId || value.body.expectedAuthzVersion > current.authority.authzVersion) throw new PrivacyBoundaryError();
      await transaction(["authority", "operations"], "readwrite", current, async (tx) => {
        const authority = await verify(tx, current);
        const store = tx.objectStore("operations");
        const old = await request(store.get([partition, value.operationId])) as Stored<ArtifactOperation> | undefined;
        const identity = (operation: ArtifactOperation) => JSON.stringify({ kind: operation.kind, artifactId: operation.artifactId, body: operation.body, expectedKind: "expectedKind" in operation ? operation.expectedKind : undefined });
        if (old && identity(old.value) !== identity(value)) throw new ArtifactStorageError("corrupt");
        const sequence = old?.sequence ?? authority.nextSequence + 1;
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ArtifactStorageError("corrupt");
        if (!old) tx.objectStore("authority").put({ ...authority, nextSequence: sequence });
        store.put({ ...stored(value.operationId, value, current), sequence });
      });
    },
    async listOperations(artifactId: string): Promise<ArtifactOperation[]> {
      const current = privacy.capture([IdSchema.parse(artifactId)]);
      return transaction(["authority", "operations"], "readonly", current, async (tx) => {
        await verify(tx, current);
        const records = await request(tx.objectStore("operations").index("partition").getAll(partition)) as Stored<unknown>[];
        return records.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).flatMap((record) => {
          const value = ArtifactOperationSchema.safeParse(record.value);
          if (!value.success || !Number.isSafeInteger(record.sequence) || record.sequence! < 1) throw new ArtifactStorageError("corrupt");
          if (!operationArtifactIds(value.data).includes(artifactId)) return [];
          privacy.assert(current, operationArtifactIds(value.data));
          if (record.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
          return [value.data];
        });
      });
    },
    async removeOperation(operationId: string): Promise<void> {
      const current = privacy.capture();
      await transaction(["authority", "operations"], "readwrite", current, async (tx) => {
        await verify(tx, current);
        const store = tx.objectStore("operations");
        const key = [partition, IdSchema.parse(operationId)];
        const record = await request(store.get(key)) as Stored<unknown> | undefined;
        if (record) {
          privacy.assert(current, operationArtifactIds(ArtifactOperationSchema.parse(record.value)));
          if (record.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
          store.delete(key);
        }
      });
    },
    /** Fresh server authority only. Unlisted artifacts remain unreadable until independently revalidated. */
    async revalidate(nextInput: CacheAuthority, deniedArtifactIds: string[] = []): Promise<void> {
      const next = CacheAuthoritySchema.parse(nextInput);
      const previous = privacy.capture();
      if (next.userId !== previous.authority.userId || next.workspaceId !== previous.authority.workspaceId || next.authzVersion < previous.authority.authzVersion) throw new PrivacyBoundaryError();
      const denied = new Set(deniedArtifactIds.map((id) => IdSchema.parse(id)));
      const nextToken = next.authzVersion !== previous.authority.authzVersion || denied.size > 0 ? IdSchema.parse(createId()) : token;
      await transaction([...STORES], "readwrite", previous, async (tx) => {
        const record = await verify(tx, previous);
        await revalidateRecords(tx, next, previous.authority.authzVersion, denied);
        tx.objectStore("authority").put({ ...record, token: nextToken, authzVersion: next.authzVersion });
      });
      token = nextToken;
      privacy.resume(next);
    },
    async clearArtifacts(artifactIds: string[]): Promise<void> {
      const denied = new Set(artifactIds.map((id) => IdSchema.parse(id)));
      const authority = privacy.authority;
      privacy.close();
      await transaction([...STORES], "readwrite", undefined, async (tx) => {
        const record = await request(tx.objectStore("authority").get(partition)) as EpochRecord | undefined;
        if (!record) return;
        await revalidateRecords(tx, { ...authority, artifactIds: [] }, record.authzVersion, denied);
        tx.objectStore("authority").put({ ...record, token: IdSchema.parse(createId()) });
      });
    },
    async removePending(groupId: string): Promise<void> {
      const current = privacy.capture();
      await transaction(["authority", "pending"], "readwrite", current, async (tx) => {
        await verify(tx, current);
        const store = tx.objectStore("pending");
        const key = [partition, IdSchema.parse(groupId)];
        const record = await request(store.get(key)) as Stored<unknown> | undefined;
        if (record) {
          privacy.assert(current, PendingCommandSchema.parse(record.value).group.commands.map((command) => command.artifactId));
          if (record.authzVersion !== current.authority.authzVersion) throw new PrivacyBoundaryError();
          store.delete(key);
        }
      });
    },
    async acknowledge(input: PendingCommand): Promise<void> {
      const value = PendingCommandSchema.parse(input);
      const current = privacy.capture(value.group.commands.map((command) => command.artifactId));
      await transaction(["authority", "drafts", "pending"], "readwrite", current, async (tx) => {
        await verify(tx, current);
        tx.objectStore("pending").delete([partition, value.group.commandGroupId]);
        const drafts = tx.objectStore("drafts");
        for (const [artifactId, generation] of Object.entries(value.draftGenerations)) {
          const draft = await request(drafts.get([partition, artifactId])) as Stored<LocalDraft> | undefined;
          if (draft && draft.value.generation <= generation) drafts.delete([partition, artifactId]);
        }
      });
    },
    /** Discards only the exact reviewed local snapshot; concurrent edits are preserved. */
    async discardReviewed(drafts: LocalDraft[], pending: PendingCommand[]): Promise<void> {
      const checkedDrafts = drafts.map((draft) => LocalDraftSchema.parse(draft));
      const checkedPending = pending.map((record) => PendingCommandSchema.parse(record));
      const current = privacy.capture([...checkedDrafts.map((draft) => draft.artifactId), ...checkedPending.flatMap((record) => record.group.commands.map((command) => command.artifactId))]);
      await transaction(["authority", "drafts", "pending"], "readwrite", current, async (tx) => {
        await verify(tx, current);
        for (const draft of checkedDrafts) {
          const store = tx.objectStore("drafts");
          const actual = await request(store.get([partition, draft.artifactId])) as Stored<LocalDraft> | undefined;
          if (actual && JSON.stringify(actual.value) !== JSON.stringify(draft)) throw new ArtifactStorageError("blocked");
          if (actual) store.delete([partition, draft.artifactId]);
        }
        for (const record of checkedPending) {
          const store = tx.objectStore("pending");
          const actual = await request(store.get([partition, record.group.commandGroupId])) as Stored<PendingCommand> | undefined;
          if (actual && JSON.stringify(actual.value) !== JSON.stringify(record)) throw new ArtifactStorageError("blocked");
          if (actual) store.delete([partition, record.group.commandGroupId]);
        }
      });
    },
    /** Called only after confirmed discard/signout, or immediately when access is revoked. */
    async clearPrivate(): Promise<void> {
      privacy.close();
      await transaction([...STORES], "readwrite", undefined, async (tx) => {
        await deletePartition(tx, partition);
        tx.objectStore("authority").put({ partition, token: IdSchema.parse(createId()), authzVersion: -1, nextSequence: 0 });
      });
    },
    async clearUserPrivate(): Promise<void> {
      privacy.close();
      await transaction([...STORES], "readwrite", undefined, async (tx) => {
        const store = tx.objectStore("authority");
        const records = await request(store.getAll()) as EpochRecord[];
        for (const record of records) {
          if (!record.partition.startsWith(`${lease.authority.userId}/`)) continue;
          await deletePartition(tx, record.partition);
          store.put({ partition: record.partition, token: IdSchema.parse(createId()), authzVersion: -1, nextSequence: 0 });
        }
      });
    },
    close() { if (!closed) { closed = true; database.close(); } },
  };
}

export type ArtifactCache = Awaited<ReturnType<typeof openArtifactCache>>;
