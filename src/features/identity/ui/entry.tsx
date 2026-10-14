"use client";

import Link from "next/link";
import { LogIn, Settings, UserPlus } from "lucide-react";
import { LoadingState } from "@/ui";
import { AccountMenu } from "./account-menu";
import { IdentityFrame } from "./common";
import { useIdentityTranslations } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import styles from "./identity.module.css";

export function IdentityEntryPage() {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  return <IdentityFrame title={account.viewer ? t("identity.navigation.account") : "Tirlik"} description={account.viewer ? undefined : t("identity.entry.tagline")} headerActions={account.viewer ? <AccountMenu /> : undefined}>
    {!account.ready && <LoadingState label={t("identity.profile.loading")} />}
    {account.viewer ? <div className={styles.stack}>
      <div className={styles.identityDetails}><p className={styles.address}>{account.viewer.user.name}</p><p className={styles.muted}>{account.viewer.user.email}</p></div>
      <nav className={styles.actions} aria-label={t("identity.navigation.account")}><Link href="/settings" className="tl-button tl-button--primary"><Settings size={20} aria-hidden="true" /><span>{t("identity.navigation.settings")}</span></Link></nav>
    </div> : <nav className={styles.stack} aria-label={t("identity.navigation.account")}>
      <Link href="/sign-in" className="tl-button tl-button--primary"><LogIn size={20} aria-hidden="true" /><span>{t("identity.navigation.signIn")}</span></Link>
      <Link href="/sign-up" className="tl-button tl-button--secondary"><UserPlus size={20} aria-hidden="true" /><span>{t("identity.navigation.signUp")}</span></Link>
    </nav>}
  </IdentityFrame>;
}
