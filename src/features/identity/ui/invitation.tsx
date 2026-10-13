"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, LogIn, RefreshCw, UserCheck } from "lucide-react";
import { Button, LoadingState } from "@/ui";
import { useLocale } from "@/i18n/provider";
import { formatInstant } from "@/i18n/format";
import { InvitationTokenSchema, type IdentityUser, type InvitationPreview, type WorkspaceMembership } from "../contracts";
import { authHref, IdentityFrame, OperationError, SuccessNotice } from "./common";
import { AuthDialog } from "./credentials";
import { SignOutDialog } from "./account-menu";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { asIdentityFailure, identityClient } from "./transport";
import { PersonIdentity, ScopeList, useIdentityWriteIntent } from "./team-controls";
import { roleLabels } from "./team-state";
import styles from "./identity.module.css";

function InvitationContent({ token, user, onSignIn, onSwitchAccount }: { token: string; user: IdentityUser; onSignIn: () => void; onSwitchAccount: () => void }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const account = useIdentityAccount();
  const preview = useIdentityOperation<InvitationPreview>();
  const accept = useIdentityOperation<{ workspace: WorkspaceMembership }>();
  const intent = useIdentityWriteIntent();
  const { run, cancel } = preview;
  const userId = user.id;
  const valid = InvitationTokenSchema.safeParse(token).success;
  const returnTo = `/settings/invitations/${token}`;
  const load = useCallback(() => {
    cancel();
    return run((signal) => identityClient.invitation(token, { signal, expectedUserId: userId }));
  }, [cancel, run, token, userId]);
  useEffect(() => { if (valid && user.emailVerified) void load(); return cancel; }, [valid, user.emailVerified, load, cancel]);
  async function join() {
    const result = await accept.run(async (signal) => {
      try {
        const key = await intent.keyFor({ userId, action: "accept-invitation", token }, signal);
        return await identityClient.acceptInvitation(token, key, { signal, expectedUserId: userId });
      } catch (error) {
        if (!signal.aborted && asIdentityFailure(error).status === 401) onSignIn();
        if (!signal.aborted && asIdentityFailure(error).status === 409) void account.refresh().catch(() => undefined);
        throw error;
      }
    });
    if (result) void account.refresh().catch(() => undefined);
  }
  if (accept.result) return <div className={styles.stack}>
    <SuccessNotice><p><strong>{t("identity.invitation.acceptedTitle")}</strong></p><p>{t("identity.invitation.acceptedDescription", { workspace: accept.result.workspace.name })}</p></SuccessNotice>
    <Link href={`/settings/team?workspace=${accept.result.workspace.workspaceId}`} className={styles.textLink}>{t("identity.invitation.openTeam")}<ArrowRight aria-hidden="true" size={18} /></Link>
  </div>;
  const unavailable = !valid || preview.failure?.status === 404 || accept.failure?.status === 404;
  return <div className={styles.stack}>
    <div><p className={styles.meta}>{t("identity.workspace.currentAccount")}</p><PersonIdentity name={user.name} email={user.email} /></div>
    {!user.emailVerified ? <><p>{t("identity.invitation.verify")}</p><Link href={authHref("/auth/verify", { returnTo })} className={styles.textLink}>{t("identity.verification.resend")}</Link></> : unavailable ? <><p role="alert">{t("identity.invitation.unavailable")}</p><p className={styles.muted}>{t("identity.invitation.requestAnother")}</p></> : <>
      {preview.pending && <LoadingState label={t("identity.invitation.loading")} />}
      <OperationError failure={preview.failure} />
      {preview.failure?.status === 401 ? <Button icon={LogIn} onClick={onSignIn}>{t("identity.navigation.signIn")}</Button> : preview.failure && <Button icon={RefreshCw} onClick={() => { void load(); }}>{t("identity.invitation.retry")}</Button>}
      {preview.result && <>
        <h2 className={styles.invitationWorkspace}>{preview.result.workspaceName}</h2>
        <dl className={styles.facts}><dt>{t("identity.invitation.invitationRole")}</dt><dd>{t(roleLabels[preview.result.role])}</dd><dt>{t("identity.invitation.expires")}</dt><dd><time dateTime={preview.result.expiresAt}>{formatInstant(locale, preview.result.expiresAt)}</time></dd></dl>
        <div><h3 className={styles.minorHeading}>{t("identity.access.permissions")}</h3><ScopeList scopes={preview.result.scopes} /></div>
        <OperationError failure={accept.failure?.status === 401 ? undefined : accept.failure} />
        <Button icon={UserCheck} variant="primary" pending={accept.pending} onClick={() => { void join(); }}>{t(accept.pending ? "identity.invitation.accepting" : "identity.invitation.accept")}</Button>
      </>}
    </>}
    <Button variant="quiet" icon={LogIn} disabled={accept.pending} onClick={onSwitchAccount}>{t("identity.workspace.changeAccount")}</Button>
  </div>;
}

export function InvitePage({ token }: { token: string }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  if (!InvitationTokenSchema.safeParse(token).success) return <IdentityFrame title={t("identity.invitation.title")}><div className={styles.stack}><p role="alert">{t("identity.invitation.unavailable")}</p><p className={styles.muted}>{t("identity.invitation.requestAnother")}</p><Link href="/" className={styles.textLink}>{t("identity.navigation.home")}</Link></div></IdentityFrame>;
  return <IdentityFrame title={t("identity.invitation.title")}>
    {!account.ready ? <LoadingState label={t("identity.invitation.loading")} /> : account.viewer ? <InvitationContent key={`${token}:${account.viewer.user.id}:${authVersion}`} token={token} user={account.viewer.user} onSignIn={() => setAuthOpen(true)} onSwitchAccount={() => setSignOutOpen(true)} /> : <div className={styles.stack}><p>{t("identity.invitation.signIn")}</p><Button icon={LogIn} variant="primary" onClick={() => setAuthOpen(true)}>{t("identity.navigation.signIn")}</Button></div>}
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={`/settings/invitations/${token}`} onAuthenticated={() => { setAuthOpen(false); setAuthVersion((value) => value + 1); }} />
    <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} onSignedOut={() => setAuthOpen(true)} />
  </IdentityFrame>;
}
