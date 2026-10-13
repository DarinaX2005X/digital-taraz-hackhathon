"use client";

import * as Ariakit from "@ariakit/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Languages, LogOut, Settings, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Dialog, DialogClose, IconButton } from "@/ui";
import type { IdentityMutationResult } from "../contracts";
import { OperationError } from "./common";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { asIdentityFailure, identityClient } from "./transport";
import styles from "./identity.module.css";

export function SignOutDialog({ open, onOpenChange, beforeSignOut, onSignedOut }: { open: boolean; onOpenChange: (open: boolean) => void; beforeSignOut?: () => Promise<boolean>; onSignedOut?: () => void }) {
  const t = useIdentityTranslations();
  const router = useRouter();
  const account = useIdentityAccount();
  const operation = useIdentityOperation<IdentityMutationResult | null>();
  const cancel = useRef<HTMLButtonElement>(null);
  async function signOut() {
    const result = await operation.run(async (signal) => {
      if (beforeSignOut && !await beforeSignOut()) return null;
      if (signal.aborted) return null;
      try { return await identityClient.signOut({ signal, expectedUserId: account.viewer?.user.id }); }
      catch (error) {
        if (!signal.aborted && asIdentityFailure(error).status === 401) return { status: "signed-out" };
        throw error;
      }
    });
    if (!result) return;
    account.clear();
    onOpenChange(false);
    if (onSignedOut) onSignedOut();
    else { router.replace("/sign-in"); router.refresh(); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!operation.pending) { operation.clear(); onOpenChange(next); } }} title={t("identity.sessions.signOutTitle")} description={t("identity.sessions.signOutDescription")} initialFocus={cancel} footer={<><DialogClose ref={cancel} disabled={operation.pending}>{t("identity.sessions.cancel")}</DialogClose><Button icon={LogOut} variant="danger" pending={operation.pending} onClick={() => { void signOut(); }}>{t(operation.pending ? "identity.sessions.signingOut" : "identity.navigation.signOut")}</Button></>}><OperationError failure={operation.failure} /></Dialog>;
}

export function AccountMenu({ beforeSignOut, onSignedOut }: { beforeSignOut?: () => Promise<boolean>; onSignedOut?: () => void }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [signOutOpen, setSignOutOpen] = useState(false);
  if (!account.viewer) return <Link href="/sign-in" className={styles.textLink}>{t("identity.navigation.signIn")}</Link>;
  return <>
    <Ariakit.MenuProvider>
      <Ariakit.MenuButton render={<IconButton icon={UserRound} label={t("identity.navigation.account")} />} />
      <Ariakit.Menu className={styles.menu} gutter={8} portal>
        <div className={styles.menuIdentity}><p>{account.viewer.user.name}</p><p>{account.viewer.user.email}</p></div>
        <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/settings#profile" />}><UserRound aria-hidden="true" size={18} />{t("identity.navigation.profile")}</Ariakit.MenuItem>
        <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/settings#security" />}><Settings aria-hidden="true" size={18} />{t("identity.navigation.security")}</Ariakit.MenuItem>
        <Ariakit.MenuItem className={styles.menuItem} render={<Link href="/settings#language" />}><Languages aria-hidden="true" size={18} />{t("identity.navigation.language")}</Ariakit.MenuItem>
        <Ariakit.MenuSeparator />
        <Ariakit.MenuItem className={styles.menuItem} onClick={() => setSignOutOpen(true)}><LogOut aria-hidden="true" size={18} />{t("identity.navigation.signOut")}</Ariakit.MenuItem>
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
    <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} beforeSignOut={beforeSignOut} onSignedOut={onSignedOut} />
  </>;
}
