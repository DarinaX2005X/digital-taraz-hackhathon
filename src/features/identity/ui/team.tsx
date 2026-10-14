"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, LogIn, Mail, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, Trash2, UserMinus, Users } from "lucide-react";
import { Button, Combobox, IconButton, InputField, LoadingState, LocaleSelect, ProductHeader } from "@/ui";
import { useLocale } from "@/i18n/provider";
import { formatInstant, formatNumber } from "@/i18n/format";
import type { IdentityViewer, TeamInvitation, TeamResult, WorkspaceMembership } from "../contracts";
import type { IdentityMessageKey } from "../locales";
import { OperationError, PrivateSessionState, SuccessNotice } from "./common";
import { AuthDialog } from "./credentials";
import { useIdentityGuard, useIdentityOperation, useIdentityTranslations, usePrivateIdentityAccess } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { AccountMenu } from "./account-menu";
import { asIdentityFailure, identityClient } from "./transport";
import { roleLabels } from "./team-state";
import { PersonIdentity, ScopeList, type IdentityAuthGuard } from "./team-controls";
import { CreateWorkspaceDialog, TeamActionDialog, type TeamAction } from "./team-dialogs";
import { createTeamDrafts, type TeamDrafts } from "./team-drafts";
import styles from "./identity.module.css";

const deliveryKeys: Record<TeamInvitation["delivery"], IdentityMessageKey> = {
  pending: "identity.invitation.deliveryPending", sending: "identity.invitation.deliverySending",
  sent: "identity.invitation.deliverySent", uncertain: "identity.invitation.deliveryUnknown",
};

