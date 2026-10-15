"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { KeyRound, Languages, LogIn, LogOut, Monitor, RefreshCw, Save, Smartphone, Trash2, UserRound, Users } from "lucide-react";
import { Button, Dialog, DialogClose, IconButton, InputField, LoadingState, LocaleSelect, ProductHeader } from "@/ui";
import { useLocale } from "@/i18n/provider";
import { TourSettings } from '@/features/onboarding/tour';
import { tourCopy } from '@/features/onboarding/copy';
import { formatInstant } from "@/i18n/format";
import type { AccountDeletionResult, IdentityMutationResult, IdentitySession, IdentityUser, IdentityViewer } from "../contracts";
import { authHref, OperationError, PasswordField, PrivateSessionState, SuccessNotice } from "./common";
import { AuthDialog } from "./credentials";
import { useIdentityGuard, useIdentityOperation, useIdentityTranslations, usePrivateIdentityAccess } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { AccountMenu, SignOutDialog } from "./account-menu";
import { AccountDeletedResult, AccountDeletionSection } from "./account-deletion";
import { identityClient } from "./transport";
import { useIdentityNavigationGuard } from "./navigation-guard";
import { settingsViewFromHash, type SettingsView } from "./settings-state";
import { focusFirstError, hasErrors, passwordVariables, validateName, validatePassword, type FormErrors } from "./validation";
import styles from "./identity.module.css";

type AuthGuard = <T>(signal: AbortSignal, action: () => Promise<T>) => Promise<T>;
type ProfileDraft = { name: string; savedName: string };

const viewItems = [
  { view: "profile", label: "identity.navigation.profile", icon: UserRound },
  { view: "language", label: "identity.navigation.language", icon: Languages },
  { view: "security", label: "identity.navigation.security", icon: KeyRound },
  { view: "sessions", label: "identity.navigation.sessions", icon: Monitor },
] as const;

function subscribeToView(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => { window.removeEventListener("hashchange", listener); window.removeEventListener("popstate", listener); };
}
const currentView = () => settingsViewFromHash(window.location.hash);
const initialView = (): SettingsView => "profile";

function SettingsNavigation({ view }: { view: SettingsView }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  return <nav className={styles.settingsNav} aria-label={t("identity.navigation.settings")}>
    <div className={styles.settingsNavGroup}>{viewItems.map(({ view: target, label, icon: Icon }) => <a key={target} href={`#${target}`} aria-current={view === target ? "page" : undefined}><Icon size={18} aria-hidden="true" /><span>{t(label)}</span></a>)}</div>
    <div className={styles.settingsNavGroup}><a href="#tour" aria-current={view === 'tour' ? 'page' : undefined}>{tourCopy[locale].settings}</a><Link href="/settings/team"><Users size={18} aria-hidden="true" /><span>{t("identity.team.manage")}</span></Link></div>
    <div className={styles.settingsNavGroup}><a href="#delete-account" className={styles.settingsDangerLink} aria-current={view === "delete-account" ? "page" : undefined}><Trash2 size={18} aria-hidden="true" /><span>{t("identity.deletion.title")}</span></a></div>
  </nav>;
}

