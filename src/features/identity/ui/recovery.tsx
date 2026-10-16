"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { KeyRound, Mail } from "lucide-react";
import { Button, InputField } from "@/ui";
import { useLocale } from "@/i18n/provider";
import { OpaqueTokenSchema, type IdentityMutationResult } from "../contracts";
import { authHref, BackLink, IdentityFrame, LocalMailNotice, OperationError, PasswordField, SuccessNotice, type AuthReturn } from "./common";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { identityClient } from "./transport";
import { focusFirstError, hasErrors, passwordVariables, validateEmail, validatePassword, type FormErrors } from "./validation";
import styles from "./identity.module.css";
import { useLocalMailInbox } from "./identity-locale-provider";

export function RequestEmailForm({ destination = {} }: { destination?: AuthReturn }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<ReturnType<typeof validateEmail>>();
  const input = useRef<HTMLInputElement>(null);
  const operation = useIdentityOperation<IdentityMutationResult>();
  const localInbox = useLocalMailInbox();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.pending) return;
    const invalid = validateEmail(email);
    setError(invalid);
    if (invalid) { input.current?.focus(); return; }
    await operation.run((signal) => identityClient.requestPasswordReset({ email: email.trim(), locale, ...destination }, { signal }));
  }
  return <form onSubmit={submit} noValidate className={styles.form} aria-busy={operation.pending || undefined}>
    <InputField ref={input} name="email" label={t("identity.fields.email")} type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required readOnly={operation.pending} value={email} error={error ? t(error) : operation.failure?.fieldErrors.email ? t(operation.failure.fieldErrors.email) : undefined} onBlur={() => setError(validateEmail(email))} onChange={(event) => { setEmail(event.target.value); setError(undefined); operation.clear(); }} />
    <OperationError failure={operation.failure} />
    {operation.result && <SuccessNotice>{t(localInbox ? "identity.localMail.resent" : "identity.reset.requestedDescription")}</SuccessNotice>}
    <LocalMailNotice />
    <Button type="submit" variant="primary" icon={Mail} pending={operation.pending} pendingLabel={t("identity.reset.requesting")}>{t("identity.reset.request")}</Button>
  </form>;
}

export function ResetPasswordPage(props: AuthReturn & { token?: string }) {
  return <ResetPasswordScreen key={props.token ?? "request"} {...props} />;
}

function ResetPasswordScreen({ token, ...destination }: AuthReturn & { token?: string }) {
  const t = useIdentityTranslations();
  const form = useRef<HTMLFormElement>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const operation = useIdentityOperation<IdentityMutationResult>();
  const hasToken = Boolean(token);
  const tokenValid = OpaqueTokenSchema.safeParse(token).success;
  const expired = hasToken && (!tokenValid || operation.failure?.messageKey === "identity.errors.expiredToken" || operation.failure?.messageKey === "identity.errors.invalidToken");
  const success = Boolean(operation.result);
  const validate = (): FormErrors => ({ newPassword: validatePassword(newPassword, true), confirmation: newPassword !== confirmation ? "identity.validation.passwordMismatch" : validatePassword(confirmation, true) });
  const errorText = (name: string) => { const key = errors[name] ?? operation.failure?.fieldErrors[name]; return key ? t(key, passwordVariables) : undefined; };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || operation.pending) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) { focusFirstError(form.current, nextErrors); return; }
    const result = await operation.run((signal) => identityClient.resetPassword({ token, newPassword }, { signal }));
    if (result) { setNewPassword(""); setConfirmation(""); }
  }
  return <IdentityFrame title={t(success ? "identity.reset.successTitle" : expired ? "identity.reset.invalidTitle" : hasToken ? "identity.reset.title" : "identity.reset.requestTitle")} description={t(success ? "identity.reset.successDescription" : expired ? "identity.reset.invalidDescription" : hasToken ? "identity.reset.description" : "identity.reset.requestDescription")}>
    <div className={styles.stack}>
      {success ? null : expired ? <Link className="tl-button tl-button--primary" href={authHref("/auth/reset", destination)}><Mail aria-hidden="true" size={20} /><span className="tl-button__label">{t("identity.reset.requestAgain")}</span></Link> : hasToken ? <form ref={form} onSubmit={submit} noValidate className={styles.form} aria-busy={operation.pending || undefined}>
        <fieldset disabled={operation.pending}>
          <PasswordField name="newPassword" label={t("identity.fields.newPassword")} autoComplete="new-password" required value={newPassword} hint={t("identity.signUp.passwordHint", passwordVariables)} error={errorText("newPassword")} onBlur={() => setErrors((previous) => ({ ...previous, newPassword: validate().newPassword }))} onChange={(event) => { setNewPassword(event.target.value); setErrors((previous) => ({ ...previous, newPassword: undefined })); operation.clear(); }} />
          <PasswordField name="confirmation" label={t("identity.signUp.confirmPassword")} autoComplete="new-password" required value={confirmation} error={errorText("confirmation")} onBlur={() => setErrors((previous) => ({ ...previous, confirmation: validate().confirmation }))} onChange={(event) => { setConfirmation(event.target.value); setErrors((previous) => ({ ...previous, confirmation: undefined })); operation.clear(); }} />
        </fieldset>
        <OperationError failure={operation.failure} />
        <Button type="submit" variant="primary" icon={KeyRound} pending={operation.pending} pendingLabel={t("identity.reset.pending")}>{t("identity.reset.submit")}</Button>
      </form> : <RequestEmailForm destination={destination} />}
      <BackLink primary={success} href={authHref("/sign-in", destination)} />
    </div>
  </IdentityFrame>;
}