function TeamWorkspace({ workspaceId, userId, guard, drafts, authVersion, onMembershipChanged, onSignIn }: { workspaceId: string; userId: string; guard: IdentityAuthGuard; drafts: TeamDrafts; authVersion: number; onMembershipChanged: () => void; onSignIn: () => void }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const { refresh: refreshAccount } = useIdentityAccount();
  const [team, setTeam] = useState<TeamResult>();
  const [action, setActionState] = useState<TeamAction | undefined>(drafts.getAction(workspaceId)?.getSnapshot().action);
  const [notice, setNotice] = useState<IdentityMessageKey>();
  const [query, setQuery] = useState("");
  const operation = useIdentityOperation<TeamResult>();
  const { run, cancel } = operation;
  const closeAction = useCallback(() => { drafts.clearAction(workspaceId); setActionState(undefined); }, [drafts, workspaceId]);
  function setAction(next: TeamAction | undefined) {
    if (!next) { closeAction(); return; }
    if (!team) return;
    drafts.startAction(workspaceId, next, team);
    setActionState(next);
  }
  const load = useCallback(() => {
    cancel();
    return run(async (signal) => {
      try { return await guard(signal, () => identityClient.team(workspaceId, { signal, expectedUserId: userId })); }
      catch (error) {
        const status = asIdentityFailure(error).status;
        if (!signal.aborted && [403, 404, 409].includes(status)) { setTeam(undefined); closeAction(); }
        if (!signal.aborted && status === 409) void refreshAccount().catch(() => undefined);
        throw error;
      }
    }).then((result) => {
      if (result) setTeam(result);
      return result;
    });
  }, [run, cancel, userId, workspaceId, refreshAccount, guard, closeAction]);
  useEffect(() => {
    void load();
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { cancel(); document.removeEventListener("visibilitychange", visible); };
  }, [load, cancel, authVersion]);
  const denied = operation.failure?.status === 403 || operation.failure?.status === 404;
  const current = denied ? undefined : team;
  const search = query.trim().normalize("NFKC").toLocaleLowerCase(locale);
  const members = current?.members.filter((member) => `${member.name} ${member.email}`.normalize("NFKC").toLocaleLowerCase(locale).includes(search)) ?? [];
  const owners = current?.members.filter((member) => member.role === "owner").length ?? 0;
  async function refreshForDialog() {
    const result = await load();
    if (!result) onMembershipChanged();
    return result;
  }
  function changed(message: IdentityMessageKey) {
    setAction(undefined); setNotice(message);
    void load(); onMembershipChanged();
  }
  return <div className={styles.stack}>
    {operation.pending && !current && <LoadingState label={t("identity.team.loading")} />}
    <OperationError failure={operation.failure} />
    {operation.failure && (operation.failure.status === 401 ? <Button icon={LogIn} onClick={onSignIn}>{t("identity.navigation.signIn")}</Button> : <Button icon={RefreshCw} onClick={() => { void load(); }}>{t("identity.workspace.refresh")}</Button>)}
    {denied && <p>{t("identity.team.noAccess")}</p>}
    {notice && <SuccessNotice>{t(notice)}</SuccessNotice>}
    {current && <>
      <section className={styles.section} aria-labelledby="team-members-title" aria-busy={operation.pending || undefined}>
        <div className={styles.sectionHeading}><h2 id="team-members-title">{t("identity.team.members")} <span className={styles.count}>{formatNumber(locale, current.members.length)}</span></h2><div className={styles.actions}><IconButton icon={RefreshCw} label={t("identity.workspace.refresh")} disabled={operation.pending} onClick={() => { void load(); }} />{current.allowedActions.invite && <Button icon={Plus} variant="primary" onClick={() => { setNotice(undefined); setAction({ kind: "invite" }); }}>{t("identity.team.invite")}</Button>}</div></div>
        <InputField name="memberSearch" autoComplete="off" type="search" label={t("identity.team.search")} value={query} onChange={(event) => setQuery(event.target.value)} className={styles.memberSearch} />
        <ul className={styles.teamList}>
          {members.map((member) => <li key={member.userId} className={styles.memberRow}>
            <PersonIdentity name={member.name} email={member.email}>{member.userId === userId && <span className={styles.meta}>{t("identity.access.self")}</span>}</PersonIdentity>
            <div className={styles.memberAccess}><span className={styles.roleLabel}>{t(roleLabels[member.role])}</span>{member.role === "owner" && owners === 1 && <span className={styles.meta}>{t("identity.access.lastOwner")}</span>}<ScopeList scopes={member.scopes} /></div>
            <div className={styles.rowActions}>
              {member.allowedActions.update && <IconButton icon={SlidersHorizontal} label={`${t("identity.access.edit")}: ${member.name}`} onClick={() => setAction({ kind: "edit", userId: member.userId })} />}
              {member.allowedActions.transfer && <IconButton icon={ShieldCheck} label={`${t("identity.team.transfer")}: ${member.name}`} onClick={() => setAction({ kind: "transfer", userId: member.userId })} />}
              {member.allowedActions.revoke && <IconButton icon={UserMinus} label={`${t("identity.team.revoke")}: ${member.name}`} onClick={() => setAction({ kind: "revoke-member", userId: member.userId })} />}
            </div>
          </li>)}
        </ul>
        {!members.length && <p className={styles.muted}>{t("identity.team.noMatches")}</p>}
        {current.members.length === 1 && !search && <p className={styles.muted}>{t("identity.team.empty")}</p>}
      </section>
      <section className={styles.section} aria-labelledby="team-invitations-title">
        <div className={styles.sectionHeading}><h2 id="team-invitations-title">{t("identity.invitation.invitations")} <span className={styles.count}>{formatNumber(locale, current.invitations.length)}</span></h2></div>
        <ul className={styles.teamList}>
          {current.invitations.map((invitation) => <li key={invitation.id} className={styles.memberRow}>
            <PersonIdentity email={invitation.email}><span className={styles.meta}>{t(invitation.status === "expired" ? "identity.invitation.expired" : "identity.invitation.pending")}</span><span className={styles.meta}>{t(deliveryKeys[invitation.delivery])}</span><span className={styles.meta}>{t("identity.invitation.expires")} <time dateTime={invitation.expiresAt}>{formatInstant(locale, invitation.expiresAt)}</time></span></PersonIdentity>
            <div className={styles.memberAccess}><span className={styles.roleLabel}>{t(roleLabels[invitation.role])}</span><ScopeList scopes={invitation.scopes} /></div>
            <div className={styles.rowActions}>{invitation.allowedActions.resend && <IconButton icon={Mail} label={`${t("identity.invitation.resend")}: ${invitation.email}`} onClick={() => setAction({ kind: "resend", invitationId: invitation.id })} />}{invitation.allowedActions.revoke && <IconButton icon={Trash2} label={`${t("identity.invitation.revoke")}: ${invitation.email}`} onClick={() => setAction({ kind: "revoke-invite", invitationId: invitation.id })} />}</div>
          </li>)}
        </ul>
        {!current.invitations.length && <p className={styles.muted}>{t(current.allowedActions.invite ? "identity.invitation.empty" : "identity.invitation.noInvitationsAccess")}</p>}
      </section>
      {action && drafts.getAction(workspaceId) && <TeamActionDialog key={JSON.stringify(action)} action={action} team={current} userId={userId} guard={guard} draft={drafts.getAction(workspaceId)!} onClose={() => setAction(undefined)} onChanged={changed} onRefresh={refreshForDialog} />}
    </>}
  </div>;
}

