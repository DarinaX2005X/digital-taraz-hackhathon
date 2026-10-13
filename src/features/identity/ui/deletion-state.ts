import type { AccountDeletionPreview, DeleteAccount } from "../contracts";
import type { IdentityMessageKey } from "../locales";

export type DeletionDraft = { action: "" | "leave" | "transfer" | "delete"; targetUserId: string; confirmationName: string };
export type DeletionDrafts = Record<string, DeletionDraft>;
export const emptyDeletionDraft = (): DeletionDraft => ({ action: "", targetUserId: "", confirmationName: "" });

export function reconcileDeletionDrafts(preview: AccountDeletionPreview, previous: DeletionDrafts): DeletionDrafts {
  return Object.fromEntries(preview.ownedWorkspaces.map((workspace) => {
    const before = previous[workspace.workspaceId] ?? emptyDeletionDraft();
    const action = before.action === "leave" && !workspace.canLeave ? "" : before.action;
    const targetUserId = workspace.transferCandidates.some((member) => member.userId === before.targetUserId) ? before.targetUserId : "";
    return [workspace.workspaceId, { ...before, action, targetUserId }];
  }));
}

export function validateDeletionChoices(preview: AccountDeletionPreview, drafts: DeletionDrafts): { choices: DeleteAccount["workspaces"]; errors: Record<string, IdentityMessageKey> } {
  const choices: DeleteAccount["workspaces"] = [];
  const errors: Record<string, IdentityMessageKey> = {};
  for (const workspace of preview.ownedWorkspaces) {
    const draft = drafts[workspace.workspaceId];
    const base = { workspaceId: workspace.workspaceId, expectedAuthzVersion: workspace.authzVersion };
    if (!draft?.action || (draft.action === "leave" && !workspace.canLeave)) errors[workspace.workspaceId] = "identity.deletion.decisionRequired";
    else if (draft.action === "leave") choices.push({ ...base, action: "leave" });
    else if (draft.action === "transfer") {
      if (!workspace.transferCandidates.some((candidate) => candidate.userId === draft.targetUserId)) errors[workspace.workspaceId] = "identity.deletion.successorRequired";
      else choices.push({ ...base, action: "transfer", targetUserId: draft.targetUserId });
    } else if (draft.action === "delete") {
      if (draft.confirmationName.trim() !== workspace.name) errors[workspace.workspaceId] = "identity.deletion.workspaceNameMismatch";
      else choices.push({ ...base, action: "delete", confirmationName: draft.confirmationName.trim() });
    } else errors[workspace.workspaceId] = "identity.deletion.decisionRequired";
  }
  return { choices, errors };
}

