"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FileClock, GitBranch, History, LogIn, RefreshCw, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountMenu, AuthDialog } from "@/features/identity/ui";
import { Button, EmptyState, IconButton, LoadingState, LocaleSelect, ProductHeader, SaveStatus, Tabs, type OptionLoader, type SelectOption, type SaveState } from "@/ui";
import type { ArtifactSnapshot } from "../contracts";
import type { ArtifactOperation } from "../client/operations";
import type { ArtifactOperationResult } from "../client/execute-operation";
import { artifactHistoryHref, confirmedHistoryMove } from "../client/history-location";
import type { ArtifactSession, ArtifactSessionState } from "../client/session";
import type { LocalDraft } from "../client/local-records";
import { artifactClient } from "../client/transport";
import { ArtifactActionDialog, createActionDraft, type ArtifactAction, type ArtifactActionDraft } from "./action-dialog";
import { ArtifactError, useArtifactTranslations } from "./common";
import { ArtifactContentPreview } from "./content-preview";
import { ArtifactHistoryList, ArtifactVersionList } from "./history-list";
import { ArtifactLifecycleMenu } from "./lifecycle-menu";
import { ArtifactRecoveryPanel, ArtifactSignOutGuard } from "./recovery-panel";
import { SourceFreshnessPanel } from "./source-freshness";
import { useArtifactSession } from "./use-artifact-session";
import styles from "./artifacts.module.css";

export { artifactHistoryHref } from "../client/history-location";
type HistoryForm = { action?: ArtifactAction; draft?: ArtifactActionDraft; project: SelectOption | null; reviewedDraft?: LocalDraft };

