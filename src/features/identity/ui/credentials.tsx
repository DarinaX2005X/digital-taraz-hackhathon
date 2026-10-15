"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { LogIn, Mail, UserPlus } from "lucide-react";
import { Button, Dialog, DialogClose, InputField, LocaleSelect } from "@/ui";
import { useLocale } from "@/i18n/provider";
import type { Locale } from "@/i18n";
import type { IdentityMutationResult } from "../contracts";
import { authReturnTo } from "../domain/return-to";
import { authHref, IdentityFrame, LocalMailNotice, OperationError, PasswordField, SuccessNotice, type AuthReturn } from "./common";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { useIdentityAccount, useLocalMailInbox } from "./identity-locale-provider";
import { identityClient } from "./transport";
import { focusFirstError, hasErrors, passwordVariables, validateCredentials, type FormErrors } from "./validation";
import styles from "./identity.module.css";
import { RequestEmailForm } from "./recovery";

export function VerificationPending({ email, destination = {}, onChangeEmail }: { email: string; destination?: AuthReturn; onChangeEmail?: () => void }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const operation = useIdentityOperation<IdentityMutationResult>();
  const localInbox = useLocalMailInbox();
  return <div className={styles.stack}>
    <SuccessNotice><p>{t(localInbox ? "identity.localMail.pending" : "identity.verification.pendingDescription")}</p></SuccessNotice>
    <div className={styles.identityDetails}><span className={styles.meta}>{t("identity.verification.address")}</span><p className={styles.address}>{email}</p></div>
    <OperationError failure={operation.failure} />
    <LocalMailNotice />
    {operation.result && <SuccessNotice>{t(localInbox ? "identity.localMail.resent" : "identity.verification.resent")}</SuccessNotice>}
    <Button icon={Mail} pending={operation.pending} pendingLabel={t("identity.verification.resending")} onClick={() => { void operation.run((signal) => identityClient.sendVerification({ email, locale, ...destination }, { signal })); }}>{t("identity.verification.resend")}</Button>
    {onChangeEmail && <Button variant="quiet" onClick={onChangeEmail}>{t("identity.verification.changeEmail")}</Button>}
  </div>;
}

type CredentialsProps = AuthReturn & {
  mode: "sign-in" | "sign-up";
  onAuthenticated: (returnTo: string) => void;
  onModeChange?: (mode: "sign-in" | "sign-up") => void;
  onVerificationPending?: (pending: boolean) => void;
  onRecovery?: (kind: "verify" | "reset") => void;
};

export function CredentialsForm({ mode, returnTo, intentToken, onAuthenticated, onModeChange, onVerificationPending, onRecovery }: CredentialsProps) {
  const t = useIdentityTranslations();
  const { locale, setLocale } = useLocale();
  const account = useIdentityAccount();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ name: "", email: "", password: "", confirmation: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [pendingEmail, setPendingEmail] = useState<string>();
  const operation = useIdentityOperation<IdentityMutationResult & { preferredLocale?: Locale }>();
  const destination = { returnTo, intentToken };
  const signup = mode === "sign-up";
  const fieldError = (field: string) => {
    const key = errors[field] ?? operation.failure?.fieldErrors[field];
    return key ? t(key, passwordVariables) : undefined;
  };
  const change = (name: keyof typeof values, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
    operation.clear();
  };
  const blur = (name: keyof typeof values) => setErrors((previous) => ({ ...previous, [name]: validateCredentials(mode, values)[name] }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.pending) return;
    const nextErrors = validateCredentials(mode, values);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) { focusFirstError(formRef.current, nextErrors); return; }
    const email = values.email.trim();
    const result = await operation.run(async (signal) => {
      const mutation = await (signup
        ? identityClient.signUp({ name: values.name.trim(), email, password: values.password, locale, ...destination }, { signal })
        : identityClient.signIn({ email, password: values.password, ...destination }, { signal }));
      const viewer = mutation.status === "signed-in" ? await account.refresh().catch(() => null) : null;
      return { ...mutation, preferredLocale: viewer?.user.locale };
    });
    if (!result) return;
    setValues((previous) => ({ ...previous, password: "", confirmation: "" }));
    if (result.status === "verification-pending") {
      setPendingEmail(email);
      onVerificationPending?.(true);
      return;
    }
    if (result.preferredLocale) setLocale(result.preferredLocale);
    onAuthenticated(authReturnTo(result.returnTo ?? returnTo, intentToken));
  }

  if (pendingEmail) return <div className={styles.stack}>
    <VerificationPending email={pendingEmail} destination={destination} onChangeEmail={() => { setPendingEmail(undefined); operation.clear(); onVerificationPending?.(false); }} />
    {onModeChange ? <Button variant="quiet" onClick={() => { setPendingEmail(undefined); operation.clear(); onVerificationPending?.(false); onModeChange("sign-in"); }}>{t("identity.navigation.signIn")}</Button> : <Link href={authHref("/sign-in", destination)} className={styles.textLink}>{t("identity.navigation.signIn")}</Link>}
  </div>;

  return <>
    <form ref={formRef} onSubmit={submit} noValidate className={styles.form} aria-busy={operation.pending || undefined}>
      <fieldset disabled={operation.pending}>
        {signup && <InputField name="name" label={t("identity.fields.name")} autoComplete="name" required value={values.name} error={fieldError("name")} onBlur={() => blur("name")} onChange={(event) => change("name", event.target.value)} />}
        <InputField name="email" label={t("identity.fields.email")} type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={values.email} error={fieldError("email")} onBlur={() => blur("email")} onChange={(event) => change("email", event.target.value)} />
        <PasswordField name="password" label={t("identity.fields.password")} autoComplete={signup ? "new-password" : "current-password"} required value={values.password} error={fieldError("password")} hint={signup ? t("identity.signUp.passwordHint", passwordVariables) : undefined} onBlur={() => blur("password")} onChange={(event) => change("password", event.target.value)} />
        {signup && <PasswordField name="confirmation" label={t("identity.signUp.confirmPassword")} autoComplete="new-password" required value={values.confirmation} error={fieldError("confirmation")} onBlur={() => blur("confirmation")} onChange={(event) => change("confirmation", event.target.value)} />}
      </fieldset>
      <OperationError failure={operation.failure} />
      {operation.failure?.messageKey === "identity.errors.emailNotVerified" && (onRecovery ? <Button variant="quiet" onClick={() => onRecovery("verify")}>{t("identity.verification.resend")}</Button> : <Link className={styles.textLink} href={authHref("/auth/verify", destination)}>{t("identity.verification.resend")}</Link>)}
      <Button type="submit" icon={signup ? UserPlus : LogIn} variant="primary" pending={operation.pending} pendingLabel={t(signup ? "identity.signUp.pending" : "identity.signIn.pending")} className={styles.primary}>{t(signup ? "identity.signUp.submit" : "identity.signIn.submit")}</Button>
      {!signup && (onRecovery ? <Button variant="quiet" disabled={operation.pending} onClick={() => onRecovery("reset")}>{t("identity.signIn.forgotPassword")}</Button> : <Link href={authHref("/auth/reset", destination)} className={styles.textLink}>{t("identity.signIn.forgotPassword")}</Link>)}
    </form>
    <div className={styles.formFooter}>
      <span>{t(signup ? "identity.signUp.existingAccount" : "identity.signIn.noAccount")}</span>
      {onModeChange ? <Button variant="quiet" disabled={operation.pending} onClick={() => { setValues((previous) => ({ ...previous, password: "", confirmation: "" })); setErrors({}); operation.clear(); onModeChange(signup ? "sign-in" : "sign-up"); }}>{t(signup ? "identity.navigation.signIn" : "identity.navigation.signUp")}</Button> : <Link className={styles.textLink} href={authHref(signup ? "/sign-in" : "/sign-up", destination)}>{t(signup ? "identity.navigation.signIn" : "identity.navigation.signUp")}</Link>}
    </div>
  </>;
}

