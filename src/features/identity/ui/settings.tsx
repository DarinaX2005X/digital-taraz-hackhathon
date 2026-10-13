"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, LogIn, LogOut, Monitor, RefreshCw, Save, Smartphone } from "lucide-react";
import { Button, Dialog, DialogClose, InputField, LoadingState, LocaleSelect } from "@/ui";
import { useLocale } from "@/i18n/provider";
import { formatInstant } from "@/i18n/format";
import type { AccountDeletionResult, IdentityMutationResult, IdentitySession, IdentityUser, IdentityViewer } from "../contracts";
import { authHref, OperationError, PasswordField, SuccessNotice } from "./common";
import { AuthDialog } from "./credentials";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { SignOutDialog } from "./account-menu";
import { AccountDeletedResult, AccountDeletionSection } from "./account-deletion";
import { asIdentityFailure, identityClient } from "./transport";
import { focusFirstError, hasErrors, passwordVariables, validateName, validatePassword, type FormErrors } from "./validation";
import styles from "./identity.module.css";

type AuthGuard = <T>(signal: AbortSignal, action: () => Promise<T>) => Promise<T>;

function ProfileForm({ user, guard }: { user: IdentityUser; guard: AuthGuard }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [name, setName] = useState(user.name);
  const [savedName, setSavedName] = useState(user.name);
  const [error, setError] = useState<ReturnType<typeof validateName>>();
  const input = useRef<HTMLInputElement>(null);
  const operation = useIdentityOperation<{ user: IdentityUser }>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.pending) return;
    const invalid = validateName(name);
    setError(invalid);
    if (invalid) { input.current?.focus(); return; }
    const result = await operation.run((signal) => guard(signal, () => identityClient.updateProfile({ name: name.trim() }, { signal, expectedUserId: user.id })));
    if (result) { setName(result.user.name); setSavedName(result.user.name); account.acceptUser(result.user); }
  }
  return <form onSubmit={submit} className={styles.form} noValidate aria-busy={operation.pending || undefined}>
    <InputField ref={input} name="name" label={t("identity.fields.name")} hint={t("identity.profile.nameHint")} autoComplete="name" value={name} required readOnly={operation.pending} error={error ? t(error) : operation.failure?.fieldErrors.name ? t(operation.failure.fieldErrors.name) : undefined} onBlur={() => setError(validateName(name))} onChange={(event) => { setName(event.target.value); setError(undefined); operation.clear(); }} />
    <InputField name="email" label={t("identity.fields.email")} value={user.email} readOnly autoComplete="username" hint={t(user.emailVerified ? "identity.profile.emailVerified" : "identity.profile.emailUnverified")} />
    {!user.emailVerified && <Link href="/auth/verify" className={styles.textLink}>{t("identity.verification.resend")}</Link>}
    <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
    {operation.result && <SuccessNotice>{t("identity.profile.saved")}</SuccessNotice>}
    <div className={styles.actions}><Button icon={Save} type="submit" variant="primary" pending={operation.pending} disabled={name.trim() === savedName}>{t("identity.profile.save")}</Button></div>
  </form>;
}

function ChangePasswordForm({ guard, onChanged, userId }: { guard: AuthGuard; onChanged: () => void; userId: string }) {
  const t = useIdentityTranslations();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmation: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const operation = useIdentityOperation<IdentityMutationResult>();
  const validate = (): FormErrors => ({ currentPassword: validatePassword(values.currentPassword, false), newPassword: values.newPassword && values.newPassword === values.currentPassword ? "identity.validation.differentPassword" : validatePassword(values.newPassword, true), confirmation: values.confirmation !== values.newPassword ? "identity.validation.passwordMismatch" : validatePassword(values.confirmation, true) });
  const errorText = (name: string) => { const key = errors[name] ?? operation.failure?.fieldErrors[name]; return key ? t(key, passwordVariables) : undefined; };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.pending) return;
    const invalid = validate();
    setErrors(invalid);
    if (hasErrors(invalid)) { focusFirstError(form.current, invalid); return; }
    const result = await operation.run((signal) => guard(signal, () => identityClient.changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword }, { signal, expectedUserId: userId })));
    if (result) { setValues({ currentPassword: "", newPassword: "", confirmation: "" }); onChanged(); }
  }
  return <form ref={form} onSubmit={submit} className={styles.form} noValidate aria-busy={operation.pending || undefined}>
    <fieldset disabled={operation.pending}>
      {(["currentPassword", "newPassword", "confirmation"] as const).map((name) => <PasswordField key={name} name={name} label={t(name === "confirmation" ? "identity.signUp.confirmPassword" : name === "newPassword" ? "identity.fields.newPassword" : "identity.fields.currentPassword")} autoComplete={name === "currentPassword" ? "current-password" : "new-password"} value={values[name]} required hint={name === "newPassword" ? t("identity.signUp.passwordHint", passwordVariables) : undefined} error={errorText(name)} onBlur={() => setErrors((previous) => ({ ...previous, [name]: validate()[name] }))} onChange={(event) => { setValues((previous) => ({ ...previous, [name]: event.target.value })); setErrors((previous) => ({ ...previous, [name]: undefined })); operation.clear(); }} />)}
    </fieldset>
    <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
    {operation.result && <SuccessNotice>{t("identity.password.saved")}</SuccessNotice>}
    <div className={styles.actions}><Button type="submit" icon={KeyRound} variant="primary" pending={operation.pending}>{t(operation.pending ? "identity.password.pending" : "identity.password.submit")}</Button></div>
  </form>;
}

