'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, Archive, ArrowLeft, FileText, FolderOpen, Plus, RotateCcw, Save, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SourceListSchema, type SourceSummary } from '@/contracts/sources';
import { formatInstant } from '@/i18n';
import { useLocale } from '@/i18n/provider';
import { artifactClient } from '@/features/artifacts/client/transport';
import { blankArtifactContent } from '@/features/artifacts/domain/content-state';
import type { ArtifactListResult } from '@/features/artifacts/contracts';
import { Button, Dialog, DialogClose, EmptyState, InputField, LoadingState, SaveStatus, TextareaField } from '@/ui';
import { workspaceClient, workspaceRequest } from '../client/transport';
import type { ProjectResult } from '../contracts';
import { WorkspaceAccessState, WorkspaceError, WorkspaceShell, useWorkspaceAccess, useWorkspaceCopy } from './shell';
import styles from './workspace.module.css';
import { useWorkspaceLeaveGuard } from './leave-guard';
import { isDefiniteRequestRejection, retainRequestAttempt, type RequestAttempt } from '../domain/request-attempt';

export function ProjectPage({ ownerId, initial }: { ownerId: string; initial: ProjectResult }) {
  const t = useWorkspaceCopy(), { locale } = useLocale(), router = useRouter();
  const access = useWorkspaceAccess(ownerId), { run } = access;
  const [result, setResult] = useState(initial);
  const [title, setTitle] = useState(initial.project.title), [goal, setGoal] = useState(initial.project.goal ?? '');
  const [baseRevision, setBaseRevision] = useState(initial.project.revision);
  const [error, setError] = useState<unknown>(), [saving, setSaving] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactListResult>(), [artifactError, setArtifactError] = useState<unknown>();
  const [sources, setSources] = useState<SourceSummary[]>(), [sourceError, setSourceError] = useState<unknown>();
  const [sourcesAfter, setSourcesAfter] = useState<string | null>(null), [sourcesLoading, setSourcesLoading] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false), [createOpen, setCreateOpen] = useState(false), [documentTitle, setDocumentTitle] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [creating, setCreating] = useState(false), [createError, setCreateError] = useState<unknown>();
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const operation = useRef<RequestAttempt<unknown> | undefined>(undefined);
  const creation = useRef<RequestAttempt<Parameters<typeof artifactClient.create>[0]> | undefined>(undefined);
  const latestDraft = useRef({ title, goal, dirty: false });
  const cursor = useRef(initial.cursor);
  const sourceSerial = useRef(0), artifactSerial = useRef(0);
  const project = result.project, workspaceId = project.workspaceId, projectId = project.id;
  const dirty = title !== project.title || goal !== (project.goal ?? '');
  const active = access.phase === 'active';
  const canEdit = result.canEdit === true && project.status === 'active';
  const externalChange = dirty && baseRevision !== project.revision;
  const leave = useWorkspaceLeaveGuard(active && (dirty || Boolean(documentTitle)), creating || creationUncertain || saving);

  useEffect(() => { latestDraft.current = { title, goal, dirty }; }, [title, goal, dirty]);
  if (access.phase === 'discarded' && !discarded) { setDiscarded(true); setTitle(''); setGoal(''); setDocumentTitle(''); setArtifacts(undefined); setSources(undefined); }
  useEffect(() => { if (access.phase === 'discarded') { operation.current = undefined; creation.current = undefined; } }, [access.phase]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void run((signal) => workspaceClient.recordView(projectId, { workspaceId, expectedAuthzVersion: result.authzVersion }, { userId: ownerId, signal }), controller.signal).catch((failure) => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [active, run, ownerId, projectId, workspaceId, result.authzVersion]);

  const refreshProject = useCallback(async (signal?: AbortSignal) => {
    const next = await run((inner) => workspaceClient.read(workspaceId, projectId, { userId: ownerId, signal: inner }), signal);
    setResult(next); cursor.current = next.cursor;
    if (!latestDraft.current.dirty) { setTitle(next.project.title); setGoal(next.project.goal ?? ''); setBaseRevision(next.project.revision); }
    return next;
  }, [run, workspaceId, projectId, ownerId]);
  const loadArtifacts = useCallback(async (authority: number, after?: string, signal?: AbortSignal) => {
    const token = ++artifactSerial.current;
    try {
      const page = await run((inner) => artifactClient.list({ workspaceId, projectId, after, limit: 30 }, { viewer: { userId: ownerId, workspaceId, authzVersion: authority }, signal: inner, allowAuthorityAdvance: true }), signal);
      if (token !== artifactSerial.current) return;
      setArtifactError(undefined); setArtifacts((previous) => after && previous ? { ...page, artifacts: [...previous.artifacts, ...page.artifacts.filter((item) => !previous.artifacts.some((old) => old.id === item.id))] } : page);
    } catch (failure) { if (token === artifactSerial.current && !signal?.aborted) setArtifactError(failure); }
  }, [run, workspaceId, projectId, ownerId]);
  const loadSources = useCallback(async (after?: string, signal?: AbortSignal) => {
    const token = ++sourceSerial.current;
    setSourcesLoading(true);
    try {
      const query = new URLSearchParams({ workspaceId, projectId, limit: '30', ...(after ? { after } : {}) });
      const page = await run((inner) => workspaceRequest(`/api/sources?${query}`, SourceListSchema, { userId: ownerId, signal: inner }), signal, false);
      if (token !== sourceSerial.current) return;
      setSourceError(undefined); setSources((previous) => after && previous ? [...previous, ...page.sources.filter((item) => !previous.some((old) => old.id === item.id))] : page.sources); setSourcesAfter(page.nextCursor);
    } catch (failure) { if (token === sourceSerial.current && !signal?.aborted) { setSourceError(failure); if (failure && typeof failure === 'object' && 'status' in failure && [403, 404].includes(Number(failure.status))) { setSources(undefined); setSourcesAfter(null); } } }
    finally { if (token === sourceSerial.current) setSourcesLoading(false); }
  }, [run, workspaceId, projectId, ownerId]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void refreshProject(controller.signal).then((next) => loadArtifacts(next.authzVersion, undefined, controller.signal)).catch((failure) => { if (!controller.signal.aborted) setError(failure); });
      void loadSources(undefined, controller.signal);
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, refreshProject, loadArtifacts, loadSources]);
  useEffect(() => {
    if (!active) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, failures = 0;
    const controller = new AbortController();
    const tick = async () => {
      let changed = false;
      try {
        if (document.visibilityState === 'visible') {
          const events = await run((signal) => workspaceClient.events(workspaceId, cursor.current, { userId: ownerId, signal }), controller.signal);
          if (stopped) return;
          cursor.current = events.cursor;
          const own = events.events.filter((event) => event.projectId === projectId);
          changed = events.resetRequired || own.length > 0;
          if (changed) {
            if (events.resetRequired) { artifactSerial.current += 1; sourceSerial.current += 1; setArtifacts(undefined); setSources(undefined); setSourcesAfter(null); }
            const next = await refreshProject(controller.signal);
            if (events.resetRequired || own.some((event) => event.kind.startsWith('artifact.'))) await loadArtifacts(next.authzVersion, undefined, controller.signal);
            if (events.resetRequired || own.some((event) => event.kind.startsWith('source.'))) await loadSources(undefined, controller.signal);
          }
        }
        failures = 0;
      } catch (failure) { failures += 1; if (!stopped) setError(failure); }
      if (!stopped) timer = setTimeout(() => { void tick(); }, failures ? Math.min(60000, 3000 * 2 ** failures) : changed ? 3000 : 15000);
    };
    timer = setTimeout(() => { void tick(); }, 3000);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [active, run, ownerId, workspaceId, projectId, refreshProject, loadArtifacts, loadSources]);

  async function mutate(action: 'update' | 'archive' | 'restore') {
    if (saving) return;
    const body = { workspaceId, expectedAuthzVersion: result.authzVersion, expectedRevision: action === 'update' ? baseRevision : project.revision, ...(action === 'update' ? { title, goal: goal || null } : {}) };
    const attempt = retainRequestAttempt(operation.current, { action, workspaceId, projectId, ...(action === 'update' ? { title, goal } : {}) }, () => body);
    operation.current = attempt;
    setSaving(true); setError(undefined);
    try {
      const next = await run((signal) => workspaceClient.mutate(projectId, action, attempt.input, attempt.key, { userId: ownerId, signal }));
      setResult(next); setTitle(next.project.title); setGoal(next.project.goal ?? ''); setBaseRevision(next.project.revision); cursor.current = next.cursor; operation.current = undefined; setArchiveOpen(false);
      await refreshProject();
    } catch (failure) { if (isDefiniteRequestRejection(failure)) operation.current = undefined; setError(failure); }
    finally { setSaving(false); }
  }
  async function createDocument(event: React.FormEvent) {
    event.preventDefault(); if (!documentTitle.trim() || creating) return;
    if (!creation.current && dirty && !await leave.beforeSignOut()) return;
    const attempt = creation.current ?? retainRequestAttempt(undefined, { workspaceId, projectId, title: documentTitle }, () => ({ workspaceId, projectId, expectedAuthzVersion: result.authzVersion, title: documentTitle, content: blankArtifactContent('document') }));
    creation.current = attempt;
    setCreating(true); setCreateError(undefined);
    try {
      const created = await run((signal) => artifactClient.create(attempt.input, attempt.key, { viewer: { userId: ownerId, workspaceId, authzVersion: result.authzVersion }, replayExpectedAuthzVersion: attempt.input.expectedAuthzVersion, signal }));
      setCreateOpen(false); setDocumentTitle(''); creation.current = undefined; setCreationUncertain(false);
      router.push(`/app/projects/${projectId}/artifacts/${created.artifact.id}`);
    } catch (failure) { const rejected = isDefiniteRequestRejection(failure); if (rejected) creation.current = undefined; setCreationUncertain(!rejected); setCreateError(failure); }
    finally { setCreating(false); }
  }

  if (!active) return <WorkspaceShell><WorkspaceAccessState access={access} returnTo={`/app/projects/${projectId}`} /></WorkspaceShell>;
  const sourceList = <>
    <WorkspaceError error={sourceError} retry={() => { void loadSources(); }} />
    {!sources && !sourceError && <LoadingState />}{sources?.length === 0 && <p className={styles.muted}>{t.sourceEmpty}</p>}
    {sources && <ul className={styles.resultList}>{sources.map((source) => <li key={source.id}><Link href={`/app/materials/sources/${source.id}?workspaceId=${workspaceId}`}><FolderOpen size={20} /><span><strong>{source.title}</strong><time dateTime={source.updatedAt}>{formatInstant(locale, source.updatedAt, { dateStyle: 'medium' })}</time></span></Link></li>)}</ul>}
    {sourcesAfter && <Button pending={sourcesLoading} onClick={() => { void loadSources(sourcesAfter); }}>{t.more}</Button>}
    <Link className={styles.back} href={`/app/materials?workspaceId=${workspaceId}&projectId=${projectId}`}><FolderOpen size={18} />{t.openSources}</Link>
    {canEdit && <Link className="tl-button tl-button--secondary" href={`/app/materials/add?workspaceId=${workspaceId}&projectId=${projectId}`}><Upload size={18} />{t.addSource}</Link>}
  </>;
  return <WorkspaceShell workspaceId={workspaceId} beforeSignOut={leave.beforeSignOut} onClickCapture={leave.onClickCapture}><main className={styles.main}>
    {leave.confirmation}
    <Link className={styles.back} href={`/app/work?workspace=${workspaceId}`}><ArrowLeft size={18} />{t.back}</Link>
    <header className={styles.pageHeading}><div><h1>{project.title}</h1><p className={styles.meta}>{formatInstant(locale, project.updatedAt)}{result.canEdit === false && <span>{t.readOnly}</span>}</p></div><div className={styles.actions}>
      <Link className="tl-button tl-button--secondary" href={`/app/runs?workspace=${workspaceId}&project=${projectId}`}><Activity size={18} />{t.activity}</Link>
      <Button className={styles.mobileOnly} icon={FolderOpen} onClick={() => setSourcesOpen(true)}>{t.source}</Button>
      {canEdit && <><Link className="tl-button tl-button--secondary" href={`/app/materials/add?workspaceId=${workspaceId}&projectId=${projectId}`}><Upload size={18} />{t.addSource}</Link><Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>{t.newDocument}</Button><Button icon={Archive} disabled={dirty} onClick={() => setArchiveOpen(true)}>{t.archive}</Button></>}
      {project.status === 'archived' && result.canEdit && <Button variant="primary" icon={RotateCcw} pending={saving} onClick={() => { void mutate('restore'); }}>{t.restore}</Button>}
    </div></header>
    {project.status === 'archived' && <div className={styles.archiveNotice}>{t.archivedProject}</div>}
    <div className={styles.projectLayout}><section className={styles.projectMain}>
      <form className={`${styles.goal} ${styles.form}`} onSubmit={(event) => { event.preventDefault(); void mutate('update'); }}>
        <InputField label={t.title} required maxLength={240} value={title} disabled={!canEdit || saving} onChange={(event) => setTitle(event.target.value)} />
        <TextareaField label={t.goal} placeholder={t.goalHint} value={goal} maxLength={12000} rows={4} disabled={!canEdit || saving} onChange={(event) => setGoal(event.target.value)} />
        {externalChange && <div className={styles.error}><div><p>{t.conflict}</p><strong>{project.title}</strong><p>{project.goal}</p></div><Button onClick={() => { setBaseRevision(project.revision); setError(undefined); }}>{t.resume}</Button></div>}
        <WorkspaceError error={error} saving retry={() => { void refreshProject().catch(setError); }} />
        {canEdit && <div className={styles.actions}><Button variant="primary" type="submit" icon={Save} pending={saving} disabled={!dirty || externalChange || !title.trim()}>{t.save}</Button><SaveStatus state={saving ? 'saving' : dirty ? 'unsaved' : 'saved'} /></div>}
      </form>
      <div className={styles.sectionHeading}><h2>{t.results}</h2></div><WorkspaceError error={artifactError} retry={() => { void loadArtifacts(result.authzVersion); }} />
      {!artifacts && !artifactError && <LoadingState />}
      {artifacts && !artifacts.artifacts.length && <EmptyState icon={FileText} title={t.resultEmpty} action={canEdit ? <Button icon={Plus} onClick={() => setCreateOpen(true)}>{t.newDocument}</Button> : undefined} />}
      {artifacts && <ul className={styles.resultList}>{artifacts.artifacts.map((artifact) => <li key={artifact.id}><Link href={`/app/projects/${projectId}/artifacts/${artifact.id}`} prefetch={false}><FileText size={22} /><span><strong>{artifact.title}</strong><time dateTime={artifact.updatedAt}>{formatInstant(locale, artifact.updatedAt)}</time></span></Link></li>)}</ul>}
      {artifacts?.nextAfter && <Button onClick={() => { void loadArtifacts(result.authzVersion, artifacts.nextAfter!); }}>{t.more}</Button>}
    </section><aside className={`${styles.aside} ${styles.desktopOnly}`}><div className={styles.sectionHeading}><h2>{t.source}</h2></div>{sourceList}</aside></div>
    <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen} placement="side" title={t.source}>{sourceList}</Dialog>
    <Dialog open={archiveOpen} onOpenChange={setArchiveOpen} title={t.archiveTitle} dismissible={!saving} description={t.archiveDescription} footer={<><DialogClose disabled={saving}>{t.cancel}</DialogClose><Button icon={Archive} pending={saving} onClick={() => { void mutate('archive'); }}>{t.archive}</Button></>}><p>{project.title}</p><WorkspaceError error={error} saving /></Dialog>
    <Dialog open={createOpen} onOpenChange={setCreateOpen} title={t.newDocument} dismissible={!creating && !creationUncertain} dirty={Boolean(documentTitle)} onDiscard={() => { setDocumentTitle(''); creation.current = undefined; }} footer={<><DialogClose disabled={creating || creationUncertain}>{t.cancel}</DialogClose><Button type="submit" form="create-document" variant="primary" icon={Plus} pending={creating}>{creationUncertain ? t.checkCreation : t.newDocument}</Button></>}><form id="create-document" className={styles.form} onSubmit={createDocument}><InputField label={t.documentTitle} value={documentTitle} required maxLength={240} disabled={creating || creationUncertain} onChange={(event) => setDocumentTitle(event.target.value)} />{creationUncertain ? <p role="status">{t.uncertainCreation}</p> : <WorkspaceError error={createError} saving />}</form></Dialog>
  </main></WorkspaceShell>;
}
