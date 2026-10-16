'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileClock, FileText, FolderOpen, LogIn, RefreshCw } from 'lucide-react';
import { Component, useCallback, useEffect, useRef, useState, type MouseEventHandler, type ReactNode } from 'react';
import { useLocale } from '@/i18n/provider';
import { AuthDialog } from '@/features/identity/ui';
import type { ArtifactListResult, ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { Run } from '@/contracts/runs';
import { useArtifactSession } from '@/features/artifacts/ui/use-artifact-session';
import { requireTable } from '@/features/sheets/domain/model';
import { ExportPanel, type ExportBundleItem, type ExportPanelTransport } from '@/features/exports/client/ExportPanel';
import { ChangeReviewPanel } from '@/features/change-review';
import { ArtifactError } from '@/features/artifacts/ui/common';
import { ArtifactSignOutGuard } from '@/features/artifacts/ui/recovery-panel';
import { SourceFreshnessPanel } from '@/features/artifacts/ui/source-freshness';
import { artifactClient, type ArtifactClient } from '@/features/artifacts/client/transport';
import { Button, Dialog, EmptyState, LoadingState, SaveStatus, type OptionLoader, type SelectOption } from '@/ui';
import { WorkspaceShell, useWorkspaceCopy } from './shell';
import styles from './workspace.module.css';
import { workspaceClient } from '../client/transport';
import { TourGuide } from '@/features/onboarding/tour';
import { AssistantSession } from '@/features/runs/ui/assistant-session';
import { sessionResults } from '@/features/runs/ui/session-state';
import { ArtifactLifecycleMenu, type ArtifactLifecycleKind } from '@/features/artifacts/ui/lifecycle-menu';
import { ArtifactActionDialog, createActionDraft, type ArtifactAction, type ArtifactActionDraft } from '@/features/artifacts/ui/action-dialog';
import { useArtifactTranslations } from '@/features/artifacts/ui/common';
import type { ArtifactOperation } from '@/features/artifacts/client/operations';
import type { ArtifactOperationResult } from '@/features/artifacts/client/execute-operation';
import type { ArtifactCacheOptions } from '@/features/artifacts/client/indexed-db';
import type { OperationsClient } from '@/features/operations/client/transport';
import { ArtifactThread } from '@/features/collaboration/ui/artifact-thread';

export type ArtifactWorkspaceCapabilities = {
  shell: boolean;
  navigation: boolean;
  rail: boolean;
  recordView: boolean;
  events: boolean;
  assistant: boolean;
  review: boolean;
  export: boolean;
  lifecycle: boolean;
  tour: boolean;
  sourceFreshness: boolean;
  collaboration: boolean;
};

export type ArtifactWorkspaceTransport = {
  artifacts: ArtifactClient;
  exports?: ExportPanelTransport;
  cache?: ArtifactCacheOptions;
  operations?: OperationsClient;
};

export type ArtifactWorkspacePageProps = {
  initial: ArtifactSnapshot;
  projectTitle: string;
  initialRunId?: string;
  mode?: 'authenticated' | 'scoped';
  transport?: ArtifactWorkspaceTransport;
  capabilities?: Partial<ArtifactWorkspaceCapabilities>;
};

function EditorLoading() { const t = useWorkspaceCopy(); return <LoadingState label={t.loadingEditor} />; }
const DocumentEditor = dynamic(() => import('@/features/documents/ui/document-editor').then((module) => module.DocumentEditor), { ssr: false, loading: EditorLoading });
const SheetEditor = dynamic(() => import('@/features/sheets/ui').then((module) => module.SheetEditor), { ssr: false, loading: EditorLoading });
const DesignEditor = dynamic(() => import('@/features/designs/ui/design-editor').then((module) => module.DesignEditor), { ssr: false, loading: EditorLoading });
const PlanEditor = dynamic(() => import('@/features/operations').then((module) => module.PlanEditor), { ssr: false, loading: EditorLoading });

class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function ArtifactWorkspacePage({ initial, projectTitle, initialRunId, mode = 'authenticated', transport, capabilities: capabilityOverrides }: ArtifactWorkspacePageProps) {
  const t = useWorkspaceCopy(), artifactText = useArtifactTranslations(), router = useRouter(), { locale } = useLocale();
  const scoped = mode === 'scoped';
  const client = transport?.artifacts ?? artifactClient;
  const capabilities: ArtifactWorkspaceCapabilities = {
    shell: !scoped,
    navigation: !scoped,
    rail: !scoped,
    recordView: !scoped,
    events: true,
    assistant: !scoped,
    review: !scoped,
    export: !scoped || Boolean(transport?.exports),
    lifecycle: !scoped,
    tour: !scoped,
    sourceFreshness: !scoped,
    collaboration: !scoped,
    ...capabilityOverrides,
  };
  const { state, identity, privateVisible, session, resume, refreshAccount } = useArtifactSession(initial, { client, identity: scoped ? 'scoped' : 'account', cache: transport?.cache });
  const [authOpen, setAuthOpen] = useState(false), [resuming, setResuming] = useState(false), [error, setError] = useState<unknown>();
  const [rail, setRail] = useState<ArtifactListResult>();
  const [railAfter, setRailAfter] = useState<string>(), [railReload, setRailReload] = useState(0), [railLoading, setRailLoading] = useState(false);
  const [railOpen, setRailOpen] = useState(false), [railError, setRailError] = useState<unknown>();
  const [exitPending, setExitPending] = useState(false);
  const [activeRunId, setActiveRunId] = useState(initialRunId), [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [assistantRun, setAssistantRun] = useState<Run>();
  const [mobileView, setMobileView] = useState<'assistant' | 'result'>('result');
  const [wasPrivate, setWasPrivate] = useState(privateVisible);
  const [lifecycleAction, setLifecycleAction] = useState<ArtifactAction>();
  const [lifecycleDraft, setLifecycleDraft] = useState<ArtifactActionDraft>();
  const [lifecycleProject, setLifecycleProject] = useState<SelectOption | null>(null);
  const [lifecyclePreparing, setLifecyclePreparing] = useState(false);
  const exitResolver = useRef<((proceed: boolean) => void) | undefined>(undefined);
  const editorFlush = useRef<(() => Promise<boolean>) | null>(null);
  const registerEditorFlush = useCallback((flush: (() => Promise<boolean>) | null) => { editorFlush.current = flush; }, []);
  const railSerial = useRef(0);
  const activeRunRef = useRef(initialRunId);
  const snapshot = state.snapshot;
  const viewer = snapshot?.viewer;
  const viewerUserId = viewer?.userId, viewerWorkspaceId = viewer?.workspaceId, viewerAuthzVersion = viewer?.authzVersion;
  const visibleRail = rail?.viewer.userId === viewerUserId && rail?.viewer.workspaceId === viewerWorkspaceId && rail?.viewer.authzVersion === viewerAuthzVersion ? rail : undefined;
  const runArtifactRefs = assistantRun ? sessionResults(assistantRun).filter((result) => result.kind === 'artifact') : [];
  const exportBundle: ExportBundleItem[] = visibleRail && assistantRun?.projectId === initial.artifact.projectId ? (['document', 'table'] as const).flatMap((kind): ExportBundleItem[] => {
    const summary = visibleRail.artifacts.find((artifact) => artifact.kind === kind && runArtifactRefs.some((result) => result.id === artifact.id));
    const result = summary && runArtifactRefs.find((item) => item.id === summary.id);
    if (!summary || !result) return [];
    return [{ artifactId: summary.id, title: summary.title, kind, revision: result.revision ?? summary.currentRevision, formats: [kind === 'document' ? 'docx' : 'xlsx'] }];
  }) : [];
  const fixedExportBundle = exportBundle.length === 2 ? exportBundle : undefined;
  const projectId = snapshot?.artifact.projectId;
  const artifactId = snapshot?.artifact.id;
  const artifactHref = `/app/projects/${initial.artifact.projectId}/artifacts/${initial.artifact.id}`;
  const returnTo = `${artifactHref}${activeRunId ? `?run=${activeRunId}` : ''}`;
  const historyHref = `${artifactHref}/history`;
  const hasRecovery = state.drafts.length > 0 || state.pending.length > 0;
  const selectRun = useCallback((runId: string) => {
    if (activeRunRef.current === runId) return;
    activeRunRef.current = runId; setActiveRunId(runId);
    if (capabilities.navigation) router.replace(`${artifactHref}?run=${runId}`, { scroll: false });
  }, [artifactHref, router, capabilities.navigation]);
  useEffect(() => {
    if (initialRunId && initialRunId !== activeRunRef.current) { activeRunRef.current = initialRunId; setActiveRunId(initialRunId); }
  }, [initialRunId]);
  const handleAssistantAccessLost = useCallback(() => { session.suspend(); }, [session]);
  if (wasPrivate !== privateVisible) { setWasPrivate(privateVisible); if (!privateVisible) setRail(undefined); }
  useEffect(() => () => { exitResolver.current?.(false); }, []);
  useEffect(() => {
    if (!capabilities.recordView || !privateVisible || !viewerUserId || !viewerWorkspaceId || viewerAuthzVersion === undefined || !projectId || !artifactId) return;
    const controller = new AbortController();
    void workspaceClient.recordView(projectId, { workspaceId: viewerWorkspaceId, expectedAuthzVersion: viewerAuthzVersion, selectedArtifactId: artifactId }, { userId: viewerUserId, signal: controller.signal }).catch(async (failure) => {
      if (controller.signal.aborted) return;
      const status = failure && typeof failure === 'object' && 'status' in failure ? failure.status : undefined;
      if (status === 401) session.suspend();
      if (status === 403 || status === 404 || status === 409) await session.refresh();
    }).catch(setError);
    return () => controller.abort();
  }, [capabilities.recordView, privateVisible, viewerUserId, viewerWorkspaceId, viewerAuthzVersion, projectId, artifactId, session]);
  useEffect(() => {
    if (!capabilities.rail || !privateVisible) return;
    if (!viewerUserId || !viewerWorkspaceId || viewerAuthzVersion === undefined || !projectId) return;
    const controller = new AbortController(), serial = ++railSerial.current;
    const timer = setTimeout(() => {
      setRailLoading(true);
      void client.list({ workspaceId: viewerWorkspaceId, projectId, limit: 30, after: railAfter }, { viewer: { userId: viewerUserId, workspaceId: viewerWorkspaceId, authzVersion: viewerAuthzVersion }, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || serial !== railSerial.current) return;
      setRailError(undefined);
      setRail((previous) => railAfter && previous ? { ...result, artifacts: [...previous.artifacts, ...result.artifacts.filter((item) => !previous.artifacts.some((old) => old.id === item.id))] } : result);
    }).catch(async (failure) => {
      if (controller.signal.aborted || serial !== railSerial.current) return;
      setRailError(failure);
      const status = failure && typeof failure === 'object' && 'status' in failure ? failure.status : undefined;
      if (status === 401) session.suspend();
      if (status === 403 || status === 404) { setRail(undefined); await session.refresh(); }
      if (status === 409) { setRailAfter(undefined); await session.refresh(); }
      }).catch(setError).finally(() => { if (!controller.signal.aborted && serial === railSerial.current) setRailLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [capabilities.rail, client, privateVisible, viewerUserId, viewerWorkspaceId, viewerAuthzVersion, projectId, railAfter, railReload, session]);
  useEffect(() => {
    if (!capabilities.events || !privateVisible) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, failures = 0;
    const tick = async () => {
      let changed = false;
      try {
        if (document.visibilityState === 'visible') changed = await session.pollEvents();
        if (changed && !stopped) { setRailAfter(undefined); setRailReload((value) => value + 1); }
        failures = 0;
      }
      catch { failures += 1; }
      if (!stopped) timer = setTimeout(() => { void tick(); }, failures ? Math.min(60000, 3000 * 2 ** failures) : changed ? 3000 : 15000);
    };
    timer = setTimeout(() => { void tick(); }, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [capabilities.events, privateVisible, session]);
  async function continueSession() { setResuming(true); setError(undefined); try { await refreshAccount(); await resume(); } catch (failure) { setError(failure); } finally { setResuming(false); } }
  async function beforeSignOut() {
    if (editorFlush.current) await editorFlush.current();
    const current = session.getSnapshot();
    if (!current.drafts.length && !current.pending.length && !current.operation.operation) return true;
    return new Promise<boolean>((resolve) => { exitResolver.current = resolve; setExitPending(true); });
  }
  const beforeNavigate: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!editorFlush.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.origin !== window.location.origin) return;
    event.preventDefault();
    const href = `${anchor.pathname}${anchor.search}${anchor.hash}`;
    void editorFlush.current().then((saved) => {
      const current = session.getSnapshot();
      // Recovery is a deliberate continuation of this same artifact. Its draft must
      // be durable before unmounting an editor that cannot flush a conflict.
      const safeRecovery = anchor.pathname === historyHref && current.storageReady && !current.storageError && current.drafts.length > 0 && current.autosave?.locallyPersisted === true;
      if (saved || safeRecovery) router.push(href);
    }).catch(setError);
  };
  async function beforeExport() {
    if (editorFlush.current && !await editorFlush.current()) return null;
    if (!await session.flush()) return null;
    await session.refresh();
    const current = session.getSnapshot();
    if (current.phase !== 'ready' || !current.snapshot || current.drafts.length || current.pending.length || current.operation.operation) return null;
    const revision = current.snapshot.artifact.currentRevision;
    const bundleItems: ExportBundleItem[] | undefined = fixedExportBundle?.map((item): ExportBundleItem => item.artifactId === current.snapshot!.artifact.id ? { ...item, revision } : item);
    return { revision, expectedAuthzVersion: current.snapshot.viewer.authzVersion, ...(bundleItems ? { bundleItems } : {}) };
  }
  async function beforeReview() {
    if (editorFlush.current && !await editorFlush.current()) return false;
    return session.flush();
  }
  const prepareCurrentArtifact = useCallback(async () => {
    if (editorFlush.current && !await editorFlush.current()) return null;
    if (!await session.flush()) return null;
    await session.refresh();
    const current = session.getSnapshot();
    if (current.phase !== 'ready' || !current.snapshot || current.drafts.length || current.pending.length || current.operation.operation) return null;
    return { id: current.snapshot.artifact.id, revision: current.snapshot.artifact.currentRevision };
  }, [session]);
  const handleAssistantRun = useCallback((next: Run | undefined) => {
    setAssistantRun(next);
    const current = session.getSnapshot();
    if (!next || current.phase !== 'ready' || !current.snapshot) return;
    const revision = sessionResults(next).find((result) => result.kind === 'artifact' && result.id === current.snapshot!.artifact.id)?.revision;
    if (revision !== undefined && revision > current.snapshot.artifact.currentRevision) void session.refresh().catch(setError);
  }, [session]);
  async function afterLinkedChange() { await session.refresh(); setRailAfter(undefined); setRailReload((value) => value + 1); }
  const loadLifecycleProjects = useCallback<OptionLoader>(async (query, signal) => {
    const current = session.getSnapshot();
    if (current.phase !== 'ready' || !current.snapshot) return [];
    try {
      const page = await client.projects({ viewer: current.snapshot.viewer, signal }, { query });
      const latest = session.getSnapshot();
      if (latest.phase !== 'ready' || latest.snapshot?.viewer.authzVersion !== current.snapshot.viewer.authzVersion) return [];
      return page.projects.map((entry) => ({ id: entry.id, label: entry.title }));
    } catch (failure) {
      if (!signal.aborted) await session.refresh();
      throw failure;
    }
  }, [client, session]);
  async function prepareLifecycle(kind: ArtifactLifecycleKind) {
    if (lifecyclePreparing || state.operation.operation) return;
    setLifecyclePreparing(true); setError(undefined);
    try {
      if (editorFlush.current && !await editorFlush.current()) return;
      if (!await session.flush()) return;
      await session.refresh();
      const fresh = session.getSnapshot();
      if (fresh.phase !== 'ready' || !fresh.snapshot || !fresh.snapshot.permissions[kind]) return;
      const action: ArtifactAction = { kind, snapshot: fresh.snapshot };
      setLifecycleAction(action);
      setLifecycleProject({ id: fresh.snapshot.artifact.projectId, label: fresh.snapshot.artifact.projectId === initial.artifact.projectId ? projectTitle : t.activeProject });
      setLifecycleDraft(createActionDraft(action, kind === 'duplicate' ? artifactText('artifacts.versions.copyDefault', { title: fresh.snapshot.artifact.title }) : undefined));
    } catch (failure) { setError(failure); }
    finally { setLifecyclePreparing(false); }
  }
  function closeLifecycle() { setLifecycleAction(undefined); setLifecycleDraft(undefined); setLifecycleProject(null); }
  function followLifecycle(operation: ArtifactOperation | undefined, result: ArtifactOperationResult | undefined) {
    if (!operation || !result) return false;
    if (operation.kind === 'purge') { router.replace('/app/work'); return true; }
    if (!('artifact' in result)) return false;
    const href = `/app/projects/${result.artifact.projectId}/artifacts/${result.artifact.id}${activeRunId && operation.kind !== 'duplicate' ? `?run=${activeRunId}` : ''}`;
    if (operation.kind === 'move' || operation.kind === 'duplicate') { router.replace(href); return true; }
    if (operation.kind === 'archive' || operation.kind === 'trash') { router.replace(`/app/projects/${result.artifact.projectId}${activeRunId ? `?run=${activeRunId}` : ''}`); return true; }
    return false;
  }
  async function runLifecycle(operation: ArtifactOperation) {
    const result = await session.run(operation);
    const followed = followLifecycle(operation, result);
    if (result) {
      closeLifecycle();
      if (!followed) { setRailAfter(undefined); setRailReload((value) => value + 1); }
    }
  }
  async function retryLifecycle() {
    const operation = session.getSnapshot().operation.operation;
    const result = await session.retryOperation();
    const followed = followLifecycle(operation, result);
    if (result) {
      closeLifecycle();
      if (!followed) { setRailAfter(undefined); setRailReload((value) => value + 1); }
    }
  }
  async function signedOut() { if (await session.confirmedSignedOut()) { router.replace('/sign-in'); router.refresh(); } }
  if (!privateVisible || !snapshot) {
    const unavailable = <main className={styles.main}>
      {identity.phase === 'checking' || scoped && state.loading ? <LoadingState /> : <EmptyState icon={LogIn} title={t[identity.phase === 'account-changed' || state.phase === 'access-changed' ? 'forbidden' : 'auth']} description={t.authDescription} action={scoped ? undefined : <><Button icon={RefreshCw} pending={resuming} onClick={() => { void continueSession(); }}>{t.resume}</Button><Button icon={LogIn} variant="primary" onClick={() => setAuthOpen(true)}>{t.signIn}</Button><Link className="tl-button tl-button--secondary" href="/app/work">{t.back}</Link></>} />}
      <ArtifactError error={error ?? state.storageError} />{!scoped && <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={returnTo} onAuthenticated={() => { void continueSession(); }} />}
    </main>;
    return capabilities.shell ? <WorkspaceShell>{unavailable}</WorkspaceShell> : unavailable;
  }
  const resultList = <>
    <ArtifactError error={railError} />
    {railLoading && !visibleRail && <LoadingState />}
    <ul className={styles.resultList}>{visibleRail?.artifacts.map((artifact) => <li key={artifact.id}><Link href={`/app/projects/${projectId}/artifacts/${artifact.id}${activeRunId ? `?run=${activeRunId}` : ''}`} aria-current={artifact.id === artifactId ? 'page' : undefined} prefetch={false} onClick={() => setRailOpen(false)}><FileText size={18} /><span><strong>{artifact.title}</strong></span></Link></li>)}</ul>
    {visibleRail?.nextAfter && <Button pending={railLoading} onClick={() => setRailAfter(visibleRail.nextAfter!)}>{t.more}</Button>}
    {railError && <Button icon={RefreshCw} onClick={() => setRailReload((value) => value + 1)}>{t.retry}</Button>}
    <Link className={styles.back} href={`/app/projects/${projectId}${activeRunId ? `?run=${activeRunId}` : ''}`}><FolderOpen size={18} />{t.overview}</Link>
  </>;
  const table = snapshot.content.kind === 'table' ? requireTable(snapshot.content) : undefined;
  const exportSheets = table?.workbook.sheetOrder.map((id) => ({ id, name: table.workbook.sheets[id]!.name }));
  const exportPages = snapshot.content.kind === 'design' ? snapshot.content.pages.map((page, index) => ({ id: page.id, label: `${t.page} ${index + 1}` })) : undefined;
  const content = <main className={styles.main} onClickCapture={capabilities.shell ? undefined : beforeNavigate}>
    {capabilities.tour && <TourGuide ownerId={snapshot.viewer.userId} anchors={{ ...(snapshot.permissions.edit ? { edit: 'artifact-editor' } : {}), history: 'artifact-history', export: 'artifact-export' }} />}
    {capabilities.navigation && <Link href={`/app/projects/${projectId}${activeRunId ? `?run=${activeRunId}` : ''}`} className={styles.back}><ArrowLeft size={18} />{projectTitle}</Link>}
    <header className={styles.pageHeading}><h1>{snapshot.artifact.title}</h1><div className={styles.actions}>
      {capabilities.rail && <Button className={styles.mobileOnly} icon={FileText} onClick={() => setRailOpen(true)}>{t.results}</Button>}
      <SaveStatus state={state.autosave?.status === 'saving' ? 'saving' : hasRecovery ? state.autosave?.locallyPersisted ? 'local' : 'unsaved' : 'saved'} />
      {capabilities.navigation && <Link className="tl-button tl-button--secondary" href={`/app/materials?workspaceId=${snapshot.viewer.workspaceId}&projectId=${snapshot.artifact.projectId}`}><FolderOpen size={18} />{t.source}</Link>}
      {capabilities.navigation && <Link id="artifact-history" className="tl-button tl-button--secondary" href={historyHref}><FileClock size={18} />{t.history}</Link>}
      {capabilities.review && <ChangeReviewPanel key={`${viewerUserId}:${viewerWorkspaceId}:${projectId}:${viewerAuthzVersion}`} viewer={snapshot.viewer} projectId={snapshot.artifact.projectId} locale={locale} disabled={state.loading || Boolean(state.operation.operation)} beforeReview={beforeReview} onCommitted={afterLinkedChange} onUndo={async (groupId) => { const prepared = await session.prepareHistory('undo', groupId); if (prepared.operation) { await session.run(prepared.operation); await afterLinkedChange(); } }} />}
      {capabilities.export && <div id="artifact-export" tabIndex={-1}><ExportPanel workspaceId={snapshot.viewer.workspaceId} artifactId={snapshot.artifact.id} userId={snapshot.viewer.userId} expectedAuthzVersion={snapshot.viewer.authzVersion} kind={snapshot.content.kind} revision={snapshot.artifact.currentRevision} locale={locale} sheets={exportSheets} pages={exportPages} bundleItems={fixedExportBundle} transport={transport?.exports} disabled={state.loading || Boolean(state.operation.operation)} beforeExport={beforeExport} /></div>}
      {capabilities.lifecycle && <ArtifactLifecycleMenu snapshot={snapshot} disabled={state.loading || lifecyclePreparing || hasRecovery || state.autosave?.status === 'saving' || Boolean(state.operation.operation)} onAction={(kind) => { void prepareLifecycle(kind); }} />}
    </div></header>
    <ArtifactError error={error ?? state.error ?? state.storageError} />
    {hasRecovery && <div className={styles.error}><p>{t.recover}</p>{capabilities.navigation && <Link className="tl-button tl-button--secondary" href={historyHref}>{t.history}</Link>}</div>}
    {capabilities.assistant && <div className={styles.sessionSwitch} role="group" aria-label={t.sessionView}><Button variant={mobileView === 'assistant' ? 'primary' : 'quiet'} onClick={() => setMobileView('assistant')}>{t.assistant}</Button><Button variant={mobileView === 'result' ? 'primary' : 'quiet'} onClick={() => setMobileView('result')}>{t.results}</Button></div>}
    <div className={`${styles.sessionLayout} ${assistantCollapsed ? styles.sessionLayoutCollapsed : ''}`} data-mobile-view={mobileView} style={capabilities.assistant || capabilities.rail ? undefined : { gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {(capabilities.assistant || capabilities.rail) && <div className={styles.sessionAssistant}>{capabilities.assistant && <AssistantSession userId={snapshot.viewer.userId} workspaceId={snapshot.viewer.workspaceId} projectId={snapshot.artifact.projectId} initialRunId={activeRunId} sessionPath={artifactHref} collapsed={assistantCollapsed} onCollapsedChange={setAssistantCollapsed} onRunChange={selectRun} onRunData={handleAssistantRun} onAccessLost={handleAssistantAccessLost} currentArtifactId={snapshot.artifact.id} prepareCurrentArtifact={prepareCurrentArtifact} />}{capabilities.rail && <section className={styles.sessionResultList} aria-labelledby="session-result-list-title"><h2 id="session-result-list-title">{t.results}</h2>{resultList}</section>}</div>}
      <section id="artifact-editor" tabIndex={-1} className={`${styles.editorMain} ${styles.sessionResult}`} aria-label={snapshot.artifact.title}>
        <EditorBoundary key={`${viewerUserId}:${artifactId}`} fallback={<div className={styles.editorFailure} role="alert"><h2>{t.editorUnavailable}</h2><p>{t.editorReloadHint}</p><Button icon={RefreshCw} onClick={() => window.location.reload()}>{t.reloadEditor}</Button>{capabilities.navigation && <Link className="tl-button tl-button--secondary" href={historyHref}>{t.history}</Link>}</div>}>
        {snapshot.content.kind === 'document' ? <DocumentEditor key={`${viewerUserId}:${artifactId}:${viewerAuthzVersion}`} session={session} onFlushReady={registerEditorFlush} />
          : snapshot.content.kind === 'table' ? <SheetEditor key={`${viewerUserId}:${artifactId}`} session={session} locale={locale} onFlushReady={registerEditorFlush} />
            : snapshot.content.kind === 'design' ? <DesignEditor key={`${viewerUserId}:${artifactId}`} session={session} state={state} onFlushReady={registerEditorFlush} />
              : <PlanEditor key={`${viewerUserId}:${artifactId}`} session={session} onFlushReady={registerEditorFlush} transport={transport?.operations} />}
        </EditorBoundary>
        {capabilities.sourceFreshness && snapshot.sourceFreshness.length > 0 && <SourceFreshnessPanel snapshot={snapshot} />}
        {capabilities.collaboration && <ArtifactThread
          key={`${viewerUserId}:${artifactId}:${snapshot.artifact.currentRevision}`}
          userId={snapshot.viewer.userId}
          workspaceId={snapshot.viewer.workspaceId}
          projectId={snapshot.artifact.projectId}
          artifactId={snapshot.artifact.id}
          artifactRevision={snapshot.artifact.currentRevision}
          disabled={state.loading || hasRecovery || state.autosave?.status === 'saving' || Boolean(state.operation.operation)}
        />}
      </section>
    </div>
    {capabilities.rail && <Dialog open={railOpen} onOpenChange={setRailOpen} placement="side" title={t.results}>{resultList}</Dialog>}
    {capabilities.lifecycle && lifecycleAction && lifecycleDraft && <ArtifactActionDialog key={`${lifecycleAction.kind}:${lifecycleAction.snapshot.artifact.currentRevision}`} action={lifecycleAction} draft={lifecycleDraft} onDraftChange={setLifecycleDraft} onClose={closeLifecycle} onRun={(operation) => { void runLifecycle(operation).catch(setError); }} onRetry={() => { void retryLifecycle().catch(setError); }} onRefresh={() => { void (async () => { await session.dismissRejected(); await session.refresh(); closeLifecycle(); })().catch(setError); }} operation={state.operation} project={lifecycleProject} onProjectChange={setLifecycleProject} loadProjects={loadLifecycleProjects} />}
    {capabilities.shell && exitPending && <ArtifactSignOutGuard state={state} session={session} onDecision={(proceed) => { exitResolver.current?.(proceed); exitResolver.current = undefined; setExitPending(false); }} />}
  </main>;
  return capabilities.shell ? <WorkspaceShell workspaceId={snapshot.viewer.workspaceId} beforeSignOut={beforeSignOut} onSignedOut={() => { void signedOut(); }} onClickCapture={beforeNavigate}>{content}</WorkspaceShell> : content;
}
