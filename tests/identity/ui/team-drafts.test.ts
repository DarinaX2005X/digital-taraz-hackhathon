import { describe, expect, it } from "vitest";
import { INVITATION_TTL_SECONDS, type TeamResult } from "@/features/identity/contracts";
import { createTeamDrafts } from "@/features/identity/ui/team-drafts";

const workspaceId = "c21ddce0-8a6d-4877-b04f-541f55b78fa2";
const memberId = "e05249af-70de-4c74-948d-9e01c88a06c3";
const team: TeamResult = {
  workspace: { id: workspaceId, name: "Synthetic workspace", authzVersion: 5, createdAt: "2026-10-14T10:00:00.000Z" },
  actorMembership: { workspaceId, name: "Synthetic workspace", role: "owner", scopes: ["read", "edit", "manage-members"], authzVersion: 5 },
  members: [{ userId: memberId, name: "Synthetic member", email: "member@example.test", role: "reviewer", scopes: ["read"], joinedAt: "2026-10-14T10:00:00.000Z", allowedActions: { update: true, revoke: true, transfer: true, roles: ["reviewer", "editor"], scopes: ["read", "edit"] } }],
  invitations: [],
  allowedActions: { invite: true, deleteWorkspace: true, roles: ["reviewer", "editor"], scopes: ["read", "edit"], invitationTtlSeconds: INVITATION_TTL_SECONDS },
};

describe("account-owned in-memory team drafts", () => {
  it("keeps only editable input, selection and the original security revision across a private-tree remount", () => {
    const drafts = createTeamDrafts(workspaceId);
    drafts.update({ createOpen: true, workspaceName: "Entered name" });
    drafts.startAction(workspaceId, { kind: "invite" }, team);
    const draft = drafts.getAction(workspaceId)!;
    draft.update({ email: "invitee@example.test", grant: { role: "reviewer", scopes: ["read"] } });
    drafts.discardConfirmations();
    expect(drafts.getSnapshot()).toEqual({ selectedId: workspaceId, createOpen: true, workspaceName: "Entered name" });
    expect(drafts.getAction(workspaceId)).toBe(draft);
    expect(draft.getSnapshot()).toMatchObject({ email: "invitee@example.test", grant: { role: "reviewer", scopes: ["read"] }, revision: 5 });
    expect(draft.getSnapshot()).not.toHaveProperty("team");
    expect(draft.getSnapshot()).not.toHaveProperty("password");
    expect(draft.getSnapshot()).not.toHaveProperty("review");
  });

  it("keeps the payload-bound idempotency intent for an explicitly retried same-user draft", async () => {
    const drafts = createTeamDrafts(workspaceId);
    drafts.startAction(workspaceId, { kind: "invite" }, team);
    const before = drafts.getAction(workspaceId)!;
    const body = { userId: memberId, workspaceId, email: "invitee@example.test", revision: 5 };
    const key = await before.intent.keyFor(body);
    drafts.discardConfirmations();
    expect(await drafts.getAction(workspaceId)!.intent.keyFor(body)).toBe(key);
    expect(await drafts.getAction(workspaceId)!.intent.keyFor({ ...body, revision: 6 })).not.toBe(key);
  });

  it("drops destructive target confirmations on authentication loss", () => {
    const drafts = createTeamDrafts(workspaceId);
    drafts.startAction(workspaceId, { kind: "transfer", userId: memberId }, team);
    drafts.discardConfirmations();
    expect(drafts.getAction(workspaceId)).toBeUndefined();
  });

  it("drops all input and old write intent on owner discard", async () => {
    const drafts = createTeamDrafts(workspaceId);
    drafts.update({ createOpen: true, workspaceName: "Private draft" });
    drafts.startAction(workspaceId, { kind: "edit", userId: memberId }, team);
    const key = await drafts.workspaceIntent.keyFor({ name: "Private draft" });
    drafts.discard();
    expect(drafts.getSnapshot()).toEqual({ selectedId: undefined, createOpen: false, workspaceName: "" });
    expect(drafts.getAction(workspaceId)).toBeUndefined();
    expect(await drafts.workspaceIntent.keyFor({ name: "Private draft" })).not.toBe(key);
  });

  it("does not mutate the fetched grant when a retained draft is edited", () => {
    const drafts = createTeamDrafts(workspaceId);
    drafts.startAction(workspaceId, { kind: "edit", userId: memberId }, team);
    const draft = drafts.getAction(workspaceId)!;
    draft.update({ grant: { role: "editor", scopes: ["read", "edit"] } });
    expect(draft.getSnapshot().initialGrant).toEqual({ role: "reviewer", scopes: ["read"] });
    expect(team.members[0]!.scopes).toEqual(["read"]);
  });
});