export function ArtifactHistoryPage({ initial, projectTitle }: { initial: ArtifactSnapshot; projectTitle: string }) {
  const t = useArtifactTranslations();
  const router = useRouter();
  const { state, identity, privateVisible, session, resume, refreshAccount } = useArtifactSession(initial);
  const [authOpen, setAuthOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<unknown>();
  const [form, setForm] = useState<HistoryForm>({ project: null });
  const [location, setLocation] = useState(() => ({ href: artifactHistoryHref(initial.artifact.projectId, initial.artifact.id), revision: initial.artifact.currentRevision }));
  useEffect(() => session.subscribe(() => {
    const { phase, snapshot } = session.getSnapshot();
    if (phase === "access-changed" || phase === "deleted") setForm({ project: null });
    if (phase === "ready" && snapshot && snapshot.artifact.currentRevision > location.revision) {
      const href = artifactHistoryHref(snapshot.artifact.projectId, snapshot.artifact.id);
      setLocation({ href, revision: snapshot.artifact.currentRevision });
      if (href !== location.href) router.replace(href);
    }
  }), [session, router, location]);
  function followMove(operation: ArtifactOperation | undefined, result: ArtifactOperationResult | undefined) {
    const location = confirmedHistoryMove(operation, result);
    if (!location) return false;
    setLocation(location); router.replace(location.href);
    return true;
  }
  async function continueSession() {
    setResuming(true); setError(undefined);
    try { await refreshAccount(); await resume(); } catch (failure) { setError(failure); } finally { setResuming(false); }
  }
  const currentProjectTitle = state.snapshot?.artifact.projectId === initial.artifact.projectId ? projectTitle : form.project && form.project.id === state.snapshot?.artifact.projectId ? form.project.label : t("artifacts.navigation.project");
  if (privateVisible && state.snapshot) return <HistoryWorkspace key={`${initial.viewer.userId}:${identity.authEpoch}`} state={state} session={session} projectTitle={currentProjectTitle} form={form} setForm={setForm} followMove={followMove} />;
  const checking = identity.phase === "checking";
  const accessChanged = identity.phase === "account-changed" || state.phase === "access-changed";
  const deleted = state.phase === "deleted";
  return <div className={styles.page}>
    <ProductHeader homeLabel={t("artifacts.navigation.home")}><LocaleSelect compact /><AccountMenu /></ProductHeader>
    <main className={styles.workspace}>{checking ? <LoadingState /> : <EmptyState
      icon={deleted ? Trash2 : accessChanged ? History : LogIn}
      title={t(deleted ? "artifacts.lifecycle.deleted" : accessChanged ? "artifacts.recovery.access" : "artifacts.recovery.auth")}
      description={!deleted && t(accessChanged ? "artifacts.recovery.accessDescription" : "artifacts.recovery.authDescription")}
      action={<>{!deleted && <Button icon={RefreshCw} pending={resuming} onClick={() => { void continueSession(); }}>{t("artifacts.actions.refresh")}</Button>}{!accessChanged && !deleted && <Button variant="primary" icon={LogIn} onClick={() => setAuthOpen(true)}>{t("artifacts.actions.signIn")}</Button>}{identity.phase === "account-changed" && <Button icon={ArrowRight} onClick={() => router.refresh()}>{t("artifacts.page.openForAccount")}</Button>}<Link href="/app/work" className="tl-button tl-button--secondary">{t("artifacts.navigation.work")}</Link></>}
    />}<ArtifactError error={error ?? state.storageError} /></main>
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={location.href} onAuthenticated={() => { void continueSession(); }} />
  </div>;
}
function saveState(state: ArtifactSessionState): SaveState | null {
  if (state.operation.phase === "pending" || state.autosave?.status === "saving") return "saving";
  if (state.autosave?.status === "conflict" || state.operation.phase === "rejected") return "conflict";
  if (state.operation.operation || state.autosave?.status === "uncertain" || state.autosave?.status === "failed") return "unsaved";
  if (state.drafts.length || state.pending.length) return state.autosave?.locallyPersisted ? "local" : "unsaved";
  return state.storageError ? "unsaved" : null;
}

function HistoryWorkspace({ state, session, projectTitle, form, setForm, followMove }: { state: ArtifactSessionState; session: ArtifactSession; projectTitle: string; form: HistoryForm; setForm: React.Dispatch<React.SetStateAction<HistoryForm>>; followMove: (operation: ArtifactOperation | undefined, result: ArtifactOperationResult | undefined) => boolean }) {
  const t = useArtifactTranslations();
  const router = useRouter();
  const snapshot = state.snapshot!;
  const [tab, setTab] = useState("versions");
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const sameAuthority = form.action?.snapshot.viewer.authzVersion === snapshot.viewer.authzVersion;
  const action = sameAuthority ? form.action : undefined;
  const actionDraft = form.draft;
  const project = sameAuthority ? form.project : null;
  const reviewedDraft = sameAuthority ? form.reviewedDraft : undefined;
  const setAction = (action?: ArtifactAction) => setForm((previous) => ({ ...previous, action }));
  const setActionDraft = (draft?: ArtifactActionDraft) => setForm((previous) => ({ ...previous, draft }));
  const setProject = (project: SelectOption | null) => setForm((previous) => ({ ...previous, project }));
  const setReviewedDraft = (reviewedDraft?: LocalDraft) => setForm((previous) => ({ ...previous, reviewedDraft }));
  const [error, setError] = useState<unknown>();
  const [preparing, setPreparing] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [exitDecision, setExitDecision] = useState<((proceed: boolean) => void)>();
  const exitResolver = useRef<((proceed: boolean) => void) | undefined>(undefined);
  const mounted = useRef(true);
  const hasRecovery = state.drafts.length > 0 || state.pending.length > 0;
  const busy = state.loading || preparing || state.operation.phase === "pending" || state.autosave?.status === "saving";
  const canAct = state.storageReady && !busy && !hasRecovery && !state.operation.operation;
  const selected = state.selectedVersion;
  const preview = selected ?? snapshot;
  const group = snapshot.history.find((entry) => entry.commandGroupId === selectedGroup) ?? snapshot.history[0];
  const currentSaveState = saveState(state);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; exitResolver.current?.(false); };
  }, []);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>, failures = 0;
    const tick = async () => {
      let active = false;
      try { if (document.visibilityState === "visible") active = await session.pollEvents(); failures = 0; }
      catch { failures += 1; }
      if (!stopped) timer = setTimeout(() => { void tick(); }, failures ? Math.min(60000, 3000 * 2 ** failures) + Math.random() * 1000 : active ? 3000 : 15000);
    };
    timer = setTimeout(() => { void tick(); }, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session]);
  useEffect(() => {
    if (!hasRecovery && !state.operation.operation && !action) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasRecovery, state.operation.operation, action]);

  const handle = (job: () => Promise<unknown>) => { setError(undefined); void job().catch((failure) => { if (mounted.current) setError(failure); }); };
  const loadProjects = useCallback<OptionLoader>(async (query, signal) => {
    const current = session.getSnapshot();
    if (current.phase !== "ready" || !current.snapshot) return [];
    try {
      const page = await artifactClient.projects({ viewer: current.snapshot.viewer, signal }, { query });
      if (session.getSnapshot().phase !== "ready" || session.getSnapshot().snapshot?.viewer.authzVersion !== current.snapshot.viewer.authzVersion) return [];
      return page.projects.map((entry) => ({ id: entry.id, label: entry.title }));
    } catch (failure) { if (!signal.aborted) await session.refresh(); throw failure; }
  }, [session]);

  function openAction(kind: Exclude<ArtifactOperation["kind"], "undo" | "redo">, local?: LocalDraft) {
    const next: ArtifactAction = { kind, snapshot, ...(selected ? { version: selected } : {}), ...(local ? { localContent: local.content, localParentRevision: local.baseRevision } : {}) };
    setAction(next); setReviewedDraft(local); setError(undefined);
    setProject({ id: snapshot.artifact.projectId, label: projectTitle });
    setActionDraft(createActionDraft(next, kind === "branch" ? t("artifacts.versions.branchDefault", { title: snapshot.artifact.title }) : kind === "duplicate" ? t("artifacts.versions.copyDefault", { title: snapshot.artifact.title }) : undefined));
  }
  async function openHistory(kind: "undo" | "redo") {
    if (!group) return;
    setPreparing(true);
    try {
      const checked = await session.prepareHistory(kind, group.commandGroupId);
      if (!mounted.current) return;
      const next = { kind, snapshot: session.getSnapshot().snapshot!, ...checked };
      setAction(next); setReviewedDraft(undefined); setActionDraft(createActionDraft(next));
    } finally { if (mounted.current) setPreparing(false); }
  }
  async function run(operation: ArtifactOperation) {
    const result = reviewedDraft ? await session.branchReviewedDraft(operation, reviewedDraft) : await session.run(operation);
    const moved = followMove(operation, result);
    if (result && mounted.current) { setAction(undefined); setActionDraft(undefined); if (!moved) await session.loadVersions(); }
  }
  async function retryOperation() {
    const operation = session.getSnapshot().operation.operation;
    const result = await session.retryOperation();
    const moved = followMove(operation, result);
    if (result && mounted.current) { setAction(undefined); setActionDraft(undefined); if (!moved) await session.loadVersions(); }
  }
  async function beforeSignOut() {
    if (!hasRecovery && !state.operation.operation) return true;
    return new Promise<boolean>((resolve) => { exitResolver.current = resolve; setExitDecision(() => resolve); });
  }
  function finishExit(proceed: boolean) { exitResolver.current?.(proceed); exitResolver.current = undefined; setExitDecision(undefined); }
  async function signedOut() { if (await session.confirmedSignedOut()) { router.replace("/sign-in"); router.refresh(); } }

  return <div className={styles.page}>
    <ProductHeader homeLabel={t("artifacts.navigation.home")}><LocaleSelect compact /><AccountMenu beforeSignOut={beforeSignOut} onSignedOut={() => { void signedOut(); }} /></ProductHeader>
    <main className={styles.workspace}>
      <nav className={styles.breadcrumb} aria-label={t("artifacts.navigation.history")}><Link href={`/app/projects/${snapshot.artifact.projectId}/artifacts/${snapshot.artifact.id}`}><ArrowLeft size={17} aria-hidden="true" />{t("artifacts.navigation.material")}</Link><Link href={`/app/projects/${snapshot.artifact.projectId}`}>{projectTitle}</Link><span>{t("artifacts.navigation.history")}</span></nav>
      <header className={styles.heading}><div><h1>{snapshot.artifact.title}</h1><p className={styles.meta}>{t(`artifacts.kinds.${snapshot.artifact.kind}`)}<span className={styles.tag}>{t(`artifacts.statuses.${snapshot.artifact.status}`)}</span></p></div><div className={styles.actions}>{currentSaveState && <SaveStatus state={currentSaveState} />}<IconButton icon={RefreshCw} label={t("artifacts.actions.refresh")} disabled={busy} onClick={() => handle(async () => { await session.refresh(); await session.loadVersions(); })} /><ArtifactLifecycleMenu snapshot={snapshot} disabled={!canAct} onAction={openAction} /></div></header>
      <ArtifactError error={error ?? state.error ?? state.storageError} />
      {state.createdArtifact && <p role="status" className={styles.success}><span>{t("artifacts.page.createdVariant")}</span><Link href={artifactHistoryHref(state.createdArtifact.projectId, state.createdArtifact.id)}>{state.createdArtifact.title}<ArrowRight size={17} aria-hidden="true" /></Link></p>}
      {state.operation.operation && !action && <div className={styles.recoveryBar}><div><strong>{t(state.operation.phase === "rejected" ? "artifacts.errors.conflict" : "artifacts.recovery.uncertain")}</strong><ArtifactError error={state.operation.error} /></div>{state.operation.phase === "rejected" ? <Button icon={RefreshCw} disabled={busy} onClick={() => handle(async () => { await session.dismissRejected(); })}>{t("artifacts.actions.refresh")}</Button> : <Button icon={RotateCw} pending={state.operation.phase === "pending"} onClick={() => handle(retryOperation)}>{t("artifacts.actions.retry")}</Button>}</div>}
      {hasRecovery && <div className={styles.recoveryBar}><div><strong>{t("artifacts.recovery.title")}</strong><p>{t("artifacts.recovery.description")}</p></div><Button icon={History} onClick={() => setShowRecovery(!showRecovery)}>{t(showRecovery ? "artifacts.actions.close" : "artifacts.actions.review")}</Button>{state.pending.length > 0 && state.pending[0]?.state !== "conflict" && <Button icon={RotateCw} disabled={busy} onClick={() => handle(() => session.retrySave())}>{t("artifacts.actions.retry")}</Button>}</div>}
      {showRecovery && hasRecovery ? <ArtifactRecoveryPanel state={state} session={session} onBranch={(draft) => openAction("branch", draft)} /> : <div className={styles.historyLayout}>
        <aside className={styles.historyRail}><Tabs label={t("artifacts.history.title")} value={tab} onChange={setTab} items={[
          { id: "versions", label: t("artifacts.history.versions"), content: <><ArtifactVersionList versions={state.versions} selectedRevision={state.selectedRevision} currentRevision={snapshot.artifact.currentRevision} onSelect={(revision) => handle(() => session.selectVersion(revision))} />{state.versionsLoading && <LoadingState />}{state.nextBeforeRevision !== null && <Button disabled={state.versionsLoading} onClick={() => handle(() => session.loadVersions(true))}>{t("artifacts.actions.loadMore")}</Button>}</> },
          { id: "changes", label: t("artifacts.history.changes"), content: <><ArtifactHistoryList history={{ viewer: snapshot.viewer, artifactId: snapshot.artifact.id, cursor: snapshot.cursor, groups: snapshot.history }} selectedId={group?.commandGroupId} onSelect={setSelectedGroup} /><p className={styles.meta}>{t("artifacts.history.recent")}</p>{group && <div className={styles.groupActions}><IconButton icon={RotateCcw} label={t("artifacts.history.undo")} disabled={!canAct || !group.canUndo} onClick={() => handle(() => openHistory("undo"))} /><IconButton icon={RotateCw} label={t("artifacts.history.redo")} disabled={!canAct || !group.canRedo} onClick={() => handle(() => openHistory("redo"))} /><span>{t(group.state === "undone" ? "artifacts.history.undone" : "artifacts.history.active")}</span></div>}</> },
        ]} /></aside>
        <section className={styles.material} aria-label={t("artifacts.versions.readOnly")}><div className={styles.previewToolbar}><div><h2>{t("artifacts.versions.version", { revision: preview.version.revision })}</h2><p className={styles.meta}>{preview.version.reason}</p></div><div className={styles.actions}>{state.selectedRevision !== undefined && <Button icon={FileClock} onClick={() => handle(() => session.selectVersion())}>{t("artifacts.versions.current")}</Button>}{snapshot.permissions.duplicate && <Button icon={GitBranch} disabled={!canAct || state.versionLoading} onClick={() => openAction("branch")}>{t("artifacts.versions.branch")}</Button>}{selected && selected.version.revision !== snapshot.artifact.currentRevision && snapshot.permissions.edit && <Button icon={Undo2} variant="primary" disabled={!canAct} onClick={() => openAction("restore-version")}>{t("artifacts.versions.restore")}</Button>}</div></div>
          {state.versionLoading ? <LoadingState /> : <><ArtifactContentPreview content={preview.content} contentKey={`${preview.artifact.id}:${preview.version.revision}`} /><SourceFreshnessPanel snapshot={preview} /></>}
        </section>
      </div>}
    </main>
    {action && actionDraft && <ArtifactActionDialog key={`${action.kind}:${action.snapshot.artifact.currentRevision}`} action={action} draft={actionDraft} onDraftChange={setActionDraft} onClose={() => { setAction(undefined); setActionDraft(undefined); }} onRun={(operation) => handle(() => run(operation))} onRetry={() => handle(retryOperation)} onRefresh={() => handle(async () => { await session.dismissRejected(); setAction(undefined); setActionDraft(undefined); })} operation={state.operation} project={project} onProjectChange={setProject} loadProjects={loadProjects} />}
    {exitDecision && <ArtifactSignOutGuard state={state} session={session} onDecision={finishExit} />}
  </div>;
}
