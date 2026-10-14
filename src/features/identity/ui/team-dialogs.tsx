"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Mail, Plus, RefreshCw, Save, ShieldCheck, Trash2, UserMinus } from "lucide-react";
import { Button, Dialog, DialogClose, InputField } from "@/ui";
import { useLocale } from "@/i18n/provider";
import { formatUnit } from "@/i18n/format";
import { CreateInvitationSchema, CreateWorkspaceSchema, UpdateMemberSchema, type TeamResult, type WorkspaceMembership } from "../contracts";
import type { IdentityMessageKey } from "../locales";
import { OperationError } from "./common";
import { useIdentityOperation, useIdentityTranslations } from "./hooks";
import { asIdentityFailure, identityClient } from "./transport";
import { roleLabels, scopeChanges, validGrant } from "./team-state";
import { GrantFields, PersonIdentity, ScopeList, type IdentityAuthGuard } from "./team-controls";
import type { TeamAction, TeamActionDraft, TeamDrafts } from "./team-drafts";
import { validateEmail } from "./validation";
import styles from "./identity.module.css";

export function CreateWorkspaceDialog({ userId, guard, draft, onClose, onCreated }: { userId: string; guard: IdentityAuthGuard; draft: TeamDrafts; onClose: () => void; onCreated: (workspace: WorkspaceMembership) => void }) {
  const t = useIdentityTranslations();
  const formId = useId();
  const [name, setName] = useState(draft.getSnapshot().workspaceName);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const operation = useIdentityOperation<{ workspace: WorkspaceMembership }>();
  const intent = draft.workspaceIntent;
  function changeName(next: string) { draft.update({ workspaceName: next }); setName(next); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CreateWorkspaceSchema.safeParse({ name });
    setInvalid(!parsed.success);
    if (!parsed.success) { input.current?.focus(); return; }
    const result = await operation.run((signal) => guard(signal, async () => {
      const key = await intent.keyFor({ userId, action: "create-workspace", body: parsed.data }, signal);
      return identityClient.createWorkspace(parsed.data, key, { signal, expectedUserId: userId });
    }));
    if (result) onCreated(result.workspace);
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.pending) onClose(); }} title={t("identity.workspace.createTitle")} dirty={!operation.pending && Boolean(name)} onDiscard={() => changeName("")} initialFocus={input} footer={<><DialogClose disabled={operation.pending}>{t("identity.workspace.cancel")}</DialogClose><Button icon={Plus} type="submit" form={formId} variant="primary" pending={operation.pending}>{t(operation.pending ? "identity.workspace.creating" : "identity.workspace.create")}</Button></>}>
    <form id={formId} className={styles.form} onSubmit={submit} noValidate>
      <InputField ref={input} label={t("identity.workspace.name")} name="workspaceName" autoComplete="organization" value={name} required maxLength={100} readOnly={operation.pending} error={invalid ? t("identity.workspace.nameError") : undefined} onChange={(event) => { changeName(event.target.value); setInvalid(false); operation.clear(); }} />
      <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
    </form>
  </Dialog>;
}

export type { TeamAction } from "./team-drafts";
const titleKeys: Record<TeamAction["kind"], IdentityMessageKey> = {
  invite: "identity.invitation.createTitle", edit: "identity.access.editTitle", "revoke-member": "identity.team.revokeTitle",
  transfer: "identity.team.transferTitle", resend: "identity.invitation.resendTitle", "revoke-invite": "identity.invitation.revokeTitle",
};
const submitKeys: Record<TeamAction["kind"], IdentityMessageKey> = {
  invite: "identity.invitation.send", edit: "identity.access.save", "revoke-member": "identity.team.revoke",
  transfer: "identity.team.transfer", resend: "identity.invitation.resend", "revoke-invite": "identity.invitation.revoke",
};
const pendingKeys: Record<TeamAction["kind"], IdentityMessageKey> = {
  invite: "identity.invitation.sending", edit: "identity.access.saving", "revoke-member": "identity.team.revoking",
  transfer: "identity.team.transferring", resend: "identity.invitation.resending", "revoke-invite": "identity.invitation.revoking",
};

