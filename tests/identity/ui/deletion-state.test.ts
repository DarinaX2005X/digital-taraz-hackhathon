import { describe, expect, it } from "vitest";
import type { AccountDeletionPreview } from "@/features/identity/contracts";
import { emptyDeletionDraft, reconcileDeletionDrafts, validateDeletionChoices } from "@/features/identity/ui/deletion-state";

const workspaceId = "74df4f59-668e-45a0-af48-b6a745c96882";
const secondId = "9749ba35-cfd0-48b4-bef5-a4176ff60d4b";
const successorId = "9a5ed07a-353e-44fd-bc75-051d765eb8b5";
const preview: AccountDeletionPreview = { ownedWorkspaces: [{ workspaceId, name: "Тірлік дүкені", authzVersion: 17, memberCount: 2, canLeave: false, transferCandidates: [{ userId: successorId, name: "Member", email: "member@example.test" }] }], otherWorkspaceCount: 1, retentionDays: 30 };

describe("account-deletion ownership decisions", () => {
  it("requires an explicit choice for every owned workspace", () => {
    const result = validateDeletionChoices(preview, {});
    expect(result.choices).toEqual([]);
    expect(result.errors).toEqual({ [workspaceId]: "identity.deletion.decisionRequired" });
    expect(reconcileDeletionDrafts(preview, {})).toEqual({ [workspaceId]: emptyDeletionDraft() });
  });
  it("does not let the last owner silently leave", () => {
    expect(validateDeletionChoices(preview, { [workspaceId]: { ...emptyDeletionDraft(), action: "leave" } }).errors[workspaceId]).toBe("identity.deletion.decisionRequired");
  });
  it("accepts leaving only when the server explicitly permits it", () => {
    const result = validateDeletionChoices({ ...preview, ownedWorkspaces: [{ ...preview.ownedWorkspaces[0]!, canLeave: true }] }, { [workspaceId]: { ...emptyDeletionDraft(), action: "leave" } });
    expect(result.errors).toEqual({});
    expect(result.choices).toEqual([{ action: "leave", workspaceId, expectedAuthzVersion: 17 }]);
  });
  it("requires a concrete eligible account id, never arbitrary display text", () => {
    for (const targetUserId of ["", "Member", "member@example.test", secondId]) expect(validateDeletionChoices(preview, { [workspaceId]: { ...emptyDeletionDraft(), action: "transfer", targetUserId } }).errors[workspaceId]).toBe("identity.deletion.successorRequired");
    expect(validateDeletionChoices(preview, { [workspaceId]: { ...emptyDeletionDraft(), action: "transfer", targetUserId: successorId } }).choices).toEqual([{ action: "transfer", workspaceId, expectedAuthzVersion: 17, targetUserId: successorId }]);
  });
  it("requires the exact case-sensitive workspace name before destructive selection", () => {
    for (const confirmationName of ["", "delete", "тірлік дүкені"]) expect(validateDeletionChoices(preview, { [workspaceId]: { ...emptyDeletionDraft(), action: "delete", confirmationName } }).errors[workspaceId]).toBe("identity.deletion.workspaceNameMismatch");
    expect(validateDeletionChoices(preview, { [workspaceId]: { ...emptyDeletionDraft(), action: "delete", confirmationName: " Тірлік дүкені " } }).choices).toEqual([{ action: "delete", workspaceId, expectedAuthzVersion: 17, confirmationName: "Тірлік дүкені" }]);
  });
  it("reconciles a refreshed preview without selecting destructive defaults", () => {
    const refreshed = { ...preview, ownedWorkspaces: [{ ...preview.ownedWorkspaces[0]!, authzVersion: 18, transferCandidates: [] }, { ...preview.ownedWorkspaces[0]!, workspaceId: secondId, name: "Second" }] };
    const drafts = reconcileDeletionDrafts(refreshed, { [workspaceId]: { ...emptyDeletionDraft(), action: "transfer", targetUserId: successorId }, missing: { ...emptyDeletionDraft(), action: "delete" } });
    expect(drafts).toEqual({ [workspaceId]: { action: "transfer", targetUserId: "", confirmationName: "" }, [secondId]: emptyDeletionDraft() });
    expect(Object.keys(validateDeletionChoices(refreshed, drafts).errors)).toHaveLength(2);
  });
  it("invalidates a previously permitted leave choice after ownership changes", () => {
    expect(reconcileDeletionDrafts(preview, { [workspaceId]: { ...emptyDeletionDraft(), action: "leave" } })[workspaceId]?.action).toBe("");
  });
  it("does not include stale or foreign workspace choices in the request", () => {
    const result = validateDeletionChoices({ ...preview, ownedWorkspaces: [] }, { [workspaceId]: { ...emptyDeletionDraft(), action: "delete", confirmationName: "Тірлік дүкені" } });
    expect(result).toEqual({ choices: [], errors: {} });
  });
  it("uses the workspace security revision, never a cached actor membership revision", () => {
    const refreshed = { ...preview, ownedWorkspaces: [{ ...preview.ownedWorkspaces[0]!, authzVersion: 19 }] };
    expect(validateDeletionChoices(refreshed, { [workspaceId]: { ...emptyDeletionDraft(), action: "transfer", targetUserId: successorId } }).choices[0]?.expectedAuthzVersion).toBe(19);
  });
});
