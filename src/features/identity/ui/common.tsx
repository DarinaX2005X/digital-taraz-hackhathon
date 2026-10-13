"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { IconButton, LocaleSelect } from "@/ui";
import { FieldLabel, FieldMessages, fieldDescriptionIds } from "@/ui/field";
import { useIdentityTranslations } from "./hooks";
import type { IdentityFailure } from "./transport";
import { passwordVariables } from "./validation";
import styles from "./identity.module.css";

export { authHref, type AuthReturn } from "./navigation";

export function IdentityFrame({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const t = useIdentityTranslations();
  return <div className={styles.page}>
    <header className={styles.topbar}>
      <Link href="/" className={styles.brand} aria-label={`Tirlik. ${t("identity.navigation.home")}`}><Image src="/brand/tirlik-mark.svg" width={40} height={40} alt="" priority /><span>Tirlik</span></Link>
      <LocaleSelect className={styles.locale} />
    </header>
    <main className={styles.authMain}>
      <div className={styles.heading}><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {children}
    </main>
  </div>;
}

export function BackLink({ href = "/sign-in", children }: { href?: string; children?: ReactNode }) {
  const t = useIdentityTranslations();
  return <Link className={styles.textLink} href={href}><ArrowLeft aria-hidden="true" size={18} />{children ?? t("identity.navigation.signIn")}</Link>;
}

export function PasswordField({ label, hint, error, id: suppliedId, ref, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & { label: string; hint?: string; error?: string; ref?: Ref<HTMLInputElement> }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const [visible, setVisible] = useState(false);
  const t = useIdentityTranslations();
  return <div className="tl-field">
    <FieldLabel id={id} label={label} required={props.required} />
    <div className={`tl-field__control ${styles.passwordControl}`} data-invalid={Boolean(error) || undefined}>
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
