"use client";

import { Archive, Copy, GitBranch, MoveRight, PencilLine, RefreshCw, RotateCcw, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Combobox, Dialog, DialogClose, InputField, TextareaField, type OptionLoader, type SelectOption } from "@/ui";
import type { ArtifactHistoryGroup, ArtifactSnapshot, ArtifactVersionDetail } from "../contracts";
import { ArtifactOperationSchema, type ArtifactOperation, type OperationSnapshot } from "../client/operations";
import type { ArtifactMessageKey } from "../locales";
import { ArtifactError, useArtifactTranslations } from "./common";
import styles from "./artifacts.module.css";

type LifecycleKind = Exclude<ArtifactOperation["kind"], "undo" | "redo">;
export type ArtifactAction = { kind: LifecycleKind; snapshot: ArtifactSnapshot; version?: ArtifactVersionDetail; localContent?: ArtifactSnapshot["content"]; localParentRevision?: number }
  | { kind: "undo" | "redo"; snapshot: ArtifactSnapshot; group: ArtifactHistoryGroup; operation: ArtifactOperation };
export type ArtifactActionDraft = { title: string; projectId: string; reason: string; confirmationTitle: string };
export type ArtifactProjectOption = { id: string; title: string };

const actionKeys: Record<ArtifactOperation["kind"], ArtifactMessageKey> = {
  undo: "artifacts.history.undo", redo: "artifacts.history.redo", rename: "artifacts.actions.rename", move: "artifacts.actions.move", archive: "artifacts.actions.archive", trash: "artifacts.actions.trash", restore: "artifacts.actions.restore", duplicate: "artifacts.actions.duplicate", branch: "artifacts.versions.branch", "restore-version": "artifacts.versions.restore", purge: "artifacts.actions.purge",
};
const icons = { undo: RotateCcw, redo: RotateCw, rename: PencilLine, move: MoveRight, archive: Archive, trash: Trash2, restore: Undo2, duplicate: Copy, branch: GitBranch, "restore-version": Save, purge: Trash2 };

export function createActionDraft(action: ArtifactAction, defaultTitle?: string): ArtifactActionDraft {
  return { title: defaultTitle ?? action.snapshot.artifact.title, projectId: action.snapshot.artifact.projectId, reason: "", confirmationTitle: "" };
}

export function buildArtifactOperation(action: ArtifactAction, draft: ArtifactActionDraft, createId = () => crypto.randomUUID()): ArtifactOperation {
  if (action.kind === "undo" || action.kind === "redo") return ArtifactOperationSchema.parse(action.operation);
  const artifact = action.snapshot.artifact;
  const body = { workspaceId: artifact.workspaceId, expectedAuthzVersion: action.snapshot.viewer.authzVersion, baseRevision: artifact.currentRevision };
  const base = { operationId: createId(), artifactId: artifact.id, createdAt: new Date().toISOString(), state: "ready" as const };
  switch (action.kind) {
    case "rename": return ArtifactOperationSchema.parse({ ...base, kind: action.kind, body: { ...body, title: draft.title.trim() } });
    case "move": return ArtifactOperationSchema.parse({ ...base, kind: action.kind, body: { ...body, projectId: draft.projectId } });
    case "duplicate": return ArtifactOperationSchema.parse({ ...base, kind: action.kind, expectedKind: artifact.kind, body: { ...body, title: draft.title.trim(), projectId: draft.projectId, revision: action.version?.version.revision ?? artifact.currentRevision } });
    case "branch": return ArtifactOperationSchema.parse({ ...base, kind: action.kind, expectedKind: artifact.kind, body: { ...body, title: draft.title.trim(), projectId: draft.projectId, parentRevision: action.localParentRevision ?? action.version?.version.revision ?? artifact.currentRevision, ...(action.localContent ? { content: action.localContent } : {}) } });
    case "restore-version": return ArtifactOperationSchema.parse({ ...base, kind: action.kind, body: { ...body, revision: action.version?.version.revision ?? artifact.currentRevision, reason: draft.reason.trim() } });
    case "purge": return ArtifactOperationSchema.parse({ ...base, kind: action.kind, body: { ...body, confirmationTitle: draft.confirmationTitle, immediate: true } });
    default: return ArtifactOperationSchema.parse({ ...base, kind: action.kind, body });
  }
}

