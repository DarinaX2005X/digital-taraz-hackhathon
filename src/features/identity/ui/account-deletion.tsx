"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import { Button, CheckboxField, Combobox, Dialog, DialogClose, InputField, LoadingState, SelectField } from "@/ui";
import { useLocale } from "@/i18n/provider";
import { formatInstant, formatNumber, formatUnit } from "@/i18n/format";
import { DeleteAccountSchema, type AccountDeletionPreview, type AccountDeletionResult } from "../contracts";
import type { IdentityMessageKey } from "../locales";
import { IdentityFrame, OperationError, PasswordField, SuccessNotice } from "./common";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { useIdentityAccount } from "./identity-locale-provider";
import { useIdentityWriteIntent, type IdentityAuthGuard } from "./team-controls";
import { asIdentityFailure, identityClient } from "./transport";
import { emptyDeletionDraft, reconcileDeletionDrafts, validateDeletionChoices, type DeletionDraft, type DeletionDrafts } from "./deletion-state";
import { passwordVariables, validatePassword } from "./validation";
import styles from "./identity.module.css";

const actionLabels = { leave: "identity.deletion.leave", transfer: "identity.deletion.transfer", delete: "identity.deletion.deleteWorkspace" } as const;

function DeletionDialog({ userId, guard, authVersion, initialUncertain, onUncertainChange, onClose, onDeleted }: { userId: string; guard: IdentityAuthGuard; authVersion: number; initialUncertain: boolean; onUncertainChange: (uncertain: boolean) => void; onClose: () => void; onDeleted: (result: AccountDeletionResult) => void }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const account = useIdentityAccount();
  const refreshAccount = account.refresh;
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<AccountDeletionPreview>();
  const [drafts, setDrafts] = useState<DeletionDrafts>({});
  const [errors, setErrors] = useState<Record<string, IdentityMessageKey>>({});
  const [stage, setStage] = useState<"choices" | "confirm">("choices");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [passwordError, setPasswordError] = useState<IdentityMessageKey>();
  const [confirmationError, setConfirmationError] = useState(false);
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState(initialUncertain);
  const [sessionMissing, setSessionMissing] = useState(false);
  const read = useIdentityOperation<AccountDeletionPreview>();
  const operation = useIdentityOperation<AccountDeletionResult>();
  const check = useIdentityOperation<boolean>();
  const intent = useIdentityWriteIntent();
  const { run, cancel } = read;
  const load = useCallback(() => {
    cancel();
    return run(async (signal) => {
      try { return await guard(signal, () => identityClient.deletionPreview({ signal, expectedUserId: userId })); }
      catch (error) {
        const status = asIdentityFailure(error).status;
        if (!signal.aborted && [403, 404, 409].includes(status)) { setPreview(undefined); setPassword(""); setConfirmed(false); }
        if (!signal.aborted && status === 409) void refreshAccount().catch(() => undefined);
        throw error;
      }
    }).then((result) => {
      if (result) {
        setPreview(result); setDrafts((previous) => reconcileDeletionDrafts(result, previous));
        setStage("choices"); setPassword(""); setConfirmed(false); setErrors({}); setPasswordError(undefined); setConfirmationError(false); setStale(false);
      }
      return result;
    });
  }, [run, cancel, userId, refreshAccount, guard]);
  useEffect(() => { void load(); return cancel; }, [load, cancel, authVersion]);
  const busy = read.pending || operation.pending || check.pending;

  function changeChoice(workspaceId: string, patch: Partial<DeletionDraft>) {
    setDrafts((previous) => ({ ...previous, [workspaceId]: { ...(previous[workspaceId] ?? emptyDeletionDraft()), ...patch } }));
    setErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== workspaceId)));
    setConfirmed(false); setPassword(""); operation.clear();
  }
  async function checkAccount() {
    const result = await check.run(async (signal) => {
      try { await guard(signal, () => identityClient.me({ signal, expectedUserId: userId })); return true; }
      catch (error) {
        if (asIdentityFailure(error).status === 401) return false;
        throw error;
      }
    });
    if (result === false) { setSessionMissing(true); setPassword(""); setConfirmed(false); }
    if (result === true) { setUncertain(false); onUncertainChange(false); setSessionMissing(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || busy || stale || uncertain || sessionMissing) return;
    const selected = validateDeletionChoices(preview, drafts);
    setErrors(selected.errors);
    if (Object.keys(selected.errors).length) {
      setStage("choices");
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (stage === "choices") { setStage("confirm"); return; }
    const invalidPassword = validatePassword(password, false);
    setPasswordError(invalidPassword); setConfirmationError(!confirmed);
    if (invalidPassword) { passwordInput.current?.focus(); return; }
    if (!confirmed) { form.current?.querySelector<HTMLElement>('input[name="confirmDeletion"]')?.focus(); return; }
    const parsed = DeleteAccountSchema.safeParse({ password, confirmation: "DELETE_ACCOUNT", workspaces: selected.choices });
    if (!parsed.success) { setErrors({ account: "identity.errors.accountDeletionBlocked" }); return; }
    const body = parsed.data;
    const result = await operation.run((signal) => guard(signal, async () => {
      try {
        const key = await intent.keyFor({ userId, action: "delete-account", body }, signal);
        onUncertainChange(true);
        return await identityClient.deleteAccount(body, key, { signal, expectedUserId: userId });
      } catch (error) {
        const failure = asIdentityFailure(error);
        if (!signal.aborted && failure.status === 409) { setStale(true); setConfirmed(false); setPassword(""); }
        if (!signal.aborted && failure.status === 0) setUncertain(true);
        if (!signal.aborted && failure.status !== 0) onUncertainChange(false);
        throw error;
      }
    }));
    if (result) { setPassword(""); intent.clear(); onDeleted(result); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.pending) onClose(); }} title={t(stage === "choices" ? "identity.deletion.reviewTitle" : "identity.deletion.confirmTitle")} initialFocus={cancelButton} footer={<>
    <DialogClose ref={cancelButton} disabled={operation.pending}>{t("identity.deletion.cancel")}</DialogClose>
    {stage === "confirm" && <Button icon={ArrowLeft} disabled={busy} onClick={() => { setStage("choices"); setConfirmed(false); setPassword(""); }}>{t("identity.deletion.back")}</Button>}
    <Button type="submit" form={formId} icon={stage === "choices" ? ArrowRight : Trash2} variant={stage === "choices" ? "primary" : "danger"} pending={operation.pending} disabled={!preview || busy || stale || uncertain || sessionMissing}>{t(operation.pending ? "identity.deletion.submitting" : stage === "choices" ? "identity.deletion.continue" : "identity.deletion.submit")}</Button>
  </>}>
    <form ref={form} id={formId} className={styles.form} onSubmit={submit} noValidate>
      {read.pending && <LoadingState label={t("identity.deletion.loading")} />}
      <OperationError failure={read.failure} />
      {read.failure && <Button icon={RefreshCw} onClick={() => { void load(); }}>{t(read.failure.status === 401 ? "identity.navigation.signIn" : "identity.deletion.refresh")}</Button>}
      {preview && <>
        <p>{t("identity.deletion.consequence")}</p>
        {stage === "choices" ? <>
          {!preview.ownedWorkspaces.length && <p className={styles.muted}>{t("identity.deletion.noOwned")}</p>}
          {preview.ownedWorkspaces.map((workspace) => {
            const draft = drafts[workspace.workspaceId] ?? emptyDeletionDraft();
            const options = workspace.transferCandidates.map((candidate) => ({ id: candidate.userId, label: candidate.name, description: candidate.email }));
            const error = errors[workspace.workspaceId];
            return <div key={workspace.workspaceId} className={styles.deletionWorkspace}>
              <div><h3>{workspace.name}</h3><p className={styles.meta}>{t("identity.deletion.memberCount", { count: formatNumber(locale, workspace.memberCount) })}</p></div>
              <SelectField name={`action-${workspace.workspaceId}`} label={t("identity.deletion.workspaceAction")} value={draft.action} required disabled={busy} error={error === "identity.deletion.decisionRequired" ? t(error) : undefined} onChange={(event) => changeChoice(workspace.workspaceId, { action: event.target.value as DeletionDraft["action"] })}>
                <option value="">{t("identity.deletion.chooseAction")}</option>
                {workspace.canLeave && <option value="leave">{t("identity.deletion.leave")}</option>}
                {!!options.length && <option value="transfer">{t("identity.deletion.transfer")}</option>}
                <option value="delete">{t("identity.deletion.deleteWorkspace")}</option>
              </SelectField>
              {draft.action === "transfer" && <Combobox name={`successor-${workspace.workspaceId}`} label={t("identity.deletion.successor")} options={options} value={options.find((option) => option.id === draft.targetUserId) ?? null} disabled={busy} required error={error === "identity.deletion.successorRequired" ? t(error) : undefined} onChange={(option) => changeChoice(workspace.workspaceId, { targetUserId: option?.id ?? "" })} />}
              {draft.action === "delete" && <><div className={styles.warning}><AlertTriangle size={20} aria-hidden="true" /><p>{t("identity.deletion.workspaceDeleteWarning", { workspace: workspace.name })}</p></div><InputField name={`confirmationName-${workspace.workspaceId}`} label={t("identity.deletion.confirmWorkspaceName")} autoComplete="off" spellCheck={false} value={draft.confirmationName} required readOnly={busy} error={error === "identity.deletion.workspaceNameMismatch" ? t(error) : undefined} onChange={(event) => changeChoice(workspace.workspaceId, { confirmationName: event.target.value })} /></>}
              {!workspace.canLeave && !options.length && <p className={styles.muted}>{t("identity.deletion.transferFirst")} <Link href="/settings/team" className={styles.textLink}>{t("identity.deletion.settings")}</Link></p>}
            </div>;
          })}
        </> : <>
          {!!preview.ownedWorkspaces.length && <div><h3 className={styles.minorHeading}>{t("identity.deletion.review")}</h3><ul className={styles.decisionSummary}>{preview.ownedWorkspaces.map((workspace) => {
            const draft = drafts[workspace.workspaceId];
            if (!draft?.action) return null;
            const candidate = workspace.transferCandidates.find((member) => member.userId === draft.targetUserId);
            return <li key={workspace.workspaceId}><strong>{workspace.name}</strong><span>{t(actionLabels[draft.action])}{draft.action === "transfer" && candidate ? `: ${candidate.name} (${candidate.email})` : ""}</span></li>;
          })}</ul></div>}
          <PasswordField ref={passwordInput} name="password" autoComplete="current-password" label={t("identity.deletion.password")} required readOnly={busy} value={password} error={passwordError ? t(passwordError, passwordVariables) : operation.failure?.fieldErrors.password ? t(operation.failure.fieldErrors.password, passwordVariables) : undefined} onChange={(event) => { setPassword(event.target.value); setPasswordError(undefined); operation.clear(); }} />
          <CheckboxField name="confirmDeletion" label={t("identity.deletion.confirmation")} checked={confirmed} disabled={busy} required error={confirmationError ? t("identity.deletion.confirmRequired") : undefined} onChange={(event) => { setConfirmed(event.target.checked); setConfirmationError(false); }} />
        </>}
        {preview.otherWorkspaceCount > 0 && <p className={styles.muted}>{t("identity.deletion.sharedRemain")}</p>}
        <p className={styles.muted}>{t("identity.deletion.retention")}</p>
        <dl className={styles.facts}><dt>{t("identity.deletion.retentionPeriod")}</dt><dd>{formatUnit(locale, preview.retentionDays, "day", { unitDisplay: "long" })}</dd></dl>
      </>}
      {stale && <div className={styles.stack}><p role="alert">{t("identity.deletion.changed")}</p><Button icon={RefreshCw} onClick={() => { void load(); }}>{t("identity.deletion.refresh")}</Button></div>}
      {uncertain && <div className={styles.stack}><p role="alert">{t("identity.deletion.uncertain")}</p>{sessionMissing ? <p>{t("identity.deletion.sessionUnavailable")}</p> : <Button icon={RefreshCw} pending={check.pending} onClick={() => { void checkAccount(); }}>{t("identity.deletion.checkStatus")}</Button>}</div>}
      <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
      <OperationError failure={check.failure} />
      {errors.account && <p role="alert" className={styles.error}>{t(errors.account)}</p>}
    </form>
  </Dialog>;
}

