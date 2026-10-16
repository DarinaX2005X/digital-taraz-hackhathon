'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArrowLeft, FileSpreadsheet, FileText, FolderOpen, GitCompareArrows, Image, LayoutList, PackageCheck, Plus, RotateCcw, Save, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SourceListSchema, type SourceSummary } from '@/contracts/sources';
import type { ArtifactKind } from '@/contracts/artifacts';
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
import { taskRequestKey, taskSelectionKey } from '../domain/task-request';
import { ProjectTask } from './project-task';
import { TourGuide } from '@/features/onboarding/tour';
import { AssistantSession } from '@/features/runs/ui/assistant-session';
import { projectSessionDraftKey, readProjectSessionDraft } from '../domain/project-session-draft';

type CreatableKind = Extract<ArtifactKind, 'document' | 'table' | 'design' | 'plan'>;
const kindIcons = { document: FileText, table: FileSpreadsheet, design: Image, plan: LayoutList } as const;

export function ProjectPage({ ownerId, initial, selectedSource, initialRunId, initialCreateKind }: { ownerId: string; initial: ProjectResult; selectedSource?: { sourceId: string; sourceVersionId: string }; initialRunId?: string; initialCreateKind?: CreatableKind }) {
  const t = useWorkspaceCopy(), { locale } = useLocale(), router = useRouter();
  const access = useWorkspaceAccess(ownerId), { run } = access;
  const [result, setResult] = useState(initial);
  const [title, setTitle] = useState(initial.project.title), [goal, setGoal] = useState(initial.project.goal ?? '');
  const [baseRevision, setBaseRevision] = useState(initial.project.revision);
  const [error, setError] = useState<unknown>(), [saving, setSaving] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactListResult>(), [artifactError, setArtifactError] = useState<unknown>();
  const [sources, setSources] = useState<SourceSummary[]>(), [sourceError, setSourceError] = useState<unknown>();
  const [sourcesAfter, setSourcesAfter] = useState<string | null>(null), [sourcesLoading, setSourcesLoading] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false), [createOpen, setCreateOpen] = useState(Boolean(initialCreateKind)), [artifactTitle, setArtifactTitle] = useState('');
  const [createKind, setCreateKind] = useState<CreatableKind>(initialCreateKind ?? 'document');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [creating, setCreating] = useState(false), [createError, setCreateError] = useState<unknown>();
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState(initialRunId), [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<'assistant' | 'result'>('assistant');
  const [discarded, setDiscarded] = useState(false);
  const operation = useRef<RequestAttempt<unknown> | undefined>(undefined);
  const creation = useRef<RequestAttempt<Parameters<typeof artifactClient.create>[0]> | undefined>(undefined);
  const latestDraft = useRef({ title, goal, dirty: false });
  const cursor = useRef(initial.cursor);
  const sourceSerial = useRef(0), artifactSerial = useRef(0);
  const activeRunRef = useRef(initialRunId);
  const restoredProjectDraft = useRef(false);
  const project = result.project, workspaceId = project.workspaceId, projectId = project.id;
  const dirty = title !== project.title || goal !== (project.goal ?? '');
  const active = access.phase === 'active';
  const canEdit = result.canEdit === true && project.status === 'active';
  const externalChange = dirty && baseRevision !== project.revision;
  const leave = useWorkspaceLeaveGuard(active && (dirty || Boolean(artifactTitle)), creating || creationUncertain || saving || taskBusy);
  const selectRun = useCallback((runId: string) => {
    if (activeRunRef.current === runId) return;
    activeRunRef.current = runId; setActiveRunId(runId);
    router.replace(`/app/projects/${projectId}?run=${runId}`, { scroll: false });
  }, [projectId, router]);
  useEffect(() => {
    if (initialRunId && initialRunId !== activeRunRef.current) { activeRunRef.current = initialRunId; setActiveRunId(initialRunId); }
  }, [initialRunId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const draft = readProjectSessionDraft(sessionStorage.getItem(projectSessionDraftKey(ownerId, projectId)));
        if (draft) { setTitle(draft.title); setGoal(draft.goal); setBaseRevision(draft.baseRevision); }
      } catch { /* Server state remains the safe fallback. */ }
      restoredProjectDraft.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [ownerId, projectId]);
  useEffect(() => {
    if (!restoredProjectDraft.current) return;
    try {
      const key = projectSessionDraftKey(ownerId, projectId);
      if (dirty) sessionStorage.setItem(key, JSON.stringify({ title, goal, baseRevision }));
      else sessionStorage.removeItem(key);
    } catch { /* The leave guard still protects the in-memory draft. */ }
  }, [dirty, title, goal, baseRevision, ownerId, projectId]);

  useEffect(() => { latestDraft.current = { title, goal, dirty }; }, [title, goal, dirty]);
  if (access.phase === 'discarded' && !discarded) { setDiscarded(true); setTitle(''); setGoal(''); setArtifactTitle(''); setArtifacts(undefined); setSources(undefined); }
  useEffect(() => { if (access.phase === 'discarded') { operation.current = undefined; creation.current = undefined; try { sessionStorage.removeItem(taskRequestKey(ownerId, projectId)); sessionStorage.removeItem(taskSelectionKey(ownerId, projectId)); sessionStorage.removeItem(projectSessionDraftKey(ownerId, projectId)); } catch { /* No persisted tab data is accessible. */ } } }, [access.phase, ownerId, projectId]);
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
    if (saving) return false;
    const body = { workspaceId, expectedAuthzVersion: result.authzVersion, expectedRevision: action === 'update' ? baseRevision : project.revision, ...(action === 'update' ? { title, goal: goal || null } : {}) };
    const attempt = retainRequestAttempt(operation.current, { action, workspaceId, projectId, ...(action === 'update' ? { title, goal } : {}) }, () => body);
    operation.current = attempt;
    setSaving(true); setError(undefined);
    try {
      const next = await run((signal) => workspaceClient.mutate(projectId, action, attempt.input, attempt.key, { userId: ownerId, signal }));
      setResult(next); setTitle(next.project.title); setGoal(next.project.goal ?? ''); setBaseRevision(next.project.revision); cursor.current = next.cursor; operation.current = undefined; setArchiveOpen(false);
      try { sessionStorage.removeItem(projectSessionDraftKey(ownerId, projectId)); } catch { /* The server mutation is already authoritative. */ }
      await refreshProject();
      return true;
    } catch (failure) { if (isDefiniteRequestRejection(failure)) operation.current = undefined; setError(failure); return false; }
    finally { setSaving(false); }
  }
  async function createArtifact(event: React.FormEvent) {
    event.preventDefault(); if (!artifactTitle.trim() || creating) return;
    if (!creation.current && dirty && !await mutate('update')) return;
    const attempt = creation.current ?? retainRequestAttempt(undefined, { workspaceId, projectId, title: artifactTitle, kind: createKind }, () => ({ workspaceId, projectId, expectedAuthzVersion: result.authzVersion, title: artifactTitle, content: blankArtifactContent(createKind) }));
    creation.current = attempt;
    setCreating(true); setCreateError(undefined);
    try {
      const created = await run((signal) => artifactClient.create(attempt.input, attempt.key, { viewer: { userId: ownerId, workspaceId, authzVersion: result.authzVersion }, replayExpectedAuthzVersion: attempt.input.expectedAuthzVersion, signal }));
      setCreateOpen(false); setArtifactTitle(''); creation.current = undefined; setCreationUncertain(false);
      router.push(`/app/projects/${projectId}/artifacts/${created.artifact.id}${activeRunId ? `?run=${activeRunId}` : ''}`);
    } catch (failure) { const rejected = isDefiniteRequestRejection(failure); if (rejected) creation.current = undefined; setCreationUncertain(!rejected); setCreateError(failure); }
    finally { setCreating(false); }
  }

  if (!active) return <WorkspaceShell><WorkspaceAccessState access={access} returnTo={`/app/projects/${projectId}${activeRunId ? `?run=${activeRunId}` : ''}`} /></WorkspaceShell>;
  const sourceList = <>
    <WorkspaceError error={sourceError} retry={() => { void loadSources(); }} />
    {!sources && !sourceError && <LoadingState />}{sources?.length === 0 && <p className={styles.muted}>{t.sourceEmpty}</p>}
    {sources && <ul className={styles.resultList}>{sources.map((source) => <li key={source.id}><Link href={`/app/materials/sources/${source.id}?${new URLSearchParams({ workspaceId, from: 'project', ...(activeRunId ? { run: activeRunId } : {}) })}`}><FolderOpen size={20} /><span><strong>{source.title}</strong><time dateTime={source.updatedAt}>{formatInstant(locale, source.updatedAt, { dateStyle: 'medium' })}</time></span></Link></li>)}</ul>}
    {sourcesAfter && <Button pending={sourcesLoading} onClick={() => { void loadSources(sourcesAfter); }}>{t.more}</Button>}
    <Link className={styles.back} href={`/app/materials?workspaceId=${workspaceId}&projectId=${projectId}`}><FolderOpen size={18} />{t.openSources}</Link>
    {canEdit && <Link className="tl-button tl-button--secondary" href={`/app/materials/add?${new URLSearchParams({ workspaceId, projectId, ...(activeRunId ? { run: activeRunId } : {}) })}`}><Upload size={18} />{t.addSource}</Link>}
  </>;
  const assistantEntry = <form className={`${styles.assistantEntry} ${styles.form}`} onSubmit={(event) => { event.preventDefault(); void mutate('update'); }}>
    <details className={styles.projectDetails}><summary>{t.renameProject}</summary><InputField label={t.title} required maxLength={240} value={title} disabled={!canEdit || saving || taskBusy} onChange={(event) => setTitle(event.target.value)} /></details>
    <TextareaField id="project-task-goal" label={t.goal} placeholder={t.goalHint} value={goal} maxLength={12000} rows={5} disabled={!canEdit || saving || taskBusy} onChange={(event) => setGoal(event.target.value)} />
    {externalChange && <div className={styles.error}><div><p>{t.conflict}</p><strong>{project.title}</strong><p>{project.goal}</p></div><Button onClick={() => { setBaseRevision(project.revision); setError(undefined); }}>{t.resume}</Button></div>}
    <WorkspaceError error={error} saving retry={() => { void refreshProject().catch(setError); }} />
    {canEdit && <div className={styles.actions}><Button type="submit" icon={Save} pending={saving} disabled={!dirty || externalChange || !title.trim() || taskBusy}>{t.save}</Button><SaveStatus state={saving ? 'saving' : dirty ? 'unsaved' : 'saved'} /></div>}
    {canEdit && <ProjectTask ownerId={ownerId} workspaceId={workspaceId} projectId={projectId} goal={goal} sources={sources} active={active} canEdit={canEdit && !externalChange && Boolean(title.trim())} selectedSource={selectedSource} beforeStart={async () => !dirty || await mutate('update')} onBusyChange={setTaskBusy} onStarted={selectRun} run={run} />}
  </form>;
  return <WorkspaceShell workspaceId={workspaceId} beforeSignOut={leave.beforeSignOut} onClickCapture={leave.onClickCapture}><main className={styles.main}>
    {leave.confirmation}
    {canEdit && <TourGuide ownerId={ownerId} anchors={{ task: 'project-session', materials: 'project-sources', edit: 'project-results' }} />}
    <Link className={styles.back} href={`/app/work?workspace=${workspaceId}`}><ArrowLeft size={18} />{t.back}</Link>
    <header className={styles.pageHeading}><div><h1>{project.title}</h1><p className={styles.meta}>{formatInstant(locale, project.updatedAt)}{result.canEdit === false && <span>{t.readOnly}</span>}</p></div><div className={styles.actions}>
      <Link className="tl-button tl-button--secondary" href={`/app/projects/${projectId}/changes`}><GitCompareArrows size={18} />{t.changes}</Link>
      <Link className="tl-button tl-button--secondary" href={`/app/projects/${projectId}/packages`}><PackageCheck size={18} />{t.packages}</Link>
      <Button id="project-sources" icon={FolderOpen} onClick={() => setSourcesOpen(true)}>{t.source}</Button>
    {canEdit && <><Link id="project-materials" className="tl-button tl-button--secondary" href={`/app/materials/add?${new URLSearchParams({ workspaceId, projectId, ...(activeRunId ? { run: activeRunId } : {}) })}`}><Upload size={18} />{t.addSource}</Link><Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>{t.createMaterial}</Button><Button icon={Archive} disabled={dirty} onClick={() => setArchiveOpen(true)}>{t.archive}</Button></>}
      {project.status === 'archived' && result.canEdit && <Button variant="primary" icon={RotateCcw} pending={saving} onClick={() => { void mutate('restore'); }}>{t.restore}</Button>}
    </div></header>
    {project.status === 'archived' && <div className={styles.archiveNotice}>{t.archivedProject}</div>}
    <div className={styles.sessionSwitch} role="group" aria-label={t.sessionView}><Button variant={mobileView === 'assistant' ? 'primary' : 'quiet'} onClick={() => setMobileView('assistant')}>{t.assistant}</Button><Button variant={mobileView === 'result' ? 'primary' : 'quiet'} onClick={() => setMobileView('result')}>{t.results}</Button></div>
    <div id="project-session" className={`${styles.sessionLayout} ${assistantCollapsed ? styles.sessionLayoutCollapsed : ''}`} data-mobile-view={mobileView}>
      <div className={styles.sessionAssistant}><AssistantSession userId={ownerId} workspaceId={workspaceId} projectId={projectId} initialRunId={activeRunId} collapsed={assistantCollapsed} onCollapsedChange={setAssistantCollapsed} onRunChange={selectRun} empty={assistantEntry} /></div>
      <section id="project-results" className={styles.sessionResult} aria-labelledby="project-results-title"><div className={styles.sectionHeading}><div><span className={styles.resultLabel}>{t.currentResult}</span><h2 id="project-results-title">{t.results}</h2></div>{canEdit && <Button icon={Plus} onClick={() => setCreateOpen(true)}>{t.createMaterial}</Button>}</div><WorkspaceError error={artifactError} retry={() => { void loadArtifacts(result.authzVersion); }} />
      {!artifacts && !artifactError && <LoadingState />}
      {artifacts && !artifacts.artifacts.length && <EmptyState icon={FileText} title={t.resultEmpty} description={t.resultEmptyDescription} action={canEdit ? <Button icon={Plus} onClick={() => setCreateOpen(true)}>{t.createMaterial}</Button> : undefined} />}
      {artifacts && <ul className={`${styles.resultList} ${styles.resultCards}`}>{artifacts.artifacts.map((artifact) => { const Icon = kindIcons[artifact.kind as CreatableKind] ?? LayoutList; return <li key={artifact.id}><Link href={`/app/projects/${projectId}/artifacts/${artifact.id}${activeRunId ? `?run=${activeRunId}` : ''}`} prefetch={false}><Icon size={22} /><span><strong>{artifact.title}</strong><span className={styles.meta}>{t[artifact.kind]}</span><time dateTime={artifact.updatedAt}>{formatInstant(locale, artifact.updatedAt)}</time></span></Link></li>; })}</ul>}
      {artifacts?.nextAfter && <Button onClick={() => { void loadArtifacts(result.authzVersion, artifacts.nextAfter!); }}>{t.more}</Button>}
      </section>
    </div>
    <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen} placement="side" title={t.source}>{sourceList}</Dialog>
    <Dialog open={archiveOpen} onOpenChange={setArchiveOpen} title={t.archiveTitle} dismissible={!saving} description={t.archiveDescription} footer={<><DialogClose disabled={saving}>{t.cancel}</DialogClose><Button icon={Archive} pending={saving} onClick={() => { void mutate('archive'); }}>{t.archive}</Button></>}><p>{project.title}</p><WorkspaceError error={error} saving /></Dialog>
    <Dialog open={createOpen} onOpenChange={setCreateOpen} title={t.createMaterial} dismissible={!creating && !creationUncertain} dirty={Boolean(artifactTitle)} onDiscard={() => { setArtifactTitle(''); creation.current = undefined; }} footer={<><DialogClose disabled={creating || creationUncertain}>{t.cancel}</DialogClose><Button type="submit" form="create-artifact" variant="primary" icon={Plus} pending={creating}>{creationUncertain ? t.checkCreation : t.createMaterial}</Button></>}><form id="create-artifact" className={styles.form} onSubmit={createArtifact}><fieldset className={styles.kindChoices} disabled={creating || creationUncertain}><legend>{t.materialType}</legend>{(['document', 'table', 'design', 'plan'] as const).map((kind) => { const Icon = kindIcons[kind]; return <label key={kind}><input type="radio" name="artifact-kind" value={kind} checked={createKind === kind} onChange={() => setCreateKind(kind)} /><Icon size={20} aria-hidden="true" /><span>{t[kind]}</span></label>; })}</fieldset><InputField label={t.materialTitle} value={artifactTitle} required maxLength={240} disabled={creating || creationUncertain} onChange={(event) => setArtifactTitle(event.target.value)} />{creationUncertain ? <p role="status">{t.uncertainCreation}</p> : <WorkspaceError error={createError} saving />}</form></Dialog>
  </main></WorkspaceShell>;
}