export function ArtifactActionDialog({ action, draft, onDraftChange, onClose, onRun, onRetry, onRefresh, operation, project, onProjectChange, loadProjects }: {
  action: ArtifactAction; draft: ArtifactActionDraft; onDraftChange: (draft: ArtifactActionDraft) => void;
  onClose: () => void; onRun: (operation: ArtifactOperation) => void; onRetry: () => void; onRefresh: () => void;
  operation: OperationSnapshot; project: SelectOption | null; onProjectChange: (project: SelectOption | null) => void; loadProjects: OptionLoader;
}) {
  const t = useArtifactTranslations();
  const cancel = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ArtifactActionDraft, ArtifactMessageKey>>>({});
  const [initial] = useState(draft);
  const pending = operation.phase === "pending";
  const uncertain = Boolean(operation.operation) && operation.phase !== "rejected" && operation.phase !== "idle";
  const nameNeeded = ["rename", "duplicate", "branch"].includes(action.kind);
  const projectNeeded = ["move", "duplicate", "branch"].includes(action.kind);
  const dirty = Object.keys(initial).some((key) => initial[key as keyof ArtifactActionDraft] !== draft[key as keyof ArtifactActionDraft]);
  const revision = "version" in action ? action.version?.version.revision ?? action.snapshot.artifact.currentRevision : action.snapshot.artifact.currentRevision;
  const title = action.kind === "undo" || action.kind === "redo" ? t(`artifacts.history.${action.kind}Title`)
    : action.kind === "restore-version" ? t("artifacts.versions.restoreTitle", { revision })
    : action.kind === "branch" ? t("artifacts.versions.branchTitle")
    : ["archive", "trash", "restore", "purge"].includes(action.kind) ? t(`artifacts.lifecycle.${action.kind}Title` as ArtifactMessageKey)
    : t(actionKeys[action.kind]);
  const description = action.kind === "undo" || action.kind === "redo" ? t("artifacts.history.checked")
    : action.kind === "restore-version" ? t("artifacts.versions.restoreDescription")
    : action.kind === "branch" ? t("artifacts.versions.branchDescription")
    : ["archive", "trash", "restore", "purge"].includes(action.kind) ? t(`artifacts.lifecycle.${action.kind}Description` as ArtifactMessageKey) : undefined;
  function change(key: keyof ArtifactActionDraft, value: string) { onDraftChange({ ...draft, [key]: value }); setErrors((previous) => ({ ...previous, [key]: undefined })); }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || uncertain) return;
    const next: typeof errors = {};
    if (nameNeeded && (!draft.title.trim() || draft.title.trim().length > 240)) next.title = "artifacts.lifecycle.titleRequired";
    if (action.kind === "restore-version" && (!draft.reason.trim() || draft.reason.trim().length > 1000)) next.reason = "artifacts.lifecycle.reasonRequired";
    if (action.kind === "purge" && draft.confirmationTitle !== action.snapshot.artifact.title) next.confirmationTitle = "artifacts.lifecycle.confirmationMismatch";
    if (projectNeeded && (!project || project.id !== draft.projectId)) next.projectId = "artifacts.lifecycle.noProjects";
    setErrors(next);
    if (Object.keys(next).length) { queueMicrotask(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    onRun(buildArtifactOperation(action, draft));
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }} title={title} description={description} initialFocus={cancel} dirty={dirty && !pending && !uncertain} onDiscard={() => onDraftChange(initial)} footer={<><DialogClose ref={cancel} disabled={pending}>{t("artifacts.actions.cancel")}</DialogClose>{operation.phase === "rejected" ? <Button icon={RefreshCw} onClick={onRefresh}>{t("artifacts.actions.refresh")}</Button> : uncertain && !pending ? <Button icon={RotateCw} variant="primary" onClick={onRetry}>{t("artifacts.actions.retry")}</Button> : <Button icon={icons[action.kind]} variant={action.kind === "purge" || action.kind === "trash" ? "danger" : "primary"} pending={pending} pendingLabel={t("artifacts.history.saving")} onClick={() => form.current?.requestSubmit()}>{t(actionKeys[action.kind])}</Button>}</>}>
    <form ref={form} onSubmit={submit} className={styles.stack} noValidate>
      <p className={styles.dialogMaterial}>{action.snapshot.artifact.title}</p>
      {(action.kind === "undo" || action.kind === "redo") && <div><h3 className={styles.sectionHeading}>{t("artifacts.history.affected")}</h3><ul className={styles.affected}>{action.group.artifacts.map((artifact) => <li key={artifact.artifactId}>{artifact.title}<span className={styles.meta}>{t("artifacts.versions.version", { revision: artifact.currentRevision })}</span></li>)}</ul>{action.group.hasUnavailableArtifacts && <p>{t("artifacts.history.unavailable")}</p>}</div>}
      <fieldset className={styles.fields} disabled={pending || uncertain}>
        {nameNeeded && <InputField label={t("artifacts.fields.title")} name="title" value={draft.title} onChange={(event) => change("title", event.target.value)} maxLength={240} required error={errors.title ? t(errors.title) : undefined} />}
        {projectNeeded && <Combobox label={t("artifacts.fields.project")} name="projectId" value={project} onChange={(option) => { onProjectChange(option); change("projectId", option?.id ?? ""); }} required loadOptions={loadProjects} disabled={pending || uncertain} error={errors.projectId ? t(errors.projectId) : undefined} />}
        {action.kind === "restore-version" && <TextareaField label={t("artifacts.fields.reason")} name="reason" value={draft.reason} onChange={(event) => change("reason", event.target.value)} maxLength={1000} required error={errors.reason ? t(errors.reason) : undefined} />}
        {action.kind === "purge" && <InputField label={t("artifacts.fields.confirmation")} name="confirmationTitle" value={draft.confirmationTitle} onChange={(event) => change("confirmationTitle", event.target.value)} autoComplete="off" required error={errors.confirmationTitle ? t(errors.confirmationTitle) : undefined} />}
      </fieldset>
      {uncertain && !pending && <p className={styles.notice}>{t("artifacts.recovery.uncertain")}</p>}
      <ArtifactError error={operation.error} />
    </form>
  </Dialog>;
}
