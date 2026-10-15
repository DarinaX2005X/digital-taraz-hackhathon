import { z } from 'zod';
import type { CommandGroupInput } from '@/contracts/commands';
import { DependencyEdgeSchema } from '@/contracts/dependency-edges';
import { SourceRefSchema } from '@/contracts/artifacts';
import { IdSchema, LocaleSchema } from '@/contracts/primitives';
import { ArtifactCommandRequestSchema, ArtifactHistoryActionSchema, ArtifactSnapshotSchema, CommandReceiptSchema, type ArtifactHistoryGroup, type ArtifactSnapshot, type CommandReceipt } from '@/features/artifacts/contracts';
import { createArtifactClient } from '@/features/artifacts/client/transport';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { collectSourceRefs } from '@/features/artifacts/domain/content-state';
import { inverseInputs, type ReversibleOperation } from '@/features/artifacts/domain/operations';
import { locateTarget } from '@/features/artifacts/domain/targets';
import { artifactDraft, buildDependencyProposal, commandsForProposal, type DependencyArtifact } from '@/features/dependencies/domain/proposal';
import { type DemoSeed } from './sample';

const SeedSchema = z.strictObject({ locale: LocaleSchema, snapshots: z.array(ArtifactSnapshotSchema).length(2), edges: z.array(DependencyEdgeSchema).max(20), tableId: IdSchema, documentId: IdSchema, priceTargetId: z.string(), sourceRef: SourceRefSchema });
interface StoredGroup { receipt: CommandReceipt; inverse: Record<string, ReversibleOperation[]>; active: boolean; lastInverse?: Record<string, ReversibleOperation[]>; lastRevisions?: Record<string, number> }
interface DemoState { seed: DemoSeed; snapshots: ArtifactSnapshot[]; versions: ArtifactSnapshot[]; groups: StoredGroup[]; receipts: Record<string, { hash: string; receipt: CommandReceipt }> }
const StateSchema = z.strictObject({ seed: SeedSchema, snapshots: z.array(ArtifactSnapshotSchema).length(2), versions: z.array(ArtifactSnapshotSchema).max(100), groups: z.array(z.strictObject({ receipt: CommandReceiptSchema, inverse: z.record(IdSchema, z.array(z.json()).max(1000)), active: z.boolean(), lastInverse: z.record(IdSchema, z.array(z.json()).max(1000)).optional(), lastRevisions: z.record(IdSchema, z.number().int().nonnegative()).optional() })).max(50), receipts: z.record(IdSchema, z.strictObject({ hash: z.string(), receipt: CommandReceiptSchema })) });
export function demoArtifact(snapshot: ArtifactSnapshot): DependencyArtifact { return { id: snapshot.artifact.id, title: snapshot.artifact.title, revision: snapshot.artifact.currentRevision, content: snapshot.content, sourceRefs: snapshot.artifact.sourceRefs, bindings: snapshot.artifact.bindings, locks: snapshot.locks, missingTargets: snapshot.missingTargets }; }
const clone = <T>(value: T): T => structuredClone(value);
export class DemoConflict extends Error {}
/** Isolated adapter for the real editors. No network, account rows or provider calls. */
export function createDemoStore(seed: DemoSeed, options: { saved?: string | null; persist?: (serialized: string) => void } = {}) {
  let state: DemoState = { seed: SeedSchema.parse(seed), snapshots: clone(seed.snapshots), versions: clone(seed.snapshots), groups: [], receipts: {} };
  if (options.saved) {
    if (options.saved.length > 4 * 1024 * 1024) throw new Error('demo-storage-too-large');
    const saved = StateSchema.parse(JSON.parse(options.saved)) as unknown as DemoState;
    const ids = new Set([saved.seed.tableId, saved.seed.documentId]), viewer = saved.seed.snapshots[0]!.viewer;
    if (saved.seed.locale !== seed.locale || saved.snapshots.some((snapshot) => !ids.has(snapshot.artifact.id) || snapshot.viewer.userId !== viewer.userId || snapshot.viewer.workspaceId !== viewer.workspaceId)) throw new Error('demo-storage-invalid');
    for (const snapshot of saved.snapshots) artifactDraft(demoArtifact(snapshot));
    state = saved;
  }
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(action: () => Promise<T>) => { const run = queue.then(action); queue = run.catch(() => undefined); return run; };
  const viewer = () => state.snapshots[0]!.viewer;
  function snapshot(id: string): ArtifactSnapshot {
    const value = state.snapshots.find((item) => item.artifact.id === id);
    if (!value) throw new DemoConflict('sample-artifact-missing');
    return clone({ ...value, history: history(id) });
  }
  function history(id: string): ArtifactHistoryGroup[] {
    return state.groups.filter((group) => group.receipt.artifacts.some((artifact) => artifact.artifactId === id)).slice(-50).reverse().map((group) => {
      const current = group.receipt.historyGroup.artifacts.map((artifact) => ({ ...artifact, currentRevision: state.snapshots.find((item) => item.artifact.id === artifact.artifactId)!.artifact.currentRevision }));
      const latest = group.lastRevisions ?? group.receipt.committedRevisionVector;
      const eligible = !!latest && current.every((artifact) => latest[artifact.artifactId] === artifact.currentRevision);
      return { ...group.receipt.historyGroup, state: group.active ? 'active' : 'undone', artifacts: current, canUndo: group.active && eligible, canRedo: !group.active && eligible, expectedSourceRevisions: { [state.seed.sourceRef.sourceId]: 1 } };
    });
  }
  function commit(next: DemoState) {
    next.groups = next.groups.slice(-50); next.versions = next.versions.slice(-100);
    const receiptEntries = Object.entries(next.receipts).slice(-100); next.receipts = Object.fromEntries(receiptEntries);
    const serialized = JSON.stringify(next);
    if (serialized.length > 4 * 1024 * 1024) throw new Error('demo-storage-too-large');
    options.persist?.(serialized); state = next;
  }
  async function apply(group: CommandGroupInput, origin: 'human' | 'import' = 'human', historyAction?: { action: 'undo' | 'redo'; targetId: string; inverse: Record<string, ReversibleOperation[]> }): Promise<CommandReceipt> {
    const body = ArtifactCommandRequestSchema.parse({ workspaceId: viewer().workspaceId, expectedAuthzVersion: viewer().authzVersion, group });
    const requestHash = hashJson({ body, origin, action: historyAction?.action ?? 'apply', targetId: historyAction?.targetId ?? null } as unknown as JsonValue);
    const replay = state.receipts[group.commandGroupId];
    if (replay) { if (replay.hash !== requestHash) throw new DemoConflict('sample-operation-conflict'); return clone(replay.receipt); }
    const next = clone(state), at = group.metadataAt ?? new Date().toISOString(), inverse: Record<string, ReversibleOperation[]> = {}, changed: ArtifactSnapshot[] = [];
    for (const command of body.group.commands) {
      const previous = snapshot(command.artifactId);
      if (previous.artifact.currentRevision !== command.baseRevision) throw new DemoConflict('sample-revision-conflict');
      if (Object.entries(command.expectedSourceRevisions).some(([id, revision]) => id !== state.seed.sourceRef.sourceId || revision !== 1)) throw new DemoConflict('sample-source-conflict');
      const draft = artifactDraft(demoArtifact(previous));
      const applied = await draft.apply(command.operations, { actorId: viewer().userId, at, reason: command.reason, origin: historyAction ? 'history' : origin }, historyAction?.inverse[command.artifactId]);
      const content = await draft.state(), revision = previous.artifact.currentRevision + 1, contentRef = { id: crypto.randomUUID(), hash: draft.root };
      inverse[command.artifactId] = applied.inverse;
      changed.push(ArtifactSnapshotSchema.parse({ ...previous, artifact: { ...previous.artifact, contentRef, currentRevision: revision, updatedAt: at, sourceRefs: collectSourceRefs(content), bindings: Object.values(content.bindings) }, content: content.content, locks: content.locks, missingTargets: [...new Set([...Object.values(content.bindings).map((binding) => binding.targetElementId), ...Object.keys(content.locks)])].filter((id) => !locateTarget(content.index, id)), version: { ...previous.version, id: crypto.randomUUID(), revision, parentRevision: previous.artifact.currentRevision, contentRef, snapshotHash: hashJson(content as unknown as JsonValue), reason: command.reason, createdAt: at }, cursor: String(Number(previous.cursor) + 1) }));
    }
    const revisions = Object.fromEntries(changed.map((item) => [item.artifact.id, item.artifact.currentRevision]));
    const receipt = CommandReceiptSchema.parse({ commandGroupId: group.commandGroupId, committedRevisionVector: revisions, artifacts: changed.map((item) => ({ artifactId: item.artifact.id, revision: item.artifact.currentRevision, versionId: item.version.id, contentRef: item.artifact.contentRef })), cursor: String(state.groups.length + 1), historyGroup: { commandGroupId: group.commandGroupId, actorId: viewer().userId, reason: body.group.commands[0]!.reason, origin, createdAt: at, state: 'active', committedRevisionVector: revisions, artifacts: changed.map((item) => ({ artifactId: item.artifact.id, title: item.artifact.title, kind: item.content.kind, committedRevision: item.artifact.currentRevision, currentRevision: item.artifact.currentRevision })), hasUnavailableArtifacts: false, canUndo: !historyAction, canRedo: false, expectedSourceRevisions: { [state.seed.sourceRef.sourceId]: 1 }, ...(historyAction ? historyAction.action === 'undo' ? { undoesGroupId: historyAction.targetId } : { redoesGroupId: historyAction.targetId } : {}) } });
    next.snapshots = next.snapshots.map((item) => changed.find((updated) => updated.artifact.id === item.artifact.id) ?? item); next.versions.push(...changed);
    if (historyAction) {
      const original = next.groups.find((item) => item.receipt.commandGroupId === historyAction.targetId)!;
      original.active = historyAction.action === 'redo'; original.lastInverse = inverse; original.lastRevisions = revisions;
      if (historyAction.action === 'undo') original.receipt.historyGroup.undoneByGroupId = receipt.commandGroupId;
      else { original.inverse = inverse; delete original.receipt.historyGroup.undoneByGroupId; }
    } else next.groups.push({ receipt: clone(receipt), inverse, active: true });
    next.receipts[group.commandGroupId] = { hash: requestHash, receipt }; commit(next); return clone(receipt);
  }
  async function historyAction(action: 'undo' | 'redo', raw: unknown) {
    const input = ArtifactHistoryActionSchema.parse(raw), original = state.groups.find((item) => item.receipt.commandGroupId === input.targetCommandGroupId);
    if (!original) throw new DemoConflict('sample-history-missing');
    const replay = state.receipts[input.commandGroupId]; if (replay) return clone(replay.receipt);
    if (original.active !== (action === 'undo')) throw new DemoConflict('sample-history-conflict');
    const inverse = action === 'undo' ? original.inverse : original.lastInverse!;
    const commands = Object.entries(inverse).map(([artifactId, operations]) => { const current = snapshot(artifactId); return { commandId: crypto.randomUUID(), artifactId, baseRevision: input.expectedArtifactRevisions[artifactId]!, kind: current.content.kind, operations: inverseInputs(operations), expectedSourceRevisions: input.expectedSourceRevisions, reason: `${action}: ${original.receipt.historyGroup.reason}` }; });
    return apply({ commandGroupId: input.commandGroupId, expectedArtifactRevisions: input.expectedArtifactRevisions, expectedSourceRevisions: input.expectedSourceRevisions, commands }, 'human', { action, targetId: input.targetCommandGroupId, inverse });
  }
  async function prepare() { return buildDependencyProposal({ edges: state.seed.edges, artifacts: state.snapshots.map(demoArtifact), facts: [], graphRevision: 1, expectedSourceRevisions: { [state.seed.sourceRef.sourceId]: 1 }, actorId: viewer().userId, at: new Date().toISOString() }); }
  const localFetch: typeof fetch = async (input, init) => serialize(async () => {
    const url = new URL(String(input), 'https://sample.invalid'), parts = url.pathname.split('/').filter(Boolean), id = parts[2], body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (new Headers(init?.headers).get('X-Tirlik-User-Id') !== viewer().userId) throw new DemoConflict('sample-actor-conflict');
      if (parts[1] === 'workspace-events') return response({ workspaceId: viewer().workspaceId, cursor: String(state.groups.length), events: [], hasMore: false, resetRequired: false });
      if (parts[1] !== 'artifacts') return response({ code: 'NOT_FOUND', messageKey: 'artifacts.errors.notFound', retryable: false, requestId: crypto.randomUUID() }, 404);
      if (id === 'access') return response({ viewer: viewer(), authorizedArtifactIds: body.artifactIds.filter((value: string) => state.snapshots.some((item) => item.artifact.id === value)), editableArtifactIds: body.artifactIds.filter((value: string) => state.snapshots.some((item) => item.artifact.id === value)), unavailableArtifactIds: body.artifactIds.filter((value: string) => !state.snapshots.some((item) => item.artifact.id === value)) });
      if (id === 'commands') return response(await apply(ArtifactCommandRequestSchema.parse(body).group));
      if (id === 'history' && ['undo', 'redo'].includes(parts[3]!)) return response(await historyAction(parts[3] as 'undo' | 'redo', body));
      if (!id) throw new DemoConflict('sample-route-missing');
      const current = snapshot(id);
      if (parts[3] === 'history') return response({ viewer: viewer(), artifactId: id, groups: history(id), cursor: current.cursor });
      if (parts[3] === 'versions') {
        if (parts[4]) { const old = state.versions.find((item) => item.artifact.id === id && item.artifact.currentRevision === Number(parts[4])); if (!old) throw new DemoConflict('sample-version-missing'); return response({ viewer: viewer(), artifact: old.artifact, version: old.version, content: old.content, sourceFreshness: old.sourceFreshness, locks: old.locks, missingTargets: old.missingTargets, headRevision: current.artifact.currentRevision }); }
        return response({ viewer: viewer(), artifactId: id, versions: state.versions.filter((item) => item.artifact.id === id).slice(-30).reverse().map((item) => item.version), nextBeforeRevision: null });
      }
      return response(current);
    } catch (error) { return response({ code: error instanceof DemoConflict ? 'CONFLICT' : 'VALIDATION_FAILED', messageKey: 'artifacts.errors.conflict', retryable: false, requestId: crypto.randomUUID() }, error instanceof DemoConflict ? 409 : 400); }
  });
  return { client: createArtifactClient({ fetch: localFetch }), get seed() { return state.seed; }, snapshot, prepare, apply: (group: CommandGroupInput, origin: 'human' | 'import' = 'human') => serialize(() => apply(group, origin)),
    accept: (proposal: Awaited<ReturnType<typeof prepare>>, groups: string[]) => serialize(async () => {
      const current = await buildDependencyProposal({ edges: state.seed.edges, artifacts: state.snapshots.map(demoArtifact), facts: [], graphRevision: 1, expectedSourceRevisions: { [state.seed.sourceRef.sourceId]: 1 }, actorId: viewer().userId, at: proposal.preparedAt });
      if (hashJson(current as unknown as JsonValue) !== hashJson(proposal as unknown as JsonValue)) throw new DemoConflict('sample-proposal-stale');
      return apply(commandsForProposal(proposal, state.snapshots.map(demoArtifact), groups, { groupId: crypto.randomUUID(), makeId: () => crypto.randomUUID() }, 'Update linked sample values'), 'import');
    }), serialize: () => JSON.stringify(state) };
}
export type DemoStore = ReturnType<typeof createDemoStore>;