export function SignInPage(props: AuthReturn) {
  const t = useIdentityTranslations();
  const router = useRouter();
  return <IdentityFrame title={t("identity.signIn.title")} description={t("identity.signIn.description")}><CredentialsForm {...props} mode="sign-in" onAuthenticated={(target) => { router.replace(target); router.refresh(); }} /></IdentityFrame>;
}

export function SignUpPage(props: AuthReturn) {
  const t = useIdentityTranslations();
  const router = useRouter();
  const [verificationPending, setVerificationPending] = useState(false);
  return <IdentityFrame title={t(verificationPending ? "identity.verification.pendingTitle" : "identity.signUp.title")} description={verificationPending ? undefined : t("identity.signUp.description")}><CredentialsForm {...props} mode="sign-up" onVerificationPending={setVerificationPending} onAuthenticated={(target) => { router.replace(target); router.refresh(); }} /></IdentityFrame>;
}

export function AuthDialog({ open, onOpenChange, onAuthenticated, returnTo, intentToken, returnFocus }: AuthReturn & { open: boolean; onOpenChange: (open: boolean) => void; onAuthenticated: (returnTo: string) => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const t = useIdentityTranslations();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [verificationPending, setVerificationPending] = useState(false);
  const [recovery, setRecovery] = useState<"verify" | "reset">();
  const handleOpen = (next: boolean) => { if (!next) { setMode("sign-in"); setVerificationPending(false); setRecovery(undefined); } onOpenChange(next); };
  return <Dialog open={open} onOpenChange={handleOpen} returnFocus={returnFocus} title={t(recovery === "reset" ? "identity.reset.requestTitle" : recovery === "verify" ? "identity.verification.title" : verificationPending ? "identity.verification.pendingTitle" : mode === "sign-in" ? "identity.signIn.title" : "identity.signUp.title")} description={!recovery && mode === "sign-in" ? t("identity.signIn.dialogDescription") : undefined} footer={<DialogClose>{t("identity.sessions.cancel")}</DialogClose>}>
    {open && <div className={styles.stack}><div className={styles.dialogLocale}><LocaleSelect compact /></div>{recovery ? <><RequestEmailForm kind={recovery} destination={{ returnTo, intentToken }} /><Button variant="quiet" onClick={() => setRecovery(undefined)}>{t("identity.navigation.signIn")}</Button></> : <CredentialsForm mode={mode} returnTo={returnTo} intentToken={intentToken} onModeChange={setMode} onRecovery={setRecovery} onVerificationPending={setVerificationPending} onAuthenticated={(target) => { handleOpen(false); onAuthenticated(target); }} />}</div>}
  </Dialog>;
}
