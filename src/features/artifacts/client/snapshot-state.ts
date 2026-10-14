import { ArtifactSnapshotSchema, type ArtifactSnapshot } from '../contracts';
import { ContentValidationError, hashJson } from '../domain/canonical';
import { createArtifactState } from '../domain/content-state';
import type { JsonValue } from '../domain/content-models';
import { uniqueIds } from '../domain/semantic-validation';
import { locateTarget, type ArtifactState } from '../domain/targets';

/** Editor projection for checked operations, not a replacement for server history. */
export function createEditorArtifactState(input: ArtifactSnapshot): ArtifactState {
  const snapshot = ArtifactSnapshotSchema.parse(input);
  const { sourceRefs, bindings } = snapshot.artifact;
  const locks = snapshot.locks ?? {};
  const state = createArtifactState(snapshot.content, sourceRefs);
  const missing = new Set(snapshot.missingTargets ?? []);
  uniqueIds(bindings.map((binding) => binding.targetElementId), 'duplicate-binding-target');
  uniqueIds(snapshot.missingTargets ?? [], 'duplicate-missing-target');
  const refs = new Set(sourceRefs.map((ref) => hashJson(ref as JsonValue)));
  for (const id of missing) if (locateTarget(state.index, id)) throw new ContentValidationError('missing-target-is-present');
  for (const binding of bindings) {
    if (!locateTarget(state.index, binding.targetElementId) && !missing.has(binding.targetElementId)) throw new ContentValidationError('missing-binding-target');
    if (!refs.has(hashJson(binding.sourceRef as JsonValue))) throw new ContentValidationError('binding-source-not-declared');
  }
  for (const id of Object.keys(locks)) if (!locateTarget(state.index, id) && !missing.has(id)) throw new ContentValidationError('missing-lock-target');
  const bindingRefs = new Set(bindings.map((binding) => hashJson(binding.sourceRef as JsonValue)));
  state.sourceRefs = sourceRefs.filter((ref) => !bindingRefs.has(hashJson(ref as JsonValue)));
  state.bindings = Object.fromEntries(bindings.map((binding) => [binding.targetElementId, binding]));
  state.locks = locks;
  // Only metadata-bearing missing IDs are exposed. New nodes still require fresh IDs;
  // the server checks its complete retired-ID history when applying the command.
  state.retiredTargets = Object.fromEntries([...missing].map((id) => [id, true as const]));
  return state;
}
