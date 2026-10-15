'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Folder, FolderPlus, Plus, Search } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { useLocale } from '@/i18n/provider';
import { formatInstant } from '@/i18n';
import { identityClient } from '@/features/identity/ui';
import { Button, Dialog, DialogClose, EmptyState, InputField, LoadingState, SelectField, Tabs, TextareaField } from '@/ui';
import { workspaceClient } from '../client/transport';
import type { CreateProject } from '../contracts';
import { WorkspaceAccessState, WorkspaceError, WorkspaceShell, useWorkspaceAccess, useWorkspaceCopy } from './shell';
import styles from './workspace.module.css';
import { useWorkspaceLeaveGuard } from './leave-guard';
import { isDefiniteRequestRejection, retainRequestAttempt, type RequestAttempt } from '../domain/request-attempt';
import { initialProjectListState, projectListReducer } from '../domain/project-list-state';
import { initialWorkspaceSelection, restoreEntryGoal, workEntryHref } from '../domain/work-entry';

export function WorkPage({ ownerId, initialWorkspaceId, intentToken }: { ownerId: string; initialWorkspaceId?: string; intentToken?: string }) {
  const t = useWorkspaceCopy(), { locale } = useLocale(), router = useRouter();
  const access = useWorkspaceAccess(ownerId), { run } = access;
  const memberships = access.account.viewer?.user.id === ownerId ? access.account.viewer.workspaces : [];
  const [selectedWorkspace, setSelectedWorkspace] = useState(initialWorkspaceId ?? '');
  const workspaceId = initialWorkspaceSelection(memberships.map((item) => item.workspaceId), selectedWorkspace || initialWorkspaceId);
  const membership = memberships.find((item) => item.workspaceId === workspaceId);
  const [list, dispatchList] = useReducer(projectListReducer, initialProjectListState);
  const [query, setQuery] = useState(''), [status, setStatus] = useState<'active' | 'archived'>('active');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false), [title, setTitle] = useState(''), [goal, setGoal] = useState('');
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [discarded, setDiscarded] = useState(false);
  const requestKey = useRef<{ value: string; key: string } | undefined>(undefined);
  const projectCreation = useRef<RequestAttempt<CreateProject> | undefined>(undefined);
  const serial = useRef(0);
  const cursor = useRef('');
  const restoredIntent = useRef<string | undefined>(undefined);
  const validWorkspace = Boolean(membership);
  const active = access.phase === 'active';
  const context = `${ownerId}:${workspaceId}:${status}:${query}`;
  const page = list.context === context ? list.page : undefined;
  const loading = list.context !== context || list.loading, error = list.context === context ? list.error : undefined;
  const leave = useWorkspaceLeaveGuard(active && Boolean(title || goal || workspaceName), saving || uncertain);
  useEffect(() => {
    if (!active || !intentToken || restoredIntent.current === intentToken) return;
    const controller = new AbortController();
    void run((signal) => identityClient.restoreIntent({ intentToken }, { expectedUserId: ownerId, signal }), controller.signal).then((intent) => {
      restoredIntent.current = intentToken; setGoal((current) => restoreEntryGoal(current, intent.goal)); setOpen(true);
    }).catch((failure) => { if (!controller.signal.aborted) setSaveError(failure); });
    return () => controller.abort();
  }, [active, intentToken, ownerId, run, router, workspaceId]);

  useEffect(() => {
    if (!active || !validWorkspace) return;
    const token = ++serial.current, controller = new AbortController();
    const timer = setTimeout(() => {
      dispatchList({ type: 'begin', context, request: token });
      void run((signal) => workspaceClient.list({ workspaceId, status, query, order: 'recent' }, { userId: ownerId, signal }), controller.signal).then((result) => {
        if (token !== serial.current) return;
        dispatchList({ type: 'resolved', context, request: token, page: result, append: false }); cursor.current = result.cursor;
      }).catch((failure) => { if (token === serial.current && !controller.signal.aborted) dispatchList({ type: 'failed', context, request: token, error: failure }); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, validWorkspace, workspaceId, query, status, reload, ownerId, run, context]);

  useEffect(() => {
    if (!active || !validWorkspace) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, failures = 0;
    const controller = new AbortController();
    const tick = async () => {
      let changed = false;
      try {
        if (document.visibilityState === 'visible' && cursor.current) {
          const events = await run((signal) => workspaceClient.events(workspaceId, cursor.current, { userId: ownerId, signal }), controller.signal);
          if (stopped) return;
          cursor.current = events.cursor;
          changed = events.resetRequired || events.events.some((event) => event.kind.startsWith('project.'));
          if (events.resetRequired) { serial.current += 1; dispatchList({ type: 'invalidate' }); }
          if (changed) setReload((value) => value + 1);
        }
        failures = 0;
      } catch { failures += 1; }
      if (!stopped) timer = setTimeout(() => { void tick(); }, failures ? Math.min(60000, 3000 * 2 ** failures) : changed ? 3000 : 15000);
    };
    timer = setTimeout(() => { void tick(); }, 3000);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [active, validWorkspace, workspaceId, ownerId, run]);

  if (access.phase === 'discarded' && !discarded) { setDiscarded(true); dispatchList({ type: 'invalidate' }); setTitle(''); setGoal(''); setWorkspaceName(''); }
  useEffect(() => { if (access.phase === 'discarded') { requestKey.current = undefined; projectCreation.current = undefined; } }, [access.phase]);

  async function more() {
    if (!page?.nextAfter || loading) return;
    const token = ++serial.current;
    dispatchList({ type: 'begin', context, request: token });
    try {
      const result = await run((signal) => workspaceClient.list({ workspaceId, status, query, order: 'recent', after: page.nextAfter! }, { userId: ownerId, signal }));
      if (token !== serial.current) return;
      dispatchList({ type: 'resolved', context, request: token, page: result, append: true });
    } catch (failure) { if (token === serial.current) dispatchList({ type: 'failed', context, request: token, error: failure }); }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault(); if (saving || !title.trim() || !membership) return;
    const input = { workspaceId, title, goal: goal || null, expectedAuthzVersion: page?.authzVersion ?? membership.authzVersion };
    const attempt = projectCreation.current ?? retainRequestAttempt(undefined, { workspaceId, title, goal: goal || null }, () => input);
    projectCreation.current = attempt;
    setSaving(true); setSaveError(undefined);
    try {
      const result = await run((signal) => workspaceClient.create(attempt.input, attempt.key, { userId: ownerId, signal }));
      projectCreation.current = undefined; setUncertain(false); setOpen(false); setTitle(''); setGoal('');
      router.push(`/app/projects/${result.project.id}`);
    } catch (failure) { const rejected = isDefiniteRequestRejection(failure); if (rejected) projectCreation.current = undefined; setUncertain(!rejected); setSaveError(failure); }
    finally { setSaving(false); }
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault(); if (!workspaceName.trim() || saving) return;
    const value = JSON.stringify({ name: workspaceName });
    if (requestKey.current?.value !== value) requestKey.current = { value, key: crypto.randomUUID() };
    setSaving(true); setSaveError(undefined);
    try {
      const result = await run((signal) => identityClient.createWorkspace({ name: workspaceName }, requestKey.current!.key, { expectedUserId: ownerId, signal }));
      await access.account.refresh(); setSelectedWorkspace(result.workspace.workspaceId); setWorkspaceName(''); requestKey.current = undefined;
    } catch (failure) { setSaveError(failure); }
    finally { setSaving(false); }
  }

  if (!active) return <WorkspaceShell><WorkspaceAccessState access={access} returnTo="/app/work" /></WorkspaceShell>;
  if (!memberships.length) return <WorkspaceShell beforeSignOut={leave.beforeSignOut} onClickCapture={leave.onClickCapture}><main className={styles.main}>{leave.confirmation}<section className={styles.noWorkspace}><h1>{t.noWorkspace}</h1><p className={styles.muted}>{t.noWorkspaceDescription}</p><form className={styles.form} onSubmit={createWorkspace}><InputField label={t.workspaceName} required maxLength={100} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /><WorkspaceError error={saveError} saving /><Button variant="primary" type="submit" icon={Plus} pending={saving}>{t.createWorkspace}</Button></form></section></main></WorkspaceShell>;
  return <WorkspaceShell workspaceId={workspaceId} beforeSignOut={leave.beforeSignOut} onClickCapture={leave.onClickCapture}><main className={styles.main}>
    {leave.confirmation}
    <header className={styles.pageHeading}><h1>{t.work}</h1><div className={styles.actions}>
      {memberships.length > 1 && <SelectField className={styles.workspaceSelect} label={t.workspace} value={workspaceId} disabled={saving || uncertain} onChange={(event) => { setSelectedWorkspace(event.target.value); dispatchList({ type: 'invalidate' }); cursor.current = ''; router.replace(workEntryHref(event.target.value, intentToken)); }}><option value="" disabled>{t.chooseWorkspace}</option>{memberships.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</SelectField>}
      {membership?.scopes.includes('edit') && <Button variant="primary" icon={Plus} onClick={() => { setOpen(true); setSaveError(undefined); }}>{t.newProject}</Button>}
    </div></header>
    <div className={styles.filters}><Tabs label={t.projects} items={[{ id: 'active', label: t.active, content: null }, { id: 'archived', label: t.archived, content: null }]} value={status} onChange={(value) => setStatus(value as 'active' | 'archived')} /><InputField type="search" label={t.search} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} /></div>
    {!validWorkspace && <EmptyState icon={Folder} title={workspaceId ? t.forbidden : t.chooseWorkspace} description={workspaceId ? t.forbiddenDescription : t.chooseWorkspaceDescription} action={workspaceId ? <Button onClick={() => { setSelectedWorkspace(''); router.replace(workEntryHref(undefined, intentToken)); }}>{t.back}</Button> : undefined} />}
    <WorkspaceError error={error} retry={() => setReload((value) => value + 1)} />
    {validWorkspace && loading && !page && <LoadingState />}
    {page && page.projects.length === 0 && <EmptyState icon={query ? Search : FolderPlus} title={query ? t.noResults : t.emptyTitle} description={query ? t.noResultsDescription : t.emptyDescription} action={!query && membership?.scopes.includes('edit') ? <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>{t.newProject}</Button> : undefined} />}
    {page && page.projects.length > 0 && <><div className={styles.sectionHeading}><h2>{status === 'active' && !query ? t.recent : t.projects}</h2></div><ul className={styles.projects}>{page.projects.map((project) => <li className={styles.project} key={project.id}><Link href={`/app/projects/${project.id}?resume=1`} prefetch={false}>
      <span className={styles.projectMark}><Folder size={26} /></span><h2>{project.title}</h2>{project.goal && <p>{project.goal}</p>}
      <div className={styles.projectFooter}><time dateTime={project.updatedAt}>{formatInstant(locale, project.updatedAt, { dateStyle: 'medium' })}</time><span>{t.open} <ArrowUpRight size={16} /></span></div>
    </Link></li>)}</ul></>}
    {page?.nextAfter && <div className={styles.more}><Button pending={loading} onClick={() => { void more(); }}>{t.more}</Button></div>}
    <Dialog open={open && validWorkspace} onOpenChange={setOpen} title={t.newProject} dismissible={!saving && !uncertain} dirty={Boolean(title || goal)} onDiscard={() => { setTitle(''); setGoal(''); projectCreation.current = undefined; router.replace(workEntryHref(workspaceId)); }} footer={<><DialogClose disabled={saving || uncertain}>{t.cancel}</DialogClose><Button variant="primary" type="submit" form="new-project" icon={Plus} pending={saving}>{uncertain ? t.checkCreation : t.create}</Button></>}>
      <form id="new-project" className={styles.form} onSubmit={create}><InputField label={t.title} placeholder={t.titleHint} required maxLength={240} disabled={saving || uncertain} value={title} onChange={(event) => setTitle(event.target.value)} /><TextareaField label={t.goal} placeholder={t.goalHint} maxLength={12000} rows={5} disabled={saving || uncertain} value={goal} onChange={(event) => setGoal(event.target.value)} />{uncertain ? <p role="status">{t.uncertainCreation}</p> : <WorkspaceError error={saveError} saving />}</form>
    </Dialog>
  </main></WorkspaceShell>;
}