export function AccountDeletionSection({ userId, guard, authVersion, uncertain, onUncertainChange, onDeleted }: { userId: string; guard: IdentityAuthGuard; authVersion: number; uncertain: boolean; onUncertainChange: (uncertain: boolean) => void; onDeleted: (result: AccountDeletionResult) => void }) {
  const t = useIdentityTranslations();
  const [open, setOpen] = useState(false);
  return <section className={`${styles.section} ${styles.dangerSection}`} id="delete-account" tabIndex={-1} aria-labelledby="delete-account-title">
    <h2 id="delete-account-title">{t("identity.deletion.title")}</h2>
    <p className={styles.muted}>{t("identity.deletion.consequence")}</p>
    <Button icon={Trash2} variant="danger" onClick={() => setOpen(true)}>{t("identity.deletion.open")}</Button>
    {open && <DeletionDialog userId={userId} guard={guard} authVersion={authVersion} initialUncertain={uncertain} onUncertainChange={onUncertainChange} onClose={() => setOpen(false)} onDeleted={onDeleted} />}
  </section>;
}

export function AccountDeletedResult({ result }: { result: AccountDeletionResult }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  return <IdentityFrame title={t("identity.deletion.successTitle")}><div className={styles.stack}><SuccessNotice>{t("identity.deletion.successDescription")}</SuccessNotice><p>{t("identity.deletion.cleanupAfter", { date: formatInstant(locale, result.cleanupAfter) })}</p><p className={styles.muted}>{t("identity.deletion.retention")}</p><Link href="/" className={styles.textLink}>{t("identity.navigation.home")}</Link></div></IdentityFrame>;
}
