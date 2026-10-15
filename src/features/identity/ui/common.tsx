"use client";

import Link from "next/link";
import Image from "next/image";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LogIn, Mail, ShieldCheck, Users, UserRound } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { Button, IconButton, LoadingState, LocaleSelect, ProductHeader } from "@/ui";
import { FieldLabel, FieldMessages, fieldDescriptionIds } from "@/ui/field";
import { useIdentityTranslations } from "./hooks";
import type { IdentityFailure } from "./transport";
import { passwordVariables } from "./validation";
import type { PrivateAccess } from "./private-access";
import { useLocale } from "@/i18n/provider";
import { useLocalMailInbox } from "./identity-locale-provider";
import styles from "./identity.module.css";

export { authHref, type AuthReturn } from "./navigation";

export function IdentityFrame({ title, description, children, headerActions }: { title: string; description?: string; children: ReactNode; headerActions?: ReactNode }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  return <div className={styles.page}>
    <ProductHeader wide homeLabel={t("identity.navigation.home")} homeHref={`/${locale}`}><LocaleSelect compact />{headerActions}</ProductHeader>
    <main className={styles.authMain}>
      <aside className={styles.authStory} aria-labelledby="auth-story-title">
        <div className={styles.authStoryText}><h2 id="auth-story-title">{t("identity.frame.title")}</h2><p>{t("identity.frame.description")}</p></div>
        <div className={styles.authArt}><Image src="/site/account-invitation.png" alt="" fill sizes="(max-width: 900px) 1px, (max-width: 1400px) 40vw, 520px" /></div>
        <ul className={styles.authBenefits}><li><UserRound size={19} aria-hidden="true" />{t("identity.frame.profile")}</li><li><Users size={19} aria-hidden="true" />{t("identity.frame.team")}</li><li><ShieldCheck size={19} aria-hidden="true" />{t("identity.frame.access")}</li></ul>
      </aside>
      <section className={styles.authPanel}>
        <div className={styles.authFormWrap}>
          <Link href={`/${locale}`} className={styles.authBack}><ArrowLeft size={18} aria-hidden="true" />{t("identity.navigation.home")}</Link>
          <div className={styles.heading}><h1>{title}</h1>{description && <p>{description}</p>}</div>
          {children}
          <nav className={styles.authFooter} aria-label={t("identity.frame.help")}><Link href={`/${locale}/help`}>{t("identity.frame.help")}</Link><Link href={`/${locale}/privacy`}>{t("identity.frame.privacy")}</Link></nav>
        </div>
      </section>
    </main>
  </div>;
}

export function LocalMailNotice() {
  const inbox = useLocalMailInbox();
  const t = useIdentityTranslations();
  if (!inbox) return null;
  return <aside className={styles.localMail}><Mail size={22} aria-hidden="true" /><div><strong>{t("identity.localMail.title")}</strong><p>{t("identity.localMail.description")}</p><a href={inbox} target="_blank" rel="noopener noreferrer">{t("identity.localMail.open")}<ArrowRight size={16} aria-hidden="true" /></a></div></aside>;
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