export function TeamActionDialog({ action, team, userId, guard, draft, onClose, onChanged, onRefresh }: { action: TeamAction; team: TeamResult; userId: string; guard: IdentityAuthGuard; draft: TeamActionDraft; onClose: () => void; onChanged: (message: IdentityMessageKey) => void; onRefresh: () => Promise<TeamResult | undefined> }) {
  const t = useIdentityTranslations();
  const { locale } = useLocale();
  const formId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const member = "userId" in action ? team.members.find((item) => item.userId === action.userId) : undefined;
  const invitation = "invitationId" in action ? team.invitations.find((item) => item.id === action.invitationId) : undefined;
  const options = action.kind === "edit" && member ? member.allowedActions : team.allowedActions;
  const initialGrant = draft.getSnapshot().initialGrant;
  const [grant, setGrant] = useState(draft.getSnapshot().grant);
  const [email, setEmail] = useState(draft.getSnapshot().email);
  const [emailError, setEmailError] = useState<ReturnType<typeof validateEmail>>();
  const [grantError, setGrantError] = useState(false);
  const [review, setReview] = useState(false);
  const [revision, setRevision] = useState(draft.getSnapshot().revision);
  const [refreshing, setRefreshing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const operation = useIdentityOperation<{ message: IdentityMessageKey }>();
  const intent = draft.intent;
  const changed = revision !== team.workspace.authzVersion || conflict;
  const allowed = action.kind === "invite" ? team.allowedActions.invite : action.kind === "edit" ? member?.allowedActions.update : action.kind === "revoke-member" ? member?.allowedActions.revoke : action.kind === "transfer" ? member?.allowedActions.transfer : action.kind === "resend" ? invitation?.allowedActions.resend : invitation?.allowedActions.revoke;
  const isGrant = action.kind === "invite" || action.kind === "edit";
  const dirty = !operation.pending && !refreshing && isGrant && (Boolean(email) || Boolean(initialGrant && grant && (grant.role !== initialGrant.role || scopeChanges(initialGrant.scopes, grant.scopes).added.length || scopeChanges(initialGrant.scopes, grant.scopes).removed.length)));
  const changes = member && grant ? scopeChanges(member.scopes, grant.scopes) : undefined;
  const Icon = action.kind === "invite" || action.kind === "resend" ? Mail : action.kind === "edit" ? Save : action.kind === "transfer" ? ShieldCheck : action.kind === "revoke-member" ? UserMinus : Trash2;

  async function refresh() {
    if (refreshing || operation.pending) return;
    setRefreshing(true);
    const result = await onRefresh();
    if (result) { draft.update({ revision: result.workspace.authzVersion }); setRevision(result.workspace.authzVersion); setReview(false); setConflict(false); operation.clear(); }
    setRefreshing(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || changed || refreshing || operation.pending) return;
    if (isGrant) {
      const invalidEmail = action.kind === "invite" ? validateEmail(email) : undefined;
      const invalidGrant = !grant || !validGrant(grant, options);
      setEmailError(invalidEmail); setGrantError(invalidGrant);
      if (invalidEmail) { emailInput.current?.focus(); return; }
      if (invalidGrant) { requestAnimationFrame(() => form.current?.querySelector<HTMLSelectElement>('select[name="role"]')?.focus()); return; }
      if (action.kind === "edit" && !review) { setReview(true); return; }
    }
    const result = await operation.run((signal) => guard(signal, async () => {
      try {
      const version = { expectedAuthzVersion: revision };
      const base = { userId, workspaceId: team.workspace.id, action };
      const opts = { signal, expectedUserId: userId };
      if (action.kind === "invite" && grant) {
        const body = CreateInvitationSchema.parse({ ...grant, ...version, email: email.trim(), locale });
        const key = await intent.keyFor({ ...base, body }, signal);
        const response = await identityClient.createInvitation(team.workspace.id, body, key, opts);
        return { message: response.delivery === "sent" ? "identity.invitation.sent" : response.delivery === "uncertain" ? "identity.invitation.deliveryUncertain" : "identity.invitation.deliveryQueued" };
      }
      if (action.kind === "edit" && grant) {
        const body = UpdateMemberSchema.parse({ ...grant, ...version });
        const key = await intent.keyFor({ ...base, body }, signal);
        await identityClient.updateMember(team.workspace.id, action.userId, body, key, opts);
        return { message: "identity.access.saved" };
      }
      if (action.kind === "transfer") {
        const body = { ...version, targetUserId: action.userId };
        await identityClient.transferOwnership(team.workspace.id, body, await intent.keyFor({ ...base, body }, signal), opts);
        return { message: "identity.team.transferred" };
      }
      const key = await intent.keyFor({ ...base, body: version }, signal);
      if (action.kind === "revoke-member") {
        await identityClient.revokeMember(team.workspace.id, action.userId, version, key, opts);
        return { message: "identity.team.revoked" };
      }
      if (action.kind === "resend") {
        const response = await identityClient.resendInvitation(team.workspace.id, action.invitationId, version, key, opts);
        return { message: response.delivery === "sent" ? "identity.invitation.resent" : response.delivery === "uncertain" ? "identity.invitation.deliveryUncertain" : "identity.invitation.deliveryQueued" };
      }
      if (action.kind === "revoke-invite") {
        await identityClient.revokeInvitation(team.workspace.id, action.invitationId, version, key, opts);
        return { message: "identity.invitation.revokedSuccess" };
      }
      throw new Error("Unavailable team action");
      } catch (error) {
        if (!signal.aborted && asIdentityFailure(error).status === 409) setConflict(true);
        throw error;
      }
    }));
    if (result) onChanged(result.message);
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !operation.pending && !refreshing) onClose(); }} title={t(action.kind === "edit" && review ? "identity.access.reviewTitle" : titleKeys[action.kind])} dirty={dirty} onDiscard={() => { draft.update({ email: "", grant: undefined }); setEmail(""); setGrant(undefined); }} initialFocus={isGrant ? undefined : cancel} footer={<>
    <DialogClose ref={cancel} disabled={operation.pending || refreshing}>{t("identity.workspace.cancel")}</DialogClose>
    {review && <Button icon={ArrowLeft} disabled={operation.pending} onClick={() => setReview(false)}>{t("identity.access.back")}</Button>}
    <Button icon={action.kind === "edit" && !review ? ArrowRight : Icon} type="submit" form={formId} variant={isGrant || action.kind === "resend" ? "primary" : "danger"} pending={operation.pending} disabled={!allowed || changed || refreshing}>{t(operation.pending ? pendingKeys[action.kind] : action.kind === "edit" && !review ? "identity.access.review" : submitKeys[action.kind])}</Button>
  </>}>
    <form ref={form} id={formId} className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.contextName}>{team.workspace.name}</p>
      {!allowed && <p role="alert" className={styles.error}>{t("identity.access.restricted")}</p>}
      {member && <PersonIdentity name={member.name} email={member.email} />}
      {invitation && <PersonIdentity email={invitation.email} />}
      {action.kind === "invite" && <InputField ref={emailInput} name="email" label={t("identity.invitation.email")} autoComplete="email" type="email" autoCapitalize="none" required readOnly={operation.pending} value={email} error={emailError ? t(emailError) : operation.failure?.fieldErrors.email ? t(operation.failure.fieldErrors.email) : undefined} onChange={(event) => { draft.update({ email: event.target.value }); setEmail(event.target.value); setEmailError(undefined); operation.clear(); }} />}
      {isGrant && grant && !review && <GrantFields value={grant} options={options} disabled={operation.pending || !allowed} error={grantError ? t("identity.access.invalid") : operation.failure?.fieldErrors.role || operation.failure?.fieldErrors.scopes ? t((operation.failure.fieldErrors.role ?? operation.failure.fieldErrors.scopes)!) : undefined} onChange={(next) => { draft.update({ grant: next }); setGrant(next); setGrantError(false); operation.clear(); }} />}
      {grantError && !grant && <p role="alert" className={styles.error}>{t("identity.access.invalid")}</p>}
      {action.kind === "invite" && <dl className={styles.facts}><dt>{t("identity.invitation.expiresIn")}</dt><dd>{formatUnit(locale, team.allowedActions.invitationTtlSeconds / 86400, "day", { unitDisplay: "long" })}</dd></dl>}
      {action.kind === "edit" && review && member && grant && <div className={styles.stack}>
        <dl className={styles.facts}><dt>{t("identity.access.currentRole")}</dt><dd>{t(roleLabels[member.role])}</dd><dt>{t("identity.access.newRole")}</dt><dd>{t(roleLabels[grant.role])}</dd></dl>
        {!!changes?.added.length && <div><h3 className={styles.minorHeading}>{t("identity.access.granted")}</h3><ScopeList scopes={changes.added} /></div>}
        {!!changes?.removed.length && <div><h3 className={styles.minorHeading}>{t("identity.access.removed")}</h3><ScopeList scopes={changes.removed} /></div>}
        {!changes?.added.length && !changes?.removed.length && <p className={styles.muted}>{t("identity.access.unchanged")}</p>}
      </div>}
      {action.kind === "revoke-member" && member && <p>{t("identity.team.revokeDescription", { name: member.name, workspace: team.workspace.name })}</p>}
      {action.kind === "transfer" && member && <p>{t("identity.team.transferDescription", { name: member.name, workspace: team.workspace.name })}</p>}
      {action.kind === "resend" && invitation && <p>{t("identity.invitation.resendDescription", { email: invitation.email })}</p>}
      {action.kind === "revoke-invite" && invitation && <p>{t("identity.invitation.revokeDescription", { email: invitation.email })}</p>}
      {changed && <div className={styles.stack}><p role="alert">{t("identity.team.memberChanged")}</p><Button icon={RefreshCw} pending={refreshing} onClick={() => { void refresh(); }}>{t("identity.workspace.refresh")}</Button></div>}
      <OperationError failure={operation.failure?.status === 401 ? undefined : operation.failure} />
    </form>
  </Dialog>;
}