function RevokeDialog({ session, onClose, onRevoked, guard, userId }: { session: IdentitySession; onClose: () => void; onRevoked: () => void; guard: AuthGuard; userId: string }) {
  const t = useIdentityTranslations();
  const operation = useIdentityOperation<{ revoked: true }>();
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.pending) onClose(); }} title={t("identity.sessions.confirmTitle")} description={t("identity.sessions.confirmDescription")} initialFocus={cancel} footer={<><DialogClose ref={cancel} disabled={operation.pending}>{t("identity.sessions.cancel")}</DialogClose><Button icon={LogOut} variant="danger" pending={operation.pending} onClick={async () => { const result = await operation.run((signal) => guard(signal, () => identityClient.revokeSession(session.id, { signal, expectedUserId: userId }))); if (result) onRevoked(); }}>{t(operation.pending ? "identity.sessions.revoking" : "identity.sessions.revoke")}</Button></>}>
    <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
  </Dialog>;
}

function SessionsSection({ version, guard, onSignOut, onSignIn, userId }: { version: number; guard: AuthGuard; onSignOut: () => void; onSignIn: () => void; userId: string }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const operation = useIdentityOperation<{ sessions: IdentitySession[] }>();
  const [sessions, setSessions] = useState<IdentitySession[]>([]);
  const [selected, setSelected] = useState<IdentitySession>();
  const [revoked, setRevoked] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const run = operation.run;
  const cancel = operation.cancel;
  useEffect(() => {
    void run((signal) => identityClient.sessions({ signal, expectedUserId: userId })).then((result) => { if (result) setSessions(result.sessions); });
    return cancel;
  }, [run, cancel, version, refreshVersion, userId]);
  return <section className={styles.section} id="sessions" aria-labelledby="sessions-title">
    <h2 id="sessions-title">{t("identity.sessions.title")}</h2>
    <p className={styles.muted}>{t("identity.sessions.description")}</p>
    {operation.pending && <LoadingState label={t("identity.sessions.loading")} />}
    <OperationError failure={operation.failure} />
    {operation.failure && (operation.failure.status === 401 ? <Button icon={LogIn} onClick={onSignIn}>{t("identity.navigation.signIn")}</Button> : <Button icon={RefreshCw} onClick={() => setRefreshVersion((value) => value + 1)}>{t("identity.profile.retry")}</Button>)}
    {revoked && <SuccessNotice>{t("identity.sessions.revoked")}</SuccessNotice>}
    <ul className={styles.sessionList}>
      {sessions.map((session) => {
        const Icon = session.deviceLabel === "mobile" ? Smartphone : Monitor;
        const label = session.deviceLabel === "unknown" ? t("identity.sessions.unknownDevice") : t(session.deviceLabel === "mobile" ? "identity.devices.mobile" : "identity.devices.desktop");
        return <li key={session.id} className={styles.session}>
          <Icon aria-hidden="true" size={22} />
          <div className={styles.sessionDetails}><p><strong>{label}</strong>{session.current && <> <span className={styles.muted}>({t("identity.sessions.current")})</span></>}</p><dl><dt>{t("identity.sessions.started")}</dt><dd><time dateTime={session.createdAt}>{formatInstant(locale, session.createdAt)}</time></dd><dt>{t("identity.sessions.lastActive")}</dt><dd><time dateTime={session.updatedAt}>{formatInstant(locale, session.updatedAt)}</time></dd></dl></div>
          {session.current ? <Button variant="quiet" icon={LogOut} onClick={onSignOut}>{t("identity.navigation.signOut")}</Button> : <Button variant="quiet" icon={LogOut} onClick={() => { setSelected(session); setRevoked(false); }}>{t("identity.sessions.revoke")}</Button>}
        </li>;
      })}
    </ul>
    {operation.result && sessions.every((session) => session.current) && <p className={styles.muted}>{t("identity.sessions.empty")}</p>}
    {selected && <RevokeDialog session={selected} guard={guard} userId={userId} onClose={() => setSelected(undefined)} onRevoked={() => { setSessions((previous) => previous.filter((session) => session.id !== selected.id)); setSelected(undefined); setRevoked(true); }} />}
  </section>;
}

