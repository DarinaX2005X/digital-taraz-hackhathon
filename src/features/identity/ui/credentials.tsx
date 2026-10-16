"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { Button, Dialog, DialogClose, InputField } from "@/ui";
import { useLocale } from "@/i18n/provider";
import type { Locale } from "@/i18n";
import type { IdentityMutationResult } from "../contracts";
import { authReturnTo } from "../domain/return-to";
import { authHref, IdentityFrame, OperationError, PasswordField, type AuthReturn } from "./common";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { identityClient } from "./transport";
import { focusFirstError, hasErrors, passwordVariables, validateCredentials, type FormErrors } from "./validation";
import styles from "./identity.module.css";
import { RequestEmailForm } from "./recovery";

type CredentialsProps = AuthReturn & {
  mode: "sign-in" | "sign-up";
  onAuthenticated: (returnTo: string) => void;
  onModeChange?: (mode: "sign-in" | "sign-up") => void;
  onRecovery?: () => void;
};

export function CredentialsForm({ mode, returnTo, intentToken, onAuthenticated, onModeChange, onRecovery }: CredentialsProps) {
  const t = useIdentityTranslations();
  const { locale, setLocale } = useLocale();
  const account = useIdentityAccount();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ name: "", email: "", password: "", confirmation: "" });
  const [errors, setErrors] = useState<FormErrors>({});
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
    if (result.preferredLocale) setLocale(result.preferredLocale);
    onAuthenticated(authReturnTo(result.returnTo ?? returnTo, intentToken));
  }

  return <>
    <form ref={formRef} onSubmit={submit} noValidate className={styles.form} aria-busy={operation.pending || undefined}>
      <fieldset disabled={operation.pending}>
        {signup && <InputField name="name" label={t("identity.fields.name")} autoComplete="name" required value={values.name} error={fieldError("name")} onBlur={() => blur("name")} onChange={(event) => change("name", event.target.value)} />}
        <InputField name="email" label={t("identity.fields.email")} type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={values.email} error={fieldError("email")} onBlur={() => blur("email")} onChange={(event) => change("email", event.target.value)} />
        <PasswordField name="password" label={t("identity.fields.password")} autoComplete={signup ? "new-password" : "current-password"} required value={values.password} error={fieldError("password")} hint={signup ? t("identity.signUp.passwordHint", passwordVariables) : undefined} onBlur={() => blur("password")} onChange={(event) => change("password", event.target.value)} />
        {signup && <PasswordField name="confirmation" label={t("identity.signUp.confirmPassword")} autoComplete="new-password" required value={values.confirmation} error={fieldError("confirmation")} onBlur={() => blur("confirmation")} onChange={(event) => change("confirmation", event.target.value)} />}
      </fieldset>
      <OperationError failure={operation.failure} />
      <Button type="submit" icon={signup ? UserPlus : LogIn} variant="primary" pending={operation.pending} pendingLabel={t(signup ? "identity.signUp.pending" : "identity.signIn.pending")} className={styles.primary}>{t(signup ? "identity.signUp.submit" : "identity.signIn.submit")}</Button>
      {!signup && (onRecovery ? <Button variant="quiet" disabled={operation.pending} onClick={onRecovery}>{t("identity.signIn.forgotPassword")}</Button> : <Link href={authHref("/auth/reset", destination)} className={styles.textLink}>{t("identity.signIn.forgotPassword")}</Link>)}
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
  return <IdentityFrame title={t("identity.signUp.title")} description={t("identity.signUp.description")}><CredentialsForm {...props} mode="sign-up" onAuthenticated={(target) => { router.replace(target); router.refresh(); }} /></IdentityFrame>;
}

export function AuthDialog({ open, onOpenChange, onAuthenticated, returnTo, intentToken, returnFocus }: AuthReturn & { open: boolean; onOpenChange: (open: boolean) => void; onAuthenticated: (returnTo: string) => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const t = useIdentityTranslations();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [recovery, setRecovery] = useState(false);
  const handleOpen = (next: boolean) => { if (!next) { setMode("sign-in"); setRecovery(false); } onOpenChange(next); };
  return <Dialog open={open} onOpenChange={handleOpen} returnFocus={returnFocus} title={t(recovery ? "identity.reset.requestTitle" : mode === "sign-in" ? "identity.signIn.title" : "identity.signUp.title")} description={!recovery && mode === "sign-in" ? t("identity.signIn.dialogDescription") : undefined} footer={<DialogClose>{t("identity.sessions.cancel")}</DialogClose>}>
    {open && <div className={styles.stack}>{recovery ? <><RequestEmailForm destination={{ returnTo, intentToken }} /><Button variant="quiet" onClick={() => setRecovery(false)}>{t("identity.navigation.signIn")}</Button></> : <CredentialsForm mode={mode} returnTo={returnTo} intentToken={intentToken} onModeChange={setMode} onRecovery={() => setRecovery(true)} onAuthenticated={(target) => { handleOpen(false); onAuthenticated(target); }} />}</div>}
  </Dialog>;
}