function ProfileForm({ user, guard, draft, setDraft }: { user: IdentityUser; guard: AuthGuard; draft: ProfileDraft; setDraft: Dispatch<SetStateAction<ProfileDraft>> }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const { name, savedName } = draft;
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
    if (result) { setDraft({ name: result.user.name, savedName: result.user.name }); account.acceptUser(result.user); }
  }
  return <form onSubmit={submit} className={styles.form} noValidate aria-busy={operation.pending || undefined}>
    <InputField ref={input} name="name" label={t("identity.fields.name")} hint={t("identity.profile.nameHint")} autoComplete="name" value={name} required readOnly={operation.pending} error={error ? t(error) : operation.failure?.fieldErrors.name ? t(operation.failure.fieldErrors.name) : undefined} onBlur={() => setError(validateName(name))} onChange={(event) => { setDraft((previous) => ({ ...previous, name: event.target.value })); setError(undefined); operation.clear(); }} />
    <InputField name="email" label={t("identity.fields.email")} value={user.email} readOnly autoComplete="username" hint={t(user.emailVerified ? "identity.profile.emailVerified" : "identity.profile.emailUnverified")} />
    {!user.emailVerified && <Link href="/auth/verify" className={styles.textLink}>{t("identity.verification.resend")}</Link>}
    <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
    {operation.result && <SuccessNotice>{t("identity.profile.saved")}</SuccessNotice>}
    <div className={styles.actions}><Button icon={Save} type="submit" variant="primary" pending={operation.pending} pendingLabel={t("identity.settings.savingProfile")} disabled={name.trim() === savedName}>{t("identity.profile.save")}</Button></div>
  </form>;
}

function ChangePasswordForm({ guard, onChanged, onDirtyChange, userId }: { guard: AuthGuard; onChanged: () => void; onDirtyChange: (dirty: boolean) => void; userId: string }) {
  const t = useIdentityTranslations();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmation: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const operation = useIdentityOperation<IdentityMutationResult>();
  const dirty = Boolean(values.currentPassword || values.newPassword || values.confirmation);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
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
    <div className={styles.actions}><Button type="submit" icon={KeyRound} variant="primary" pending={operation.pending} pendingLabel={t("identity.password.pending")}>{t("identity.password.submit")}</Button></div>
  </form>;
}

function SessionDetails({ session }: { session: IdentitySession }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const label = session.deviceLabel === "unknown" ? t("identity.sessions.unknownDevice") : t(session.deviceLabel === "mobile" ? "identity.devices.mobile" : "identity.devices.desktop");
  return <div className={styles.sessionDetails}>
    <p><strong>{label}</strong>{session.current && <span className={styles.currentSession}>{t("identity.sessions.current")}</span>}</p>
    <dl><dt>{t("identity.sessions.started")}</dt><dd><time dateTime={session.createdAt}>{formatInstant(locale, session.createdAt)}</time></dd><dt>{t("identity.sessions.lastActive")}</dt><dd><time dateTime={session.updatedAt}>{formatInstant(locale, session.updatedAt)}</time></dd></dl>
  </div>;
}

function RevokeDialog({ session, onClose, onRevoked, guard, userId }: { session: IdentitySession; onClose: () => void; onRevoked: () => void; guard: AuthGuard; userId: string }) {
  const t = useIdentityTranslations();
  const operation = useIdentityOperation<{ revoked: true }>();
  const cancel = useRef<HTMLButtonElement>(null);
  const Icon = session.deviceLabel === "mobile" ? Smartphone : Monitor;
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.pending) onClose(); }} title={t("identity.sessions.confirmTitle")} description={t("identity.sessions.confirmDescription")} initialFocus={cancel} footer={<><DialogClose ref={cancel} disabled={operation.pending}>{t("identity.sessions.cancel")}</DialogClose><Button icon={LogOut} variant="danger" pending={operation.pending} pendingLabel={t("identity.sessions.revoking")} onClick={async () => { const result = await operation.run((signal) => guard(signal, () => identityClient.revokeSession(session.id, { signal, expectedUserId: userId }))); if (result) onRevoked(); }}>{t("identity.sessions.revoke")}</Button></>}>
    <div className={styles.sessionContext}><Icon aria-hidden="true" size={22} /><SessionDetails session={session} /></div>
    <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
  </Dialog>;
}

