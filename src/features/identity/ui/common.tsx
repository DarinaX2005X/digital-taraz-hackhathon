"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LogIn } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { Button, IconButton, LoadingState, LocaleSelect, ProductHeader } from "@/ui";
import { FieldLabel, FieldMessages, fieldDescriptionIds } from "@/ui/field";
import { useIdentityTranslations } from "./hooks";
import type { IdentityFailure } from "./transport";
import { passwordVariables } from "./validation";
import type { PrivateAccess } from "./private-access";
import styles from "./identity.module.css";

export { authHref, type AuthReturn } from "./navigation";

export function IdentityFrame({ title, description, children, headerActions }: { title: string; description?: string; children: ReactNode; headerActions?: ReactNode }) {
  const t = useIdentityTranslations();
  return <div className={styles.page}>
    <ProductHeader homeLabel={t("identity.navigation.home")}><LocaleSelect compact />{headerActions}</ProductHeader>
    <main className={styles.authMain}>
      <div className={styles.heading}><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {children}
    </main>
  </div>;
}

export function BackLink({ href = "/sign-in", children, primary = false }: { href?: string; children?: ReactNode; primary?: boolean }) {
  const t = useIdentityTranslations();
  return <Link className={primary ? "tl-button tl-button--primary" : styles.textLink} href={href}><ArrowLeft aria-hidden="true" size={18} /><span className="tl-button__label">{children ?? t("identity.navigation.signIn")}</span></Link>;
}

export function PasswordField({ label, hint, error, id: suppliedId, ref, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & { label: string; hint?: string; error?: string; ref?: Ref<HTMLInputElement> }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const [visible, setVisible] = useState(false);
  const t = useIdentityTranslations();
  return <div className="tl-field">
    <FieldLabel id={id} label={label} required={props.required} />
    <div className={`tl-field__control ${styles.passwordControl}`} data-invalid={Boolean(error) || undefined} data-disabled={props.disabled || undefined}>
      <input {...props} ref={ref} id={id} type={visible ? "text" : "password"} spellCheck={false} autoCapitalize="none" aria-invalid={Boolean(error) || undefined} aria-describedby={fieldDescriptionIds(id, { hint, error, describedBy: props["aria-describedby"] })} />
      <IconButton icon={visible ? EyeOff : Eye} label={t(visible ? "identity.fields.hidePassword" : "identity.fields.showPassword")} aria-controls={id} aria-pressed={visible} onClick={() => setVisible(!visible)} />
    </div>
    <FieldMessages id={id} hint={hint} error={error} />
  </div>;
}

export function OperationError({ failure }: { failure?: IdentityFailure }) {
  const t = useIdentityTranslations();
  if (!failure) return null;
  return <div role="alert" className={styles.error}><AlertCircle aria-hidden="true" size={20} /><div><p>{t(failure.messageKey, passwordVariables)}</p>{failure.retryAfterSeconds && <p>{t("identity.errors.retryAfter", { seconds: failure.retryAfterSeconds })}</p>}</div></div>;
}

export function SuccessNotice({ children }: { children: ReactNode }) {
  return <div className={styles.success} role="status"><CheckCircle2 aria-hidden="true" size={20} /><div>{children}</div></div>;
}

export function PrivateSessionState({ phase, onSignIn, onResume }: { phase: PrivateAccess["phase"]; onSignIn: () => void; onResume: () => void }) {
  const t = useIdentityTranslations();
  if (phase === "checking") return <LoadingState label={t("identity.profile.loading")} />;
  const recovered = phase === "resume-required";
  return <div className={styles.stack}>
    <p role="status">{t(recovered ? "identity.sessionRecovery.ready" : "identity.profile.sessionExpired")}</p>
    {recovered && <p className={styles.muted}>{t("identity.sessionRecovery.review")}</p>}
    <Button icon={recovered ? ArrowRight : LogIn} variant="primary" onClick={recovered ? onResume : onSignIn}>{t(recovered ? "identity.sessionRecovery.continue" : "identity.navigation.signIn")}</Button>
  </div>;
}
