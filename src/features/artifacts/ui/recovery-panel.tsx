"use client";

import Link from "next/link";
import { ArrowRight, GitBranch, LogOut, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogClose, LoadingState, SelectField } from "@/ui";
import type { ArtifactSnapshot } from "../contracts";
import type { LocalDraft, PendingCommand } from "../client/local-records";
import type { ArtifactSession, ArtifactSessionState } from "../client/session";
import { ArtifactContentPreview } from "./content-preview";
import { ArtifactError, useArtifactTranslations } from "./common";
import styles from "./artifacts.module.css";

const draftKey = (draft: LocalDraft) => `${draft.artifactId}:${draft.generation}:${draft.updatedAt}`;

export function ArtifactRecoveryPanel({ state, session, onBranch }: { state: ArtifactSessionState; session: ArtifactSession; onBranch: (draft: LocalDraft) => void }) {
  const t = useArtifactTranslations();
  const snapshot = state.snapshot!;
  const [selectedId, setSelectedId] = useState(snapshot.artifact.id);
  const [comparison, setComparison] = useState<ArtifactSnapshot>();
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [discard, setDiscard] = useState<{ drafts: LocalDraft[]; pending: PendingCommand[] }>();
  const [discarding, setDiscarding] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const selected = state.drafts.find((draft) => draft.artifactId === selectedId) ?? state.drafts[0];
  const selectedKey = selected && draftKey(selected);
  const id = selected?.artifactId;
  const loaded = comparison?.artifact.id === id ? comparison : undefined;
  const remaining = state.drafts.filter((draft) => !reviewed.has(draftKey(draft))).length;
  const uncertain = state.pending.some((record) => record.state !== "conflict") || Boolean(state.operation.operation);

  useEffect(() => {
    if (!id || !selectedKey) return;
    let stopped = false;
    const load = async () => {
      setLoading(true); setError(undefined);
      try {
        const result = await session.readRecoveryArtifact(id);
        if (!stopped) { setComparison(result); setReviewed((previous) => new Set([...previous, selectedKey])); }
      } catch (failure) { if (!stopped) setError(failure); }
      finally { if (!stopped) setLoading(false); }
    };
    void load();
    return () => { stopped = true; };
  }, [id, selectedKey, session]);

  const label = (draft: LocalDraft, index: number) => draft.artifactId === snapshot.artifact.id ? snapshot.artifact.title
    : snapshot.history.flatMap((group) => group.artifacts).find((item) => item.artifactId === draft.artifactId)?.title ?? t("artifacts.page.relatedMaterial", { number: index + 1 });
  async function discardConfirmed() {
    if (!discard) return;
    setDiscarding(true); setError(undefined);
    try { if (await session.discardReviewed(discard)) setDiscard(undefined); }
    catch (failure) { setError(failure); }
    finally { setDiscarding(false); }
  }
  return <section className={styles.recovery} aria-label={t("artifacts.recovery.title")}>
    {state.drafts.length > 1 && <SelectField label={t("artifacts.page.compareMaterial")} value={selected?.artifactId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{state.drafts.map((draft, index) => <option key={draft.artifactId} value={draft.artifactId}>{label(draft, index)}</option>)}</SelectField>}
    <ArtifactError error={error} />
    {selected && <><p className={styles.meta}>{t("artifacts.recovery.base", { revision: selected.baseRevision })}</p><div className={styles.comparison}>
      <section><h2>{t("artifacts.recovery.local")}</h2><ArtifactContentPreview content={selected.content} contentKey={draftKey(selected)} /></section>
      <section><h2>{t("artifacts.recovery.server")}</h2>{loading ? <LoadingState /> : loaded && <ArtifactContentPreview content={loaded.content} contentKey={`${loaded.artifact.id}:${loaded.artifact.currentRevision}`} />}</section>
    </div></>}
    {state.pending.length > 0 && <ul className={styles.pendingList}>{state.pending.map((record) => <li key={record.group.commandGroupId}>{record.group.commands.map((command) => command.reason).join("; ")}</li>)}</ul>}
    <div className={styles.actions}>
      {selected?.artifactId === snapshot.artifact.id && snapshot.permissions.duplicate && <Button variant="primary" icon={GitBranch} disabled={uncertain || loading || !loaded || !state.storageReady} onClick={() => onBranch(selected)}>{t("artifacts.recovery.separate")}</Button>}
      {selected && loaded && selected.artifactId !== snapshot.artifact.id && <Link className="tl-button tl-button--secondary" href={`/app/projects/${loaded.artifact.projectId}/artifacts/${loaded.artifact.id}/history`}>{t("artifacts.navigation.history")}<ArrowRight size={18} aria-hidden="true" /></Link>}
      <Button icon={Trash2} disabled={uncertain || remaining > 0 || !state.storageReady} onClick={() => setDiscard({ drafts: structuredClone(state.drafts), pending: structuredClone(state.pending) })}>{t("artifacts.recovery.useServer")}</Button>
      {remaining > 0 && <span className={styles.meta}>{t("artifacts.page.reviewRemaining", { count: remaining })}</span>}
    </div>
    {uncertain && <p className={styles.notice}>{t("artifacts.recovery.blocked")}</p>}
    <Dialog open={Boolean(discard)} onOpenChange={(open) => { if (!open && !discarding) setDiscard(undefined); }} title={t("artifacts.recovery.discardTitle")} description={t("artifacts.recovery.discardDescription")} initialFocus={cancel} footer={<><DialogClose ref={cancel} disabled={discarding}>{t("artifacts.actions.cancel")}</DialogClose><Button icon={Trash2} variant="danger" pending={discarding} onClick={() => { void discardConfirmed(); }}>{t("artifacts.actions.discard")}</Button></>}><ul className={styles.affected}>{discard?.drafts.map((draft, index) => <li key={draft.artifactId}>{label(draft, index)}</li>)}</ul><ArtifactError error={error} /></Dialog>
  </section>;
}

export function ArtifactSignOutGuard({ state, session, onDecision }: { state: ArtifactSessionState; session: ArtifactSession; onDecision: (proceed: boolean) => void }) {
  const t = useArtifactTranslations();
  const cancel = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  async function save() {
    setSaving(true); setError(undefined);
    try {
      if (state.operation.operation) await session.retryOperation();
      if (state.pending.length) await session.retrySave();
      if (await session.flush()) onDecision(true);
      else setError(new Error("artifacts.errors.pending"));
    } catch (failure) { setError(failure); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onDecision(false); }} title={t("artifacts.recovery.signOutTitle")} description={t("artifacts.recovery.signOutDescription")} initialFocus={cancel} footer={<><DialogClose ref={cancel} disabled={saving}>{t("artifacts.actions.cancel")}</DialogClose><Button icon={LogOut} variant="danger" disabled={saving} onClick={() => onDecision(true)}>{t("artifacts.recovery.discardAndExit")}</Button><Button icon={Save} variant="primary" pending={saving} onClick={() => { void save(); }}>{t("artifacts.recovery.saveAndExit")}</Button></>}><ArtifactError error={error} /></Dialog>;
}