function SessionsSection({ version, guard, onSignOut, onSignIn, userId }: { version: number; guard: AuthGuard; onSignOut: () => void; onSignIn: () => void; userId: string }) {
  const t = useIdentityTranslations();
  const operation = useIdentityOperation<{ sessions: IdentitySession[] }>();
  const [sessions, setSessions] = useState<IdentitySession[]>([]);
  const [selected, setSelected] = useState<IdentitySession>();
  const [revoked, setRevoked] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const run = operation.run;
  const cancel = operation.cancel;
  useEffect(() => {
    void run((signal) => guard(signal, () => identityClient.sessions({ signal, expectedUserId: userId }))).then((result) => { if (result) setSessions(result.sessions); });
    return cancel;
  }, [run, cancel, version, refreshVersion, userId, guard]);
  return <section className={styles.section} id="sessions" tabIndex={-1} aria-labelledby="sessions-title" aria-busy={operation.pending || undefined}>
    <div className={styles.sectionHeading}><h2 id="sessions-title">{t("identity.sessions.title")}</h2><IconButton icon={RefreshCw} label={t("identity.profile.reload")} pending={operation.pending} onClick={() => setRefreshVersion((value) => value + 1)} /></div>
    <p className={styles.muted}>{t("identity.sessions.description")}</p>
    {operation.pending && !sessions.length && <LoadingState label={t("identity.sessions.loading")} />}
    <OperationError failure={operation.failure} />
    {operation.failure && (operation.failure.status === 401 ? <Button icon={LogIn} onClick={onSignIn}>{t("identity.navigation.signIn")}</Button> : <Button icon={RefreshCw} onClick={() => setRefreshVersion((value) => value + 1)}>{t("identity.profile.retry")}</Button>)}
    {revoked && <SuccessNotice>{t("identity.sessions.revoked")}</SuccessNotice>}
    <ul className={styles.sessionList}>
      {sessions.map((session) => {
        const Icon = session.deviceLabel === "mobile" ? Smartphone : Monitor;
        return <li key={session.id} className={styles.session}>
          <Icon aria-hidden="true" size={22} />
          <SessionDetails session={session} />
          {session.current ? <Button variant="quiet" icon={LogOut} onClick={onSignOut}>{t("identity.navigation.signOut")}</Button> : <Button variant="quiet" icon={LogOut} onClick={() => { setSelected(session); setRevoked(false); }}>{t("identity.sessions.revoke")}</Button>}
        </li>;
      })}
    </ul>
    {operation.result && sessions.every((session) => session.current) && <p className={styles.muted}>{t("identity.sessions.empty")}</p>}
    {selected && <RevokeDialog session={selected} guard={guard} userId={userId} onClose={() => setSelected(undefined)} onRevoked={() => { setSessions((previous) => previous.filter((session) => session.id !== selected.id)); setSelected(undefined); setRevoked(true); }} />}
  </section>;
}

