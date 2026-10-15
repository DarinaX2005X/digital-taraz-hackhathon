import { FieldBindingSchema, fieldBindingIdentity, fieldBindingProperty, type FieldBinding, type SourceRef } from '../../../contracts/artifacts';
import { dependencyTargetProperty } from '../../../contracts/dependency-edges';
import { z } from 'zod';
import type { CommandGroupInput } from '../../../contracts/commands';
import type { MaterialValue } from '../../../contracts/materials';
import type { DependencyChange, DependencyEdge, DependencyProposal } from '../../../contracts/dependencies';
import type { ArtifactContent, JsonValue } from '../../artifacts/domain/content-models';
import { ContentValidationError, hashJson } from '../../artifacts/domain/canonical';
import { createArtifactState, collectSourceRefs, TargetLocksSchema } from '../../artifacts/domain/content-state';
import { MerkleJson } from '../../artifacts/domain/merkle-json';
import { ArtifactDraft, TargetConflictError, type ArtifactOperation } from '../../artifacts/domain/operations';
import type { ArtifactState, TargetLock } from '../../artifacts/domain/targets';
import { locateTarget, targetPropertyValue, targetValue } from '../../artifacts/domain/targets';
import { compileDependencies, dependencyKey, targetKey } from './graph';
import { exactScalarEqual, formatMaterialValue, replaceTargetScalar, targetScalar, transformValue, type DependencyScalar } from './transforms';

