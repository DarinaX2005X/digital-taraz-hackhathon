"use client";

import * as Ariakit from "@ariakit/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, KeyRound, Languages, LogOut, UserRound, Users } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Dialog, DialogClose, IconButton } from "@/ui";
import type { IdentityMutationResult, IdentityViewer } from "../contracts";
import { OperationError } from "./common";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { asIdentityFailure, identityClient } from "./transport";
import styles from "./identity.module.css";
import { AuthDialog } from "./credentials";
import { accountAuthDestination } from "./navigation";
import { clearPrivateTabDrafts } from './private-tab-drafts';

export function SignOutDialog({ open, onOpenChange, beforeSignOut, onSignedOut }: { open: boolean; onOpenChange: (open: boolean) => void; beforeSignOut?: () => Promise<boolean>; onSignedOut?: () => void }) {
  const t = useIdentityTranslations();
  const router = useRouter();
  const account = useIdentityAccount();
  const operation = useIdentityOperation<IdentityMutationResult | null>();
  const cancel = useRef<HTMLButtonElement>(null);
  async function signOut() {
    const userId = account.viewer?.user.id;
    const authEpoch = account.authEpoch;
    const result = await operation.run(async (signal) => {
      if (beforeSignOut && !await beforeSignOut()) return null;
      if (signal.aborted || !userId || !account.isCurrent(userId, authEpoch)) return null;
      try { return await identityClient.signOut({ signal, expectedUserId: userId }); }
      catch (error) {
        if (!signal.aborted && asIdentityFailure(error).status === 401) return { status: "signed-out" };
        throw error;
      }
    });
    if (!result || !userId || !account.isCurrent(userId, authEpoch)) return;
    try { clearPrivateTabDrafts(sessionStorage, userId); } catch { /* Browsers may deny tab storage; the account state is still masked. */ }
    account.invalidate(userId, authEpoch);
    onOpenChange(false);
    if (onSignedOut) onSignedOut();
    else { router.replace("/sign-in"); router.refresh(); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!operation.pending) { operation.clear(); onOpenChange(next); } }} title={t("identity.sessions.signOutTitle")} description={t("identity.sessions.signOutDescription")} initialFocus={cancel} footer={<><DialogClose ref={cancel} disabled={operation.pending}>{t("identity.sessions.cancel")}</DialogClose><Button icon={LogOut} variant="danger" pending={operation.pending} pendingLabel={t("identity.sessions.signingOut")} onClick={() => { void signOut(); }}>{t("identity.navigation.signOut")}</Button></>}><div className={styles.stack}>{account.viewer && <div className={styles.person}><strong>{account.viewer.user.name}</strong><span>{account.viewer.user.email}</span></div>}<OperationError failure={operation.failure} /></div></Dialog>;
}

type AccountMenuProps = { beforeSignOut?: () => Promise<boolean>; onSignedOut?: () => void };

function AuthenticatedAccountMenu({ viewer, beforeSignOut, onSignedOut }: AccountMenuProps & { viewer: IdentityViewer }) {
  const t = useIdentityTranslations();
  const [signOutOpen, setSignOutOpen] = useState(false);
  return <>
    <Ariakit.MenuProvider>
      <Ariakit.MenuButton render={<IconButton icon={UserRound} label={`${t("identity.navigation.account")}: ${viewer.user.name}`} />} />
      <Ariakit.Menu className={styles.menu} gutter={8} portal>
        <div className={styles.menuIdentity}><p>{viewer.user.name}</p><p>{viewer.user.email}</p></div>
        <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/app/work" />}><BriefcaseBusiness aria-hidden="true" size={18} />{t("identity.navigation.home")}</Ariakit.MenuItem>
        <Ariakit.MenuSeparator className={styles.menuSeparator} />
        <Ariakit.MenuGroup aria-label={t("identity.navigation.settings")}>
          <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/settings#profile" />}><UserRound aria-hidden="true" size={18} />{t("identity.navigation.profile")}</Ariakit.MenuItem>
          <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/settings#security" />}><KeyRound aria-hidden="true" size={18} />{t("identity.navigation.security")}</Ariakit.MenuItem>
          <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/settings#language" />}><Languages aria-hidden="true" size={18} />{t("identity.navigation.language")}</Ariakit.MenuItem>
        </Ariakit.MenuGroup>
        <Ariakit.MenuSeparator className={styles.menuSeparator} />
        <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/settings/team" />}><Users aria-hidden="true" size={18} />{t("identity.team.manage")}</Ariakit.MenuItem>
        <Ariakit.MenuSeparator className={styles.menuSeparator} />
        <Ariakit.MenuItem className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => setSignOutOpen(true)}><LogOut aria-hidden="true" size={18} />{t("identity.navigation.signOut")}</Ariakit.MenuItem>
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
    <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} beforeSignOut={beforeSignOut} onSignedOut={onSignedOut} />
  </>;
}

export function AccountMenu(props: AccountMenuProps) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const router = useRouter();
  const [auth, setAuth] = useState<{ returnTo: string; stay: boolean }>();
  if (!account.viewer || auth) return <>
    <Button variant="quiet" onClick={() => {
      setAuth(accountAuthDestination(window.location.pathname, window.location.search));
    }}>{t("identity.navigation.signIn")}</Button>
    <AuthDialog open={Boolean(auth)} returnTo={auth?.returnTo} onOpenChange={(open) => { if (!open) setAuth(undefined); }} onAuthenticated={(target) => { if (!auth?.stay) router.push(target); }} />
  </>;
  return <AuthenticatedAccountMenu key={`${account.viewer.user.id}:${account.authEpoch}`} viewer={account.viewer} {...props} />;
}
