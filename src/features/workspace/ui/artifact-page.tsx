'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileClock, FileText, FolderOpen, LogIn, RefreshCw } from 'lucide-react';
import { Component, useCallback, useEffect, useRef, useState, type MouseEventHandler, type ReactNode } from 'react';
import { useLocale } from '@/i18n/provider';
import { AuthDialog } from '@/features/identity/ui';
import type { ArtifactListResult, ArtifactSnapshot } from '@/features/artifacts/contracts';
import { useArtifactSession } from '@/features/artifacts/ui/use-artifact-session';
import { ArtifactContentPreview } from '@/features/artifacts/ui/content-preview';
import { requireTable } from '@/features/sheets/domain/model';
import { ExportPanel } from '@/features/exports/client/ExportPanel';
import { ChangeReviewPanel } from '@/features/change-review';
import { ArtifactError } from '@/features/artifacts/ui/common';
import { ArtifactSignOutGuard } from '@/features/artifacts/ui/recovery-panel';
import { SourceFreshnessPanel } from '@/features/artifacts/ui/source-freshness';
import { artifactClient } from '@/features/artifacts/client/transport';
import { Button, Dialog, EmptyState, LoadingState, SaveStatus } from '@/ui';
import { WorkspaceShell, useWorkspaceCopy } from './shell';
import styles from './workspace.module.css';
import { workspaceClient } from '../client/transport';
import { TourGuide } from '@/features/onboarding/tour';

function EditorLoading() { const t = useWorkspaceCopy(); return <LoadingState label={t.loadingEditor} />; }
const DocumentEditor = dynamic(() => import('@/features/documents/ui/document-editor').then((module) => module.DocumentEditor), { ssr: false, loading: EditorLoading });
const SheetEditor = dynamic(() => import('@/features/sheets/ui').then((module) => module.SheetEditor), { ssr: false, loading: EditorLoading });
const DesignEditor = dynamic(() => import('@/features/designs/ui/design-editor').then((module) => module.DesignEditor), { ssr: false, loading: EditorLoading });