/** The same pure input is used by private work and the isolated public example. */
export interface DependencyArtifact {
  id: string; title: string; revision: number; content: ArtifactContent;
  sourceRefs: SourceRef[]; bindings: FieldBinding[]; locks?: Record<string, TargetLock>; missingTargets?: string[];
}
export interface DependencyFact {
  key: string; state: 'current' | 'missing' | 'unknown';
  value?: DependencyScalar; sourceRef?: SourceRef; materialValue?: MaterialValue;
}
export interface ProposalInput {
  edges: readonly DependencyEdge[]; artifacts: readonly DependencyArtifact[]; facts: readonly DependencyFact[];
  graphRevision: number; expectedSourceRevisions: Record<string, number>; actorId: string; at: string;
}
export function artifactDraft(input: DependencyArtifact): ArtifactDraft {
  const graph = new MerkleJson();
  const state = createArtifactState(input.content, input.sourceRefs);
  const missing = new Set(input.missingTargets ?? []);
  const bindings = z.array(FieldBindingSchema).max(10000).parse(input.bindings), locks = TargetLocksSchema.parse(input.locks ?? {});
  if (new Set(bindings.map(fieldBindingIdentity)).size !== bindings.length) throw new ContentValidationError('duplicate-binding-target');
  const refs = new Set(input.sourceRefs.map((ref) => hashJson(ref as JsonValue)));
  for (const binding of bindings) {
    const locator = locateTarget(state.index, binding.targetElementId);
    if (!locator && !missing.has(binding.targetElementId)) throw new ContentValidationError('missing-binding-target');
    if (locator && binding.targetProperty) targetPropertyValue(locator.kind, targetValue(state.content, locator), fieldBindingProperty(binding));
    if (!refs.has(hashJson(binding.sourceRef as JsonValue))) throw new ContentValidationError('binding-source-not-declared');
  }
  for (const id of Object.keys(locks)) if (!locateTarget(state.index, id) && !missing.has(id)) throw new ContentValidationError('missing-lock-target');
  for (const id of missing) if (locateTarget(state.index, id)) throw new ContentValidationError('invalid-missing-target');
  const bindingRefs = new Set(bindings.map((binding) => hashJson(binding.sourceRef as JsonValue)));
  state.sourceRefs = state.sourceRefs.filter((ref) => !bindingRefs.has(hashJson(ref as JsonValue)));
  state.bindings = Object.fromEntries(bindings.map((binding) => [fieldBindingIdentity(binding), binding]));
  state.locks = locks;
  state.retiredTargets = Object.fromEntries([...missing].map((id) => [id, true as const]));
  return new ArtifactDraft(graph, graph.encode(state as unknown as JsonValue));
}
export async function proposalPreview(input: ProposalInput): Promise<{ proposal: DependencyProposal; states: Map<string, ArtifactState> }> {
  const graph = compileDependencies(input.edges), artifacts = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const drafts = new Map(input.artifacts.map((artifact) => [artifact.id, artifactDraft(artifact)]));
  const facts = new Map(input.facts.map((fact) => [fact.key, fact])), blocked = new Set<string>(), changes: DependencyChange[] = [];
  for (const edge of graph.ordered) {
    const artifact = artifacts.get(edge.target.artifactId), draft = drafts.get(edge.target.artifactId);
    const targetProperty = dependencyTargetProperty(edge.target);
    const target = await draft?.target(edge.target.targetElementId, targetProperty);
    const change: DependencyChange = {
      edgeId: edge.id, groupId: graph.groupByEdge.get(edge.id)!, target: edge.target,
      title: artifact?.title ?? '', label: edge.label, state: 'unchanged', before: target?.value ?? null,
      beforeHash: target?.hash ?? null, reason: edge.label, operations: [], sourceRefs: [],
    };
    const fail = (state: DependencyChange['state']) => { change.state = state; blocked.add(targetKey(edge.target)); changes.push(change); };
    if (!draft || !target) { fail('missing-target'); continue; }
    const sourceInputs = edge.inputs.flatMap(({ ref }) => ref.kind === 'source' ? [dependencyKey(ref)] : []);
    if (sourceInputs.length && (!target.binding || !sourceInputs.includes(dependencyKey({ kind: 'source', sourceRef: target.binding.sourceRef })))) {
      // A detached/rebound source field cannot be revived by a stale graph edge.
      change.state = 'manual'; changes.push(change); continue;
    }
    const values = new Map<string, DependencyScalar>(), provenance = new Map<string, SourceRef>();
    let unavailable: DependencyChange['state'] | undefined;
    try {
      for (const entry of edge.inputs) {
        const key = dependencyKey(entry.ref);
        if (blocked.has(key)) { unavailable = 'upstream-blocked'; break; }
        if (entry.ref.kind === 'source') {
          const fact = facts.get(key);
          if (!fact || fact.state !== 'current' || fact.value === undefined || !fact.sourceRef) { unavailable = 'missing-input'; break; }
          values.set(entry.key, edge.transform.kind === 'material-format' && fact.materialValue ? formatMaterialValue(fact.materialValue, edge.transform.locale) : fact.value); provenance.set(dependencyKey({ kind: 'source', sourceRef: fact.sourceRef }), fact.sourceRef);
        } else {
          const upstream = await drafts.get(entry.ref.artifactId)?.target(entry.ref.targetElementId, dependencyTargetProperty(entry.ref));
          if (!upstream) { unavailable = 'missing-input'; break; }
          values.set(entry.key, targetScalar(upstream));
          if (upstream.binding) provenance.set(dependencyKey({ kind: 'source', sourceRef: upstream.binding.sourceRef }), upstream.binding.sourceRef);
        }
      }
      if (unavailable) { fail(unavailable); continue; }
      let next = replaceTargetScalar(target, transformValue(edge.transform, values));
      if (target.kind === 'table-cell' && targetProperty === 'value' && typeof target.value !== 'object' && typeof next !== 'object' && exactScalarEqual(target.value, next)) next = target.value;
      const binding = target.binding;
      const boundKey = binding && dependencyKey({ kind: 'source', sourceRef: binding.sourceRef });
      const newRef = boundKey ? facts.get(boundKey)?.sourceRef ?? provenance.get(boundKey) : undefined;
      const bindingChanged = !!binding && !!newRef && hashJson(binding.sourceRef as JsonValue) !== hashJson(newRef as JsonValue);
      change.after = next; change.sourceRefs = [...provenance.values()];
      const valueChanged = hashJson(target.value) !== hashJson(next);
      if (!valueChanged && !bindingChanged) { changes.push(change); continue; }
      if (binding?.override) { change.state = 'overridden'; changes.push(change); continue; }
      if (edge.updateMode === 'manual' || binding?.updateMode === 'manual') { change.state = 'manual'; changes.push(change); continue; }
      const root = draft.root;
      try {
        if (valueChanged) {
          const operation: ArtifactOperation = { targetId: target.targetId, targetProperty, op: 'set', value: next, beforeHash: target.hash };
          await draft.apply([operation], { actorId: input.actorId, at: input.at, origin: 'import', reason: edge.label });
          change.operations.push(operation);
        }
        if (bindingChanged) {
          const current = (await draft.target(target.targetId, targetProperty))!;
          const operation: ArtifactOperation = { targetId: target.targetId, targetProperty, op: 'bind', beforeHash: current.hash, value: { sourceRef: newRef!, transformId: binding!.transformId, updateMode: binding!.updateMode, ...(targetProperty === 'value' ? {} : { targetProperty }) } as unknown as JsonValue };
          await draft.apply([operation], { actorId: input.actorId, at: input.at, origin: 'import', reason: edge.label });
          change.operations.push(operation);
        }
        change.state = 'ready'; changes.push(change);
      } catch (error) {
        draft.root = root; change.operations = [];
        if (error instanceof TargetConflictError && error.reason === 'locked') fail('locked');
        else throw error;
      }
    } catch (error) {
      if (!(error instanceof ContentValidationError)) throw error;
      fail('invalid-input');
    }
  }
  return {
    proposal: { preparedAt: input.at, graphRevision: input.graphRevision, expectedArtifactRevisions: Object.fromEntries(input.artifacts.map((artifact) => [artifact.id, artifact.revision])), expectedSourceRevisions: input.expectedSourceRevisions, sourceRefs: [...new Map([...input.artifacts.flatMap((artifact) => artifact.sourceRefs), ...input.edges.flatMap((edge) => edge.inputs.flatMap(({ ref }) => ref.kind === 'source' ? [ref.sourceRef] : [])), ...input.facts.flatMap((fact) => fact.sourceRef ? [fact.sourceRef] : [])].map((ref) => [hashJson(ref as JsonValue), ref])).values()], changes },
    states: new Map(await Promise.all([...drafts].map(async ([id, draft]) => [id, await draft.state()] as const))),
  };
}
export async function buildDependencyProposal(input: ProposalInput): Promise<DependencyProposal> { return (await proposalPreview(input)).proposal; }