function SettingsContent({ viewer, onDeleted, onDirtyChange }: { viewer: IdentityViewer; onDeleted: (result: AccountDeletionResult) => void; onDirtyChange: (dirty: boolean) => void }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const [deletionUncertain, setDeletionUncertain] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({ name: viewer.user.name, savedName: viewer.user.name });
  const [passwordDirty, setPasswordDirty] = useState(false);
  const view = useSyncExternalStore(subscribeToView, currentView, initialView);
  const previousView = useRef(view);
  const access = usePrivateIdentityAccess(viewer.user.id);
  const guard = useIdentityGuard();
  const dirty = profileDraft.name.trim() !== profileDraft.savedName || (access.phase === "active" && passwordDirty);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (previousView.current !== view && access.phase === "active") document.getElementById(view)?.focus({ preventScroll: true });
    previousView.current = view;
  }, [view, access.phase]);
  if (access.phase !== "active" && signOutOpen) setSignOutOpen(false);
  return <>
    {access.phase === "active" ? <div className={styles.settingsGrid}>
      <SettingsNavigation view={view} />
      <div className={styles.settingsBody}>
        <section className={styles.section} id="profile" tabIndex={-1} hidden={view !== "profile"} aria-labelledby="profile-title"><h2 id="profile-title">{t("identity.navigation.profile")}</h2><ProfileForm user={account.viewer?.user.id === viewer.user.id ? account.viewer.user : viewer.user} guard={guard} draft={profileDraft} setDraft={setProfileDraft} /></section>
        <section className={styles.section} id="language" tabIndex={-1} hidden={view !== "language"} aria-labelledby="language-title"><h2 id="language-title">{t("identity.profile.languageTitle")}</h2><p className={styles.muted}>{t("identity.profile.languageDescription")}</p><LocaleSelect className={styles.locale} /></section>
        <section className={styles.section} id="security" tabIndex={-1} hidden={view !== "security"} aria-labelledby="security-title"><h2 id="security-title">{t("identity.password.title")}</h2><p className={styles.muted}>{t("identity.password.description")}</p><ChangePasswordForm guard={guard} userId={viewer.user.id} onDirtyChange={setPasswordDirty} onChanged={() => setSessionsVersion((value) => value + 1)} /></section>
        {view === "sessions" && <SessionsSection version={sessionsVersion} guard={guard} userId={viewer.user.id} onSignIn={() => setAuthOpen(true)} onSignOut={() => setSignOutOpen(true)} />}
        {view === 'tour' && <TourSettings ownerId={viewer.user.id} />}
        {view === "delete-account" && <AccountDeletionSection userId={viewer.user.id} guard={guard} authVersion={sessionsVersion} uncertain={deletionUncertain} onUncertainChange={setDeletionUncertain} onDeleted={onDeleted} />}
      </div>
    </div> : <div className={styles.stack}><PrivateSessionState phase={access.phase} onSignIn={() => setAuthOpen(true)} onResume={access.resume} />{deletionUncertain && <p role="alert">{t("identity.deletion.sessionUnavailable")}</p>}</div>}
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo="/settings" onAuthenticated={() => { setAuthOpen(false); setSessionsVersion((value) => value + 1); }} />
    {access.phase === "active" && <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />}
  </>;
}

export function SettingsPage({ initialViewer }: { initialViewer?: IdentityViewer }) {
  const t = useIdentityTranslations();
  const account = useIdentityAccount();
  const [viewer, setViewer] = useState(initialViewer);
  const [deleted, setDeleted] = useState<AccountDeletionResult>();
  const [dirty, setDirty] = useState(false);
  const operation = useIdentityOperation<IdentityViewer | null>();
  const navigation = useIdentityNavigationGuard(dirty, true);
  if (account.viewer && account.viewer.user.id !== viewer?.user.id) { setViewer(account.viewer); setDirty(false); }
  if (deleted) return <AccountDeletedResult result={deleted} />;
  return <div className={styles.page} onClickCapture={navigation.onClickCapture}>
    <ProductHeader wide homeLabel={t("identity.navigation.home")}><LocaleSelect compact /><AccountMenu /></ProductHeader>
    <main className={styles.settings}><div className={styles.heading}><h1>{t("identity.profile.title")}</h1><p>{t("identity.profile.description")}</p></div>
      {viewer ? <SettingsContent key={viewer.user.id} viewer={viewer} onDirtyChange={setDirty} onDeleted={(result) => { setDirty(false); setDeleted(result); setViewer(undefined); account.clear(); }} /> : !account.ready || operation.pending ? <LoadingState label={t("identity.profile.loading")} /> : <div className={styles.stack}>
        <p className={styles.muted}>{t("identity.settings.signInDescription")}</p>
        <OperationError failure={operation.failure} />
        <div className={styles.actions}><Link href={authHref("/sign-in", { returnTo: "/settings" })} className="tl-button tl-button--primary"><LogIn size={20} aria-hidden="true" />{t("identity.navigation.signIn")}</Link><Button icon={RefreshCw} onClick={() => { void operation.run(() => account.refresh()); }}>{t("identity.profile.reload")}</Button></div>
      </div>}
    </main>
    {navigation.confirmation}
  </div>;
}