class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function ArtifactWorkspacePage({ initial, projectTitle }: { initial: ArtifactSnapshot; projectTitle: string }) {
  const t = useWorkspaceCopy(), router = useRouter(), { locale } = useLocale();
  const { state, identity, privateVisible, session, resume, refreshAccount } = useArtifactSession(initial);
  const [authOpen, setAuthOpen] = useState(false), [resuming, setResuming] = useState(false), [error, setError] = useState<unknown>();
  const [rail, setRail] = useState<ArtifactListResult>();
  const [railAfter, setRailAfter] = useState<string>(), [railReload, setRailReload] = useState(0), [railLoading, setRailLoading] = useState(false);
  const [railOpen, setRailOpen] = useState(false), [railError, setRailError] = useState<unknown>();
  const [exitPending, setExitPending] = useState(false);
  const [wasPrivate, setWasPrivate] = useState(privateVisible);
  const exitResolver = useRef<((proceed: boolean) => void) | undefined>(undefined);
  const editorFlush = useRef<(() => Promise<boolean>) | null>(null);
  const registerEditorFlush = useCallback((flush: (() => Promise<boolean>) | null) => { editorFlush.current = flush; }, []);
  const railSerial = useRef(0);
  const snapshot = state.snapshot;
  const viewer = snapshot?.viewer;
  const viewerUserId = viewer?.userId, viewerWorkspaceId = viewer?.workspaceId, viewerAuthzVersion = viewer?.authzVersion;
  const visibleRail = rail?.viewer.userId === viewerUserId && rail?.viewer.workspaceId === viewerWorkspaceId && rail?.viewer.authzVersion === viewerAuthzVersion ? rail : undefined;
  const projectId = snapshot?.artifact.projectId;
  const artifactId = snapshot?.artifact.id;
  const returnTo = `/app/projects/${initial.artifact.projectId}/artifacts/${initial.artifact.id}`;
  const historyHref = `${returnTo}/history`;
  const hasRecovery = state.drafts.length > 0 || state.pending.length > 0;
  if (wasPrivate !== privateVisible) { setWasPrivate(privateVisible); if (!privateVisible) setRail(undefined); }
  useEffect(() => () => { exitResolver.current?.(false); }, []);
  useEffect(() => {
    if (!privateVisible || !viewerUserId || !viewerWorkspaceId || viewerAuthzVersion === undefined || !projectId || !artifactId) return;
    const controller = new AbortController();
    void workspaceClient.recordView(projectId, { workspaceId: viewerWorkspaceId, expectedAuthzVersion: viewerAuthzVersion, selectedArtifactId: artifactId }, { userId: viewerUserId, signal: controller.signal }).catch(async (failure) => {
      if (controller.signal.aborted) return;
      const status = failure && typeof failure === 'object' && 'status' in failure ? failure.status : undefined;
      if (status === 401) session.suspend();
      if (status === 403 || status === 404 || status === 409) await session.refresh();
    }).catch(setError);
    return () => controller.abort();
  }, [privateVisible, viewerUserId, viewerWorkspaceId, viewerAuthzVersion, projectId, artifactId, session]);
  useEffect(() => {
    if (!privateVisible) return;
    if (!viewerUserId || !viewerWorkspaceId || viewerAuthzVersion === undefined || !projectId) return;
    const controller = new AbortController(), serial = ++railSerial.current;
    const timer = setTimeout(() => {
      setRailLoading(true);
      void artifactClient.list({ workspaceId: viewerWorkspaceId, projectId, limit: 30, after: railAfter }, { viewer: { userId: viewerUserId, workspaceId: viewerWorkspaceId, authzVersion: viewerAuthzVersion }, signal: controller.signal }).then((result) => {
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
  }, [privateVisible, viewerUserId, viewerWorkspaceId, viewerAuthzVersion, projectId, railAfter, railReload, session]);
  useEffect(() => {
    if (!privateVisible) return;
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
  }, [privateVisible, session]);
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
    return { revision: current.snapshot.artifact.currentRevision, expectedAuthzVersion: current.snapshot.viewer.authzVersion };
  }
  async function beforeReview() {
    if (editorFlush.current && !await editorFlush.current()) return false;
    return session.flush();
  }
  async function afterLinkedChange() { await session.refresh(); setRailAfter(undefined); setRailReload((value) => value + 1); }
  async function signedOut() { if (await session.confirmedSignedOut()) { router.replace('/sign-in'); router.refresh(); } }
  if (!privateVisible || !snapshot) return <WorkspaceShell><main className={styles.main}>
    {identity.phase === 'checking' ? <LoadingState /> : <EmptyState icon={LogIn} title={t[identity.phase === 'account-changed' || state.phase === 'access-changed' ? 'forbidden' : 'auth']} description={t.authDescription} action={<><Button icon={RefreshCw} pending={resuming} onClick={() => { void continueSession(); }}>{t.resume}</Button><Button icon={LogIn} variant="primary" onClick={() => setAuthOpen(true)}>{t.signIn}</Button><Link className="tl-button tl-button--secondary" href="/app/work">{t.back}</Link></>} />}
    <ArtifactError error={error ?? state.storageError} /><AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={returnTo} onAuthenticated={() => { void continueSession(); }} />
  </main></WorkspaceShell>;
  const resultList = <>
    <ArtifactError error={railError} />
    {railLoading && !visibleRail && <LoadingState />}
    <ul className={styles.resultList}>{visibleRail?.artifacts.map((artifact) => <li key={artifact.id}><Link href={`/app/projects/${projectId}/artifacts/${artifact.id}`} aria-current={artifact.id === artifactId ? 'page' : undefined} prefetch={false} onClick={() => setRailOpen(false)}><FileText size={18} /><span><strong>{artifact.title}</strong></span></Link></li>)}</ul>
    {visibleRail?.nextAfter && <Button pending={railLoading} onClick={() => setRailAfter(visibleRail.nextAfter!)}>{t.more}</Button>}
    {railError && <Button icon={RefreshCw} onClick={() => setRailReload((value) => value + 1)}>{t.retry}</Button>}
    <Link className={styles.back} href={`/app/projects/${projectId}`}><FolderOpen size={18} />{t.overview}</Link>
  </>;
  const table = snapshot.content.kind === 'table' ? requireTable(snapshot.content) : undefined;
  const exportSheets = table?.workbook.sheetOrder.map((id) => ({ id, name: table.workbook.sheets[id]!.name }));
  const exportPages = snapshot.content.kind === 'design' ? snapshot.content.pages.map((page, index) => ({ id: page.id, label: `${t.page} ${index + 1}` })) : undefined;
  return <WorkspaceShell workspaceId={snapshot.viewer.workspaceId} beforeSignOut={beforeSignOut} onSignedOut={() => { void signedOut(); }} onClickCapture={beforeNavigate}><main className={styles.main}>
    <TourGuide ownerId={snapshot.viewer.userId} anchors={{ ...(snapshot.permissions.edit ? { edit: 'artifact-editor' } : {}), history: 'artifact-history', export: 'artifact-export' }} />
    <Link href={`/app/projects/${projectId}`} className={styles.back}><ArrowLeft size={18} />{projectTitle}</Link>
    <header className={styles.pageHeading}><h1>{snapshot.artifact.title}</h1><div className={styles.actions}>
      <Button className={styles.mobileOnly} icon={FileText} onClick={() => setRailOpen(true)}>{t.results}</Button>
      <SaveStatus state={state.autosave?.status === 'saving' ? 'saving' : hasRecovery ? state.autosave?.locallyPersisted ? 'local' : 'unsaved' : 'saved'} />
      <Link id="artifact-history" className="tl-button tl-button--secondary" href={historyHref}><FileClock size={18} />{t.history}</Link>
      <ChangeReviewPanel key={`${viewerUserId}:${viewerWorkspaceId}:${projectId}:${viewerAuthzVersion}`} viewer={snapshot.viewer} projectId={snapshot.artifact.projectId} locale={locale} disabled={state.loading || Boolean(state.operation.operation)} beforeReview={beforeReview} onCommitted={afterLinkedChange} onUndo={async (groupId) => { const prepared = await session.prepareHistory('undo', groupId); if (prepared.operation) { await session.run(prepared.operation); await afterLinkedChange(); } }} />
      <div id="artifact-export" tabIndex={-1}><ExportPanel workspaceId={snapshot.viewer.workspaceId} artifactId={snapshot.artifact.id} userId={snapshot.viewer.userId} expectedAuthzVersion={snapshot.viewer.authzVersion} kind={snapshot.content.kind} revision={snapshot.artifact.currentRevision} locale={locale} sheets={exportSheets} pages={exportPages} disabled={state.loading || Boolean(state.operation.operation)} beforeExport={beforeExport} /></div>
    </div></header>
    <ArtifactError error={error ?? state.error ?? state.storageError} />
    {hasRecovery && <div className={styles.error}><p>{t.recover}</p><Link className="tl-button tl-button--secondary" href={historyHref}>{t.history}</Link></div>}
    <div className={styles.editorLayout}><aside className={`${styles.editorRail} ${styles.desktopOnly}`}><div className={styles.sectionHeading}><h2>{t.results}</h2></div>{resultList}</aside>
      <section id="artifact-editor" tabIndex={-1} className={styles.editorMain} aria-label={snapshot.artifact.title}>
        <EditorBoundary key={`${viewerUserId}:${artifactId}`} fallback={<div className={styles.editorFailure} role="alert"><h2>{t.editorUnavailable}</h2><p>{t.editorReloadHint}</p><Button icon={RefreshCw} onClick={() => window.location.reload()}>{t.reloadEditor}</Button><Link className="tl-button tl-button--secondary" href={historyHref}>{t.history}</Link></div>}>
        {snapshot.content.kind === 'document' ? <DocumentEditor key={`${viewerUserId}:${artifactId}:${viewerAuthzVersion}`} session={session} onFlushReady={registerEditorFlush} />
          : snapshot.content.kind === 'table' ? <SheetEditor key={`${viewerUserId}:${artifactId}`} session={session} locale={locale} onFlushReady={registerEditorFlush} />
            : snapshot.content.kind === 'design' ? <DesignEditor key={`${viewerUserId}:${artifactId}`} session={session} state={state} onFlushReady={registerEditorFlush} />
              : <ArtifactContentPreview content={snapshot.content} contentKey={`${artifactId}:${snapshot.artifact.currentRevision}`} />}
        </EditorBoundary>
        {snapshot.sourceFreshness.length > 0 && <SourceFreshnessPanel snapshot={snapshot} />}
      </section>
    </div>
    <Dialog open={railOpen} onOpenChange={setRailOpen} placement="side" title={t.results}>{resultList}</Dialog>
    {exitPending && <ArtifactSignOutGuard state={state} session={session} onDecision={(proceed) => { exitResolver.current?.(proceed); exitResolver.current = undefined; setExitPending(false); }} />}
  </main></WorkspaceShell>;
}
