import { ArtifactHistorySchema, type ArtifactHistory, type ArtifactHistoryGroup } from "../contracts";
import { ArtifactOperationSchema, type ArtifactOperation } from "./operations";

export function historyActionEligible(group: ArtifactHistoryGroup, action: "undo" | "redo") {
  return !group.hasUnavailableArtifacts && group.expectedSourceRevisions !== undefined && (action === "undo" ? group.canUndo : group.canRedo);
}

/** Call only with a freshly authorized history response, never the offline history cache. */
export function prepareHistoryOperation(input: ArtifactHistory, targetId: string, action: "undo" | "redo", options: { createId?: () => string; now?: () => string } = {}): ArtifactOperation {
  const history = ArtifactHistorySchema.parse(input);
  const group = history.groups.find((entry) => entry.commandGroupId === targetId);
  if (!group || !historyActionEligible(group, action)) throw new Error("artifacts.history.locked");
  const operationId = options.createId?.() ?? crypto.randomUUID();
  return ArtifactOperationSchema.parse({
    operationId, artifactId: history.artifactId, kind: action, state: "ready", createdAt: options.now?.() ?? new Date().toISOString(),
    body: { workspaceId: history.viewer.workspaceId, expectedAuthzVersion: history.viewer.authzVersion, commandGroupId: operationId, targetCommandGroupId: group.commandGroupId, expectedArtifactRevisions: Object.fromEntries(group.artifacts.map((artifact) => [artifact.artifactId, artifact.currentRevision])), expectedSourceRevisions: group.expectedSourceRevisions },
  });
}
