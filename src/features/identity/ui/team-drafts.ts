import type { TeamResult } from "../contracts";
import { defaultGrant, type Grant } from "./team-state";
import { createIdentityWriteIntent } from "./write-intent";

export type TeamAction = { kind: "invite" } | { kind: "edit" | "revoke-member" | "transfer"; userId: string } | { kind: "resend" | "revoke-invite"; invitationId: string };
type TeamActionDraftSnapshot = {
  action: TeamAction;
  email: string;
  initialGrant: Grant | undefined;
  grant: Grant | undefined;
  revision: number;
};

export function createTeamActionDraft(action: TeamAction, team: TeamResult) {
  const member = "userId" in action ? team.members.find((item) => item.userId === action.userId) : undefined;
  const options = action.kind === "edit" && member ? member.allowedActions : team.allowedActions;
  const initialGrant: Grant | undefined = member ? { role: member.role, scopes: [...member.scopes] } : defaultGrant(options);
  let snapshot: TeamActionDraftSnapshot = { action, email: "", initialGrant, grant: initialGrant ? { role: initialGrant.role, scopes: [...initialGrant.scopes] } : undefined, revision: team.workspace.authzVersion };
  return {
    getSnapshot: () => snapshot,
    update(patch: Partial<Pick<TeamActionDraftSnapshot, "email" | "grant" | "revision">>) { snapshot = { ...snapshot, ...patch }; },
    intent: createIdentityWriteIntent(),
  };
}

export type TeamActionDraft = ReturnType<typeof createTeamActionDraft>;

export function createTeamDrafts(selectedId?: string) {
  let snapshot = { selectedId: selectedId as string | null | undefined, createOpen: false, workspaceName: "" };
  const workspaceIntent = createIdentityWriteIntent();
  const actions = new Map<string, TeamActionDraft>();
  function clearAction(workspaceId: string) { actions.get(workspaceId)?.intent.clear(); actions.delete(workspaceId); }
  return {
    getSnapshot: () => snapshot,
    update(patch: Partial<typeof snapshot>) { snapshot = { ...snapshot, ...patch }; },
    workspaceIntent,
    getAction: (workspaceId: string) => actions.get(workspaceId),
    startAction(workspaceId: string, action: TeamAction, team: TeamResult) { clearAction(workspaceId); actions.set(workspaceId, createTeamActionDraft(action, team)); },
    clearAction,
    discard() {
      snapshot = { selectedId: undefined, createOpen: false, workspaceName: "" };
      workspaceIntent.clear();
      for (const workspaceId of actions.keys()) clearAction(workspaceId);
    },
    discardConfirmations() {
      for (const [workspaceId, draft] of actions) {
        const { action } = draft.getSnapshot();
        if (action.kind !== "invite" && action.kind !== "edit") clearAction(workspaceId);
      }
    },
  };
}

export type TeamDrafts = ReturnType<typeof createTeamDrafts>;