function TeamContent({ viewer, drafts, guard, authVersion, onSignIn }: { viewer: IdentityViewer; drafts: TeamDrafts; guard: IdentityAuthGuard; authVersion: number; onSignIn: () => void }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [workspaces, setWorkspaces] = useState(viewer.workspaces);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(drafts.getSnapshot().selectedId);
  const [createOpen, setCreateOpen] = useState(drafts.getSnapshot().createOpen);
  const operation = useIdentityOperation<{ workspaces: WorkspaceMembership[] }>();
  const { run, cancel } = operation;
  const userId = viewer.user.id;
  const chooseWorkspace = useCallback((selectedId: string | null | undefined) => { drafts.update({ selectedId }); setSelectedId(selectedId); }, [drafts]);
  function closeCreate() { drafts.update({ createOpen: false, workspaceName: "" }); drafts.workspaceIntent.clear(); setCreateOpen(false); }
  const reload = useCallback(() => {
    cancel();
    return run((signal) => guard(signal, () => identityClient.workspaces({ signal, expectedUserId: userId }))).then((result) => {
      if (result) { setWorkspaces(result.workspaces); if (drafts.getSnapshot().selectedId === undefined) chooseWorkspace(result.workspaces[0]?.workspaceId ?? null); }
    });
  }, [cancel, run, userId, guard, drafts, chooseWorkspace]);
  useEffect(() => { void reload(); return cancel; }, [reload, cancel]);
  const options = useMemo(() => workspaces.map((workspace) => ({ id: workspace.workspaceId, label: workspace.name })), [workspaces]);
  const selection = options.find((option) => option.id === selectedId) ?? null;
  return <>
    <div className={styles.workspaceBar}>
      {!!options.length && <Combobox label={t("identity.workspace.choose")} options={options} value={selection} onChange={(option) => chooseWorkspace(option?.id ?? null)} />}
      <Button icon={Plus} onClick={() => { drafts.update({ createOpen: true }); setCreateOpen(true); }}>{t("identity.workspace.create")}</Button>
    </div>
    <OperationError failure={operation.failure} />
    {operation.failure && <Button icon={RefreshCw} onClick={() => { void reload(); }}>{t("identity.workspace.refresh")}</Button>}
    {operation.pending && !workspaces.length ? <LoadingState label={t("identity.workspace.loading")} /> : !workspaces.length && !operation.failure ? <div className={styles.emptyTeam}><Users aria-hidden="true" size={32} /><p>{t("identity.workspace.empty")}</p></div> : selectedId ? <TeamWorkspace key={selectedId} workspaceId={selectedId} userId={userId} guard={guard} drafts={drafts} authVersion={authVersion} onSignIn={onSignIn} onMembershipChanged={() => { void reload(); void account.refresh().catch(() => undefined); }} /> : null}
    {createOpen && <CreateWorkspaceDialog userId={userId} guard={guard} draft={drafts} onClose={closeCreate} onCreated={(workspace) => { setWorkspaces((previous) => [...previous.filter((item) => item.workspaceId !== workspace.workspaceId), workspace]); chooseWorkspace(workspace.workspaceId); closeCreate(); void account.refresh().catch(() => undefined); }} />}
  </>;
}

function TeamSession({ viewer, initialWorkspaceId }: { viewer: IdentityViewer; initialWorkspaceId?: string }) {
  const account = useIdentityAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const [drafts] = useState(() => createTeamDrafts(initialWorkspaceId ?? viewer.workspaces[0]?.workspaceId));
  const access = usePrivateIdentityAccess(viewer.user.id);
  const guard = useIdentityGuard();
  useEffect(() => {
    if (access.phase !== "active") drafts.discardConfirmations();
    if (access.phase === "discarded") drafts.discard();
  }, [access.phase, drafts]);
  const selectedId = drafts.getSnapshot().selectedId;
  return <>
    {access.phase === "active" ? <TeamContent viewer={account.viewer?.user.id === viewer.user.id ? account.viewer : viewer} drafts={drafts} guard={guard} authVersion={authVersion} onSignIn={() => setAuthOpen(true)} /> : <PrivateSessionState phase={access.phase} onSignIn={() => setAuthOpen(true)} onResume={access.resume} />}
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={selectedId ? `/settings/team?workspace=${selectedId}` : "/settings/team"} onAuthenticated={() => { setAuthOpen(false); setAuthVersion((previous) => previous + 1); }} />
  </>;
}

export function TeamSettingsPage({ initialWorkspaceId }: { initialWorkspaceId?: string }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [viewer, setViewer] = useState<IdentityViewer>();
  const [authOpen, setAuthOpen] = useState(false);
  if (account.viewer && account.viewer.user.id !== viewer?.user.id) setViewer(account.viewer);
  return <div className={styles.page}>
    <ProductHeader homeLabel={t("identity.navigation.home")}><LocaleSelect compact /><AccountMenu /></ProductHeader>
    <main className={styles.settings}>
      <Link href="/settings" className={styles.textLink}><ArrowLeft size={18} aria-hidden="true" />{t("identity.workspace.back")}</Link>
      <div className={styles.heading}><h1>{t("identity.team.manage")}</h1></div>
      {viewer ? <TeamSession key={viewer.user.id} viewer={viewer} initialWorkspaceId={initialWorkspaceId} /> : !account.ready ? <LoadingState label={t("identity.profile.loading")} /> : <Button icon={LogIn} variant="primary" onClick={() => setAuthOpen(true)}>{t("identity.navigation.signIn")}</Button>}
    </main>
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={initialWorkspaceId ? `/settings/team?workspace=${initialWorkspaceId}` : "/settings/team"} onAuthenticated={() => setAuthOpen(false)} />
  </div>;
}