const blockingStates = new Set<DependencyChange['state']>(['locked', 'missing-input', 'missing-target', 'invalid-input', 'upstream-blocked']);
export function selectableGroups(proposal: DependencyProposal): string[] {
  const ready = new Set(proposal.changes.filter((change) => change.state === 'ready').map((change) => change.groupId));
  for (const change of proposal.changes) if (blockingStates.has(change.state)) ready.delete(change.groupId);
  return [...ready];
}
export function commandsForProposal(proposal: DependencyProposal, artifacts: readonly DependencyArtifact[], selectedGroupIds: readonly string[], ids: { groupId: string; changesetId?: string; makeId: () => string }, reason: string): CommandGroupInput {
  const allowed = new Set(selectableGroups(proposal)), selected = new Set(selectedGroupIds);
  if (!selected.size || selected.size !== selectedGroupIds.length || [...selected].some((id) => !allowed.has(id))) throw new ContentValidationError('dependency-selection-not-closed');
  const changes = proposal.changes.filter((change) => change.state === 'ready' && selected.has(change.groupId));
  const byArtifact = new Map<string, ArtifactOperation[]>();
  for (const change of changes) byArtifact.set(change.target.artifactId, [...byArtifact.get(change.target.artifactId) ?? [], ...change.operations]);
  const known = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const usedSourceIds = new Set<string>();
  for (const artifactId of byArtifact.keys()) for (const ref of known.get(artifactId)?.sourceRefs ?? []) usedSourceIds.add(ref.sourceId);
  for (const change of changes) for (const operation of change.operations) if (operation.op === 'bind') usedSourceIds.add((operation.value as unknown as { sourceRef: SourceRef }).sourceRef.sourceId);
  const vector = Object.fromEntries([...usedSourceIds].map((id) => {
    if (proposal.expectedSourceRevisions[id] === undefined) throw new ContentValidationError('dependency-source-vector-missing');
    return [id, proposal.expectedSourceRevisions[id]!];
  }));
  return {
    commandGroupId: ids.groupId, metadataAt: proposal.preparedAt, ...(ids.changesetId ? { changesetId: ids.changesetId } : {}),
    expectedArtifactRevisions: Object.fromEntries([...byArtifact.keys()].map((id) => [id, proposal.expectedArtifactRevisions[id]!])),
    expectedSourceRevisions: vector,
    commands: [...byArtifact].map(([artifactId, operations]) => {
      const artifact = known.get(artifactId); if (!artifact) throw new ContentValidationError('dependency-artifact-missing');
      return { commandId: ids.makeId(), artifactId, kind: artifact.content.kind, baseRevision: artifact.revision, operations, expectedSourceRevisions: vector, reason };
    }),
  };
}
export function proposalSourceRefs(input: readonly DependencyArtifact[], proposal: DependencyProposal): SourceRef[] {
  const refs = input.flatMap((artifact) => [...artifact.sourceRefs, ...artifact.bindings.map((binding) => binding.sourceRef)]);
  for (const change of proposal.changes) for (const operation of change.operations) if (operation.op === 'bind') refs.push((operation.value as unknown as { sourceRef: SourceRef }).sourceRef);
  return [...new Map(refs.map((ref) => [hashJson(ref as JsonValue), ref])).values()];
}
export function fromState(artifact: DependencyArtifact, state: ArtifactState, revision = artifact.revision): DependencyArtifact {
  return { ...artifact, revision, content: state.content, sourceRefs: collectSourceRefs(state), bindings: Object.values(state.bindings), locks: state.locks };
}