function SettingsContent({ viewer, onDeleted }: { viewer: IdentityViewer; onDeleted: (result: AccountDeletionResult) => void }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const guard: AuthGuard = async (signal, action) => {
    try { return await action(); }
    catch (error) {
      if (!signal.aborted && asIdentityFailure(error).status === 401) setAuthOpen(true);
      if (!signal.aborted && asIdentityFailure(error).status === 409) void account.refresh().catch(() => undefined);
      throw error;
    }
  };
  return <>
    <div className={styles.settingsGrid}>
      <nav className={styles.settingsNav} aria-label={t("identity.navigation.settings")}><a href="#profile">{t("identity.navigation.profile")}</a><a href="#language">{t("identity.navigation.language")}</a><a href="#security">{t("identity.navigation.security")}</a><Link href="/settings/team">{t("identity.team.manage")}</Link></nav>
      <div className={styles.settingsBody}>
        {account.ready && !account.viewer && <div className={styles.stack}><p>{t("identity.profile.sessionExpired")}</p><Button icon={LogIn} onClick={() => setAuthOpen(true)}>{t("identity.navigation.signIn")}</Button></div>}
        <section className={styles.section} id="profile" aria-labelledby="profile-title"><h2 id="profile-title">{t("identity.navigation.profile")}</h2><ProfileForm user={account.viewer?.user.id === viewer.user.id ? account.viewer.user : viewer.user} guard={guard} /></section>
        <section className={styles.section} id="language" aria-labelledby="language-title"><h2 id="language-title">{t("identity.profile.languageTitle")}</h2><p className={styles.muted}>{t("identity.profile.languageDescription")}</p><LocaleSelect className={styles.locale} /></section>
        <section className={styles.section} id="security" aria-labelledby="security-title"><h2 id="security-title">{t("identity.password.title")}</h2><p className={styles.muted}>{t("identity.password.description")}</p><ChangePasswordForm guard={guard} userId={viewer.user.id} onChanged={() => setSessionsVersion((value) => value + 1)} /></section>
        <SessionsSection version={sessionsVersion} guard={guard} userId={viewer.user.id} onSignIn={() => setAuthOpen(true)} onSignOut={() => setSignOutOpen(true)} />
        <AccountDeletionSection userId={viewer.user.id} guard={guard} authVersion={sessionsVersion} onDeleted={onDeleted} />
      </div>
    </div>
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo="/settings" onAuthenticated={() => { setAuthOpen(false); setSessionsVersion((value) => value + 1); }} />
    <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
  </>;
}

export function SettingsPage({ initialViewer }: { initialViewer?: IdentityViewer }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [viewer, setViewer] = useState(initialViewer);
  const [deleted, setDeleted] = useState<AccountDeletionResult>();
  const operation = useIdentityOperation<IdentityViewer | null>();
  if (account.viewer && account.viewer.user.id !== viewer?.user.id) setViewer(account.viewer);
  if (deleted) return <AccountDeletedResult result={deleted} />;
  return <div className={styles.page}>
    <header className={styles.topbar}><Link href="/" className={styles.brand}><Image src="/brand/tirlik-mark.svg" width={40} height={40} alt="" /><span>Tirlik</span></Link><Link className={styles.textLink} href="/">{t("identity.navigation.home")}</Link></header>
    <main className={styles.settings}><div className={styles.heading}><h1>{t("identity.profile.title")}</h1></div>
      {viewer ? <SettingsContent key={viewer.user.id} viewer={viewer} onDeleted={(result) => { setDeleted(result); setViewer(undefined); account.clear(); }} /> : !account.ready || operation.pending ? <LoadingState label={t("identity.profile.loading")} /> : <div className={styles.stack}>
        <OperationError failure={operation.failure} />
        <Link href={authHref("/sign-in", { returnTo: "/settings" })} className={styles.textLink}>{t("identity.navigation.signIn")}</Link>
        <Button icon={RefreshCw} onClick={() => { void operation.run(() => account.refresh()); }}>{t("identity.profile.reload")}</Button>
      </div>}
    </main>
  </div>;
}
