import type { CommandGroupInput } from "@/contracts/commands";
import type { CacheAuthority } from "@/features/artifacts/client/privacy";
import type { LocalDraft, PendingCommand } from "@/features/artifacts/client/local-records";
import type { ArtifactContent, CommandReceipt } from "@/features/artifacts/contracts";

export const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  otherUser: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  otherWorkspace: "44444444-4444-4444-8444-444444444444",
  artifact: "55555555-5555-4555-8555-555555555555",
  otherArtifact: "66666666-6666-4666-8666-666666666666",
  group: "77777777-7777-4777-8777-777777777777",
  command: "88888888-8888-4888-8888-888888888888",
};
export const authority = (overrides: Partial<CacheAuthority> = {}): CacheAuthority => ({ userId: ids.user, workspaceId: ids.workspace, authzVersion: 1, artifactIds: [ids.artifact], ...overrides });
export const content = (text: string): ArtifactContent => ({ kind: "document", schemaVersion: 1, document: { type: "doc", content: [{ type: "paragraph", attrs: { id: "paragraph-1" }, content: [{ type: "text", text }] }] } });
export const draft = (overrides: Partial<LocalDraft> = {}): LocalDraft => ({ artifactId: ids.artifact, baseRevision: 0, schemaVersion: 1, generation: 1, content: content("Manual wording"), updatedAt: "2026-10-14T00:00:00.000Z", ...overrides });
export const group = (overrides: Partial<CommandGroupInput> = {}): CommandGroupInput => ({ commandGroupId: ids.group, expectedArtifactRevisions: { [ids.artifact]: 0 }, expectedSourceRevisions: {}, commands: [{ commandId: ids.command, artifactId: ids.artifact, baseRevision: 0, kind: "document", operations: [{ targetId: "paragraph-1", op: "set", value: { text: "Manual wording" }, beforeHash: "a".repeat(64) }], expectedSourceRevisions: {}, reason: "Edit text" }], ...overrides });
export const pending = (overrides: Partial<PendingCommand> = {}): PendingCommand => ({ group: group(), state: "ready", createdAt: "2026-10-14T00:00:00.000Z", draftGenerations: { [ids.artifact]: 1 }, ...overrides });
export function receipt(input = group()): CommandReceipt {
  const revisions = Object.fromEntries(input.commands.map((command) => [command.artifactId, command.baseRevision + 1]));
  return {
    commandGroupId: input.commandGroupId, committedRevisionVector: revisions, cursor: "1",
    artifacts: input.commands.map((command) => ({ artifactId: command.artifactId, revision: command.baseRevision + 1, versionId: crypto.randomUUID(), contentRef: { id: crypto.randomUUID(), hash: "b".repeat(64) } })),
    historyGroup: { commandGroupId: input.commandGroupId, actorId: ids.user, reason: "Edit text", origin: "human", createdAt: "2026-10-14T00:00:00.000Z", state: "active", committedRevisionVector: revisions, artifacts: input.commands.map((command) => ({ artifactId: command.artifactId, title: "Offer", kind: command.kind, committedRevision: command.baseRevision + 1, currentRevision: command.baseRevision + 1 })), hasUnavailableArtifacts: false, canUndo: true, canRedo: false },
  };
}
