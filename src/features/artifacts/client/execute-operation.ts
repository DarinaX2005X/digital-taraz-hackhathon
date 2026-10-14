import type { z } from "zod";
import type { ArtifactPurgeResultSchema, ArtifactMutationResult, CommandReceipt } from "../contracts";
import type { ArtifactOperation } from "./operations";
import type { PrivacyLease } from "./privacy";
import type { ArtifactClient, ArtifactRequestOptions } from "./transport";

export type ArtifactOperationResult = ArtifactMutationResult | CommandReceipt | z.infer<typeof ArtifactPurgeResultSchema>;
export function executeArtifactOperation(client: ArtifactClient, operation: ArtifactOperation, lease: PrivacyLease, replay: boolean): Promise<ArtifactOperationResult> {
  const opts: ArtifactRequestOptions = { viewer: { userId: lease.authority.userId, workspaceId: lease.authority.workspaceId, authzVersion: lease.authority.authzVersion }, signal: lease.signal, ...(replay ? { replayExpectedAuthzVersion: operation.body.expectedAuthzVersion } : {}) };
  switch (operation.kind) {
    case "undo": case "redo": return client.historyAction(operation.kind, operation.body, opts);
    case "rename": return client.rename(operation.artifactId, operation.body, operation.operationId, opts);
    case "move": return client.move(operation.artifactId, operation.body, operation.operationId, opts);
    case "archive": return client.archive(operation.artifactId, operation.body, operation.operationId, opts);
    case "trash": return client.trash(operation.artifactId, operation.body, operation.operationId, opts);
    case "restore": return client.restore(operation.artifactId, operation.body, operation.operationId, opts);
    case "duplicate": return client.duplicate(operation.artifactId, operation.body, operation.operationId, opts, operation.expectedKind);
    case "branch": return client.branch(operation.artifactId, operation.body, operation.operationId, opts, operation.expectedKind);
    case "restore-version": return client.restoreVersion(operation.artifactId, operation.body, operation.operationId, opts);
    case "purge": return client.purge(operation.artifactId, operation.body, operation.operationId, opts);
  }
}
