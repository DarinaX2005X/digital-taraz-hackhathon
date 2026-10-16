'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, FileSpreadsheet, FileText, Folder, FolderPlus, Image, LayoutList, Plus, RefreshCw, Search, Trash2, Upload, XCircle } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { RunInputRef } from '@/contracts/runs';
import type { SourceUpload } from '@/contracts/sources';
import { useLocale } from '@/i18n/provider';
import { formatInstant } from '@/i18n';
import { identityClient } from '@/features/identity/ui';
import { runClient } from '@/features/runs/client/transport';
import { sourceClient } from '@/features/sources/client/transport';
import { Button, Dialog, DialogClose, EmptyState, InputField, LoadingState, SelectField, Tabs, TextareaField } from '@/ui';
import { workspaceClient } from '../client/transport';
import type { CreateProject } from '../contracts';
import { WorkspaceAccessState, WorkspaceError, WorkspaceShell, useWorkspaceAccess, useWorkspaceCopy } from './shell';
import styles from './workspace.module.css';
import { useWorkspaceLeaveGuard } from './leave-guard';
import { isDefiniteRequestRejection, retainRequestAttempt, type RequestAttempt } from '../domain/request-attempt';
import { initialProjectListState, projectListReducer } from '../domain/project-list-state';
import { initialWorkspaceSelection, restoreEntryGoal, workEntryHref } from '../domain/work-entry';
import { suggestedProjectName } from '../domain/project-name';
import { entryDraftKey, readEntryDraft, type EntryDraft } from '../domain/entry-draft';
import { addComposerFile, matchesComposerFile, restoreComposerAttachments, sourceUploadInput, type ComposerAttachment } from '../domain/composer-attachments';
import { prepareTaskRequest, type TaskRequest } from '../domain/task-request';
import { TourGuide } from '@/features/onboarding/tour';

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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]), [dragging, setDragging] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string>();
  const [manualKind, setManualKind] = useState<'document' | 'table' | 'design' | 'plan'>('document'), [manualTitle, setManualTitle] = useState('');
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [discarded, setDiscarded] = useState(false);
  const [draftReady, setDraftReady] = useState(false), [workspaceUncertain, setWorkspaceUncertain] = useState(false);
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);
  const workspaceCreation = useRef<{ name: string; key: string } | undefined>(undefined);
  const confirmedWorkspaceId = useRef<string | undefined>(undefined);
  const confirmedProjectId = useRef<string | undefined>(undefined);
  const projectCreation = useRef<RequestAttempt<CreateProject> | undefined>(undefined);
  const runRequest = useRef<TaskRequest | undefined>(undefined);
  const files = useRef(new Map<string, File>());
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const cursor = useRef('');
  const restoredIntent = useRef<string | undefined>(undefined);
  const restoredDraftOwner = useRef<string | undefined>(undefined);
  const validWorkspace = Boolean(membership);
  const active = access.phase === 'active';
  const context = `${ownerId}:${workspaceId}:${status}:${query}`;
  const page = list.context === context ? list.page : undefined;
  const loading = list.context !== context || list.loading, error = list.context === context ? list.error : undefined;
  const composerBlocked = attachments.some((item) => item.state === 'needs-file' || item.state === 'needs-review');
  const composerStateCopy: Record<ComposerAttachment['state'], string> = {
    local: t.composerFile_local, 'needs-file': t.composerFile_needsFile, uploading: t.composerFile_uploading,
    processing: t.composerFile_processing, 'retry-processing': t.composerFile_retryProcessing, ready: t.composerFile_ready,
    'needs-review': t.composerFile_needsReview, failed: t.composerFile_failed,
  };
  const leave = useWorkspaceLeaveGuard(active && Boolean(title || goal || workspaceName || manualTitle || attachments.length), saving || uncertain || workspaceUncertain);
  function persistEntry(overrides: Partial<EntryDraft> = {}, attachmentSnapshot = attachmentsRef.current) {
    try { sessionStorage.setItem(entryDraftKey(ownerId, intentToken), JSON.stringify({ title, goal, workspaceName, selectedWorkspace, manualTitle, manualKind, attachments: attachmentSnapshot, projectRequest: projectCreation.current, runRequest: runRequest.current, workspaceRequest: workspaceCreation.current, confirmedWorkspaceId: confirmedWorkspaceId.current, confirmedProjectId: confirmedProjectId.current, ...overrides })); }
    catch { setDraftStorageFailed(true); }
  }
  function discardEntry() {
    try { sessionStorage.removeItem(entryDraftKey(ownerId, intentToken)); } catch { /* The in-memory draft is cleared below. */ }
  }
  useEffect(() => {
    if (restoredDraftOwner.current === entryDraftKey(ownerId, intentToken)) return;
    const timer = setTimeout(() => {
      const previousKey = restoredDraftOwner.current;
      restoredDraftOwner.current = entryDraftKey(ownerId, intentToken);
      try {
        const draft = readEntryDraft(sessionStorage.getItem(entryDraftKey(ownerId, intentToken)));
        if (draft) {
          setTitle(draft.title); setGoal(draft.goal); setWorkspaceName(draft.workspaceName); setManualTitle(draft.manualTitle ?? ''); setManualKind(draft.manualKind ?? 'document'); setSelectedWorkspace(draft.projectRequest?.input.workspaceId ?? initialWorkspaceId ?? draft.selectedWorkspace);
          projectCreation.current = draft.projectRequest; workspaceCreation.current = draft.workspaceRequest;
          confirmedWorkspaceId.current = draft.confirmedWorkspaceId; confirmedProjectId.current = draft.confirmedProjectId; setSavedProjectId(draft.confirmedProjectId); runRequest.current = draft.runRequest;
          const restoredAttachments = restoreComposerAttachments(draft.attachments ?? []); attachmentsRef.current = restoredAttachments; setAttachments(restoredAttachments);
          setUncertain(Boolean(draft.projectRequest || draft.runRequest)); setWorkspaceUncertain(Boolean(draft.workspaceRequest));
          setOpen(Boolean(draft.manualTitle || draft.projectRequest?.input.goal === null));
        } else if (previousKey) {
          setTitle(''); setGoal(''); setWorkspaceName(''); setManualTitle(''); setManualKind('document'); setUncertain(false); setWorkspaceUncertain(false);
          projectCreation.current = undefined; workspaceCreation.current = undefined; runRequest.current = undefined; confirmedProjectId.current = undefined; setSavedProjectId(undefined); files.current.clear(); attachmentsRef.current = []; setAttachments([]);
        }
      } catch { setDraftStorageFailed(true); }
      setDraftReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [ownerId, initialWorkspaceId, intentToken]);
  useEffect(() => {
    if (!draftReady || !active || restoredDraftOwner.current !== entryDraftKey(ownerId, intentToken)) return;
    try { sessionStorage.setItem(entryDraftKey(ownerId, intentToken), JSON.stringify({ title, goal, workspaceName, selectedWorkspace, manualTitle, manualKind, attachments, projectRequest: projectCreation.current, runRequest: runRequest.current, workspaceRequest: workspaceCreation.current, confirmedWorkspaceId: confirmedWorkspaceId.current, confirmedProjectId: confirmedProjectId.current })); }
    catch { queueMicrotask(() => setDraftStorageFailed(true)); }
  }, [draftReady, active, ownerId, intentToken, title, goal, workspaceName, manualTitle, manualKind, selectedWorkspace, attachments, saving, uncertain, workspaceUncertain]);
  useEffect(() => {
    if (!active || !intentToken || restoredIntent.current === intentToken) return;
    const controller = new AbortController();
    void run((signal) => identityClient.restoreIntent({ intentToken }, { expectedUserId: ownerId, signal }), controller.signal).then((intent) => {
      restoredIntent.current = intentToken; setGoal((current) => restoreEntryGoal(current, intent.goal));
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

  if (access.phase === 'discarded' && !discarded) { setDiscarded(true); dispatchList({ type: 'invalidate' }); setTitle(''); setGoal(''); setWorkspaceName(''); setAttachments([]); setSavedProjectId(undefined); }
  useEffect(() => { if (access.phase === 'discarded') { workspaceCreation.current = undefined; projectCreation.current = undefined; runRequest.current = undefined; confirmedProjectId.current = undefined; files.current.clear(); attachmentsRef.current = []; try { sessionStorage.removeItem(entryDraftKey(ownerId, intentToken)); } catch { /* No tab data is accessible. */ } } }, [access.phase, ownerId, intentToken]);

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

  function replaceAttachment(id: string, change: Partial<ComposerAttachment>) {
    const next = attachmentsRef.current.map((item) => item.id === id ? { ...item, ...change } : item);
    attachmentsRef.current = next; setAttachments(next); persistEntry({ attachments: next }, next);
  }

  function addFiles(selected: FileList | readonly File[]) {
    if (saving) return;
    let invalid = false;
    const next = [...attachmentsRef.current];
    for (const file of Array.from(selected)) {
      const resumable = next.find((item) => ['needs-file', 'retry-processing', 'failed'].includes(item.state) && matchesComposerFile(item, file));
      if (resumable) { files.current.set(resumable.id, file); Object.assign(resumable, { state: 'local' as const }); continue; }
      if (next.length >= 20) { invalid = true; continue; }
      const attachment = addComposerFile(file);
      if (!attachment) { invalid = true; continue; }
      files.current.set(attachment.id, file); next.push(attachment);
    }
    attachmentsRef.current = next; setAttachments(next); persistEntry({ attachments: next }, next);
    setSaveError(invalid ? new Error('composer-invalid-file') : undefined);
  }

  function removeAttachment(attachment: ComposerAttachment) {
    if (saving) return;
    files.current.delete(attachment.id);
    const next = attachmentsRef.current.filter((item) => item.id !== attachment.id);
    attachmentsRef.current = next; setAttachments(next); persistEntry({ attachments: next }, next);
    if (attachment.uploadId && attachment.state !== 'ready') void run((signal) => sourceClient.cancel(workspaceId, attachment.uploadId!, { userId: ownerId, signal }), undefined, false).catch(() => undefined);
  }

  async function uploadAttachment(attachment: ComposerAttachment, projectId: string): Promise<RunInputRef> {
    let current = attachment;
    const update = (change: Partial<ComposerAttachment>) => { current = { ...current, ...change }; replaceAttachment(current.id, change); };
    try {
      if (current.state === 'ready' && current.sourceId && current.currentVersionId && current.revision) {
        const pinned = await run((signal) => sourceClient.readVersion(workspaceId, current.sourceId!, current.currentVersionId!, { userId: ownerId, signal }), undefined, false);
        if (pinned.projectId !== projectId || pinned.sourceRef.revision !== current.revision) throw new Error('composer-source-changed');
        return { kind: 'source', id: current.sourceId, revision: current.revision };
      }
      let upload: SourceUpload;
      if (current.state === 'retry-processing' && current.uploadId && current.sourceId) {
        update({ state: 'processing' });
        upload = (await run((signal) => sourceClient.finalize(workspaceId, current.uploadId!, { userId: ownerId, signal }))).upload;
      } else {
        const file = files.current.get(current.id);
        if (!file || !matchesComposerFile(current, file)) { update({ state: 'needs-file' }); throw new Error('composer-file-required'); }
        update({ state: 'uploading' });
        const initialized = await run((signal) => sourceClient.init(sourceUploadInput(current, workspaceId, projectId), current.operationKey, { userId: ownerId, signal }));
        upload = initialized.upload;
        update({ sourceId: upload.sourceId, uploadId: upload.id });
        if (upload.status === 'pending') {
          if (!initialized.token) throw new Error('composer-upload-retry');
          upload = (await run((signal) => sourceClient.put(workspaceId, upload.id, initialized.token!, file, { userId: ownerId, signal }))).upload;
        }
        if (upload.status === 'uploaded' || upload.status === 'failed' && upload.byteHash) { update({ state: 'processing' }); upload = (await run((signal) => sourceClient.finalize(workspaceId, upload.id, { userId: ownerId, signal }))).upload; }
      }
      if (upload.status === 'partial') { update({ state: 'needs-review', sourceId: upload.sourceId, uploadId: upload.id }); throw new Error('composer-review-required'); }
      if (upload.status !== 'ready' || !upload.versionId) throw new Error('composer-upload-retry');
      const pinned = await run((signal) => sourceClient.readVersion(workspaceId, upload.sourceId, upload.versionId!, { userId: ownerId, signal }), undefined, false);
      if (pinned.projectId !== projectId) throw new Error('composer-source-changed');
      update({ state: 'ready', sourceId: upload.sourceId, uploadId: upload.id, currentVersionId: upload.versionId, revision: pinned.sourceRef.revision });
      return { kind: 'source', id: upload.sourceId, revision: pinned.sourceRef.revision };
    } catch (failure) {
      if (current.state !== 'needs-file' && current.state !== 'needs-review') update({ state: current.uploadId && current.sourceId ? 'retry-processing' : 'failed' });
      throw failure;
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !draftReady || !goal.trim() || !membership || attachments.some((item) => item.state === 'needs-file')) return;
    setSaving(true); setSaveError(undefined);
    try {
      let projectId = confirmedProjectId.current;
      if (!projectId) {
        const name = title.trim() || suggestedProjectName(goal, t.newProject);
        const input = { workspaceId, title: name, goal: goal || null, expectedAuthzVersion: page?.authzVersion ?? membership.authzVersion };
        const attempt = projectCreation.current ?? retainRequestAttempt(undefined, { workspaceId, title: name, goal: goal || null }, () => input);
        projectCreation.current = attempt; persistEntry();
        const result = await run((signal) => workspaceClient.create(attempt.input, attempt.key, { userId: ownerId, signal }));
        projectId = result.project.id; confirmedProjectId.current = projectId; setSavedProjectId(projectId); projectCreation.current = undefined; setUncertain(false);
        persistEntry({ confirmedProjectId: projectId, projectRequest: undefined });
      }
      const inputRefs: RunInputRef[] = [];
      for (const attachment of attachments) inputRefs.push(await uploadAttachment(attachment, projectId));
      if (!runRequest.current) {
        runRequest.current = prepareTaskRequest({ workspaceId, projectId, goal, locale, sources: [], selected: inputRefs.map((ref) => ref.id), pinned: inputRefs });
        persistEntry({ runRequest: runRequest.current });
      }
      const started = await run((signal) => runClient.create(runRequest.current!.input, runRequest.current!.key, { userId: ownerId, signal }));
      runRequest.current = undefined; projectCreation.current = undefined; confirmedProjectId.current = undefined; setSavedProjectId(undefined); discardEntry();
      try { sessionStorage.removeItem('tirlik.public-goal.v1'); } catch { /* The saved project remains authoritative. */ }
      setUncertain(false); attachmentsRef.current = []; setAttachments([]); files.current.clear();
      router.push(`/app/projects/${projectId}?run=${started.id}`);
    } catch (failure) {
      const rejected = isDefiniteRequestRejection(failure);
      if (rejected && projectCreation.current) projectCreation.current = undefined;
      if (rejected && runRequest.current) runRequest.current = undefined;
      setUncertain(Boolean(projectCreation.current || runRequest.current)); setSaveError(failure); persistEntry();
    } finally { setSaving(false); }
  }

  async function createManual(event: React.FormEvent) {
    event.preventDefault(); if (saving || !draftReady || !membership) return;
    const name = manualTitle.trim() || t[manualKind];
    const input = { workspaceId, title: name, goal: null, expectedAuthzVersion: page?.authzVersion ?? membership.authzVersion };
    const attempt = projectCreation.current ?? retainRequestAttempt(undefined, { mode: 'manual', workspaceId, title: name, kind: manualKind }, () => input);
    projectCreation.current = attempt; persistEntry(); setSaving(true); setSaveError(undefined);
    try {
      const result = await run((signal) => workspaceClient.create(attempt.input, attempt.key, { userId: ownerId, signal }));
      projectCreation.current = undefined;
      if (title || goal) persistEntry({ projectRequest: undefined, manualTitle: '', manualKind: 'document' }); else discardEntry();
      setUncertain(false); setOpen(false); setManualTitle(''); setManualKind('document');
      router.push(`/app/projects/${result.project.id}?create=${manualKind}`);
    } catch (failure) { const rejected = isDefiniteRequestRejection(failure); if (rejected) projectCreation.current = undefined; setUncertain(!rejected); setSaveError(failure); }
    finally { setSaving(false); }
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault(); if (saving || !draftReady) return;
    if (confirmedWorkspaceId.current) {
      setSaving(true); setSaveError(undefined);
      try { await access.account.refresh(); setSelectedWorkspace(confirmedWorkspaceId.current); }
      catch (failure) { setSaveError(failure); }
      finally { setSaving(false); }
      return;
    }
    const name = workspaceName.trim() || t.personalWorkspace;
    const attempt = workspaceCreation.current ?? { name, key: crypto.randomUUID() };
    workspaceCreation.current = attempt;
    persistEntry();
    setSaving(true); setSaveError(undefined);
    try {
      const result = await run((signal) => identityClient.createWorkspace({ name: attempt.name }, attempt.key, { expectedUserId: ownerId, signal }));
      workspaceCreation.current = undefined; setWorkspaceUncertain(false);
      confirmedWorkspaceId.current = result.workspace.workspaceId;
      persistEntry({ selectedWorkspace: result.workspace.workspaceId, workspaceName: '', workspaceRequest: undefined });
      setSelectedWorkspace(result.workspace.workspaceId); setWorkspaceName('');
      await access.account.refresh().catch(setSaveError);
    } catch (failure) { const rejected = isDefiniteRequestRejection(failure); if (rejected) workspaceCreation.current = undefined; setWorkspaceUncertain(!rejected); setSaveError(failure); }
    finally { setSaving(false); }
  }

  if (!active) return <WorkspaceShell><WorkspaceAccessState access={access} returnTo="/app/work" /></WorkspaceShell>;
  if (!memberships.length) return <WorkspaceShell beforeSignOut={leave.beforeSignOut} onSignedOut={discardEntry} onClickCapture={leave.onClickCapture}><main className={styles.main}>{leave.confirmation}<section className={styles.noWorkspace}><h1>{t.noWorkspace}</h1><p className={styles.muted}>{t.noWorkspaceDescription}</p><form className={styles.form} onSubmit={createWorkspace}><InputField label={t.workspaceName} placeholder={t.personalWorkspace} maxLength={100} value={workspaceName} disabled={saving || workspaceUncertain} onChange={(event) => setWorkspaceName(event.target.value)} /><WorkspaceError error={saveError} saving />{draftStorageFailed && <p role="status">{t.draftNotSaved}</p>}<Button variant="primary" type="submit" icon={Plus} pending={saving} disabled={!draftReady}>{workspaceUncertain ? t.checkCreation : t.createWorkspace}</Button></form></section></main></WorkspaceShell>;
  return <WorkspaceShell workspaceId={workspaceId} beforeSignOut={leave.beforeSignOut} onSignedOut={discardEntry} onClickCapture={leave.onClickCapture}><main className={styles.main}>
    {leave.confirmation}
    {membership?.scopes.includes('edit') && <TourGuide ownerId={ownerId} anchors={{ start: 'work-task-goal' }} />}
    {draftStorageFailed && <p role="status" className={styles.error}>{t.draftNotSaved}</p>}
    <header className={`${styles.pageHeading} ${styles.workHeading}`}><div><h1>{t.workIntro}</h1><p>{t.workIntroDescription}</p></div><div className={styles.actions}>
      {memberships.length > 1 && <SelectField className={styles.workspaceSelect} label={t.workspace} value={workspaceId} disabled={saving || uncertain || attachments.length > 0 || Boolean(savedProjectId)} onChange={(event) => { setSelectedWorkspace(event.target.value); dispatchList({ type: 'invalidate' }); cursor.current = ''; router.replace(workEntryHref(event.target.value, intentToken)); }}><option value="" disabled>{t.chooseWorkspace}</option>{memberships.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</SelectField>}
      {membership?.scopes.includes('edit') && <Button icon={Plus} disabled={saving || uncertain} onClick={() => { setOpen(true); setSaveError(undefined); }}>{t.manualCreate}</Button>}
    </div></header>
    <div className={styles.workBoard}>
      {validWorkspace && membership?.scopes.includes('edit') && <section className={styles.workComposer} aria-labelledby="work-composer-title"><h2 id="work-composer-title" className="tirlik-sr-only">{t.workIntro}</h2><form id="work-start" className={styles.form} onSubmit={create}><TextareaField id="work-task-goal" label={t.workIntro} placeholder={t.goalHint} required maxLength={12000} rows={7} disabled={saving || uncertain || Boolean(savedProjectId)} value={goal} onChange={(event) => setGoal(event.target.value)} /><details className={styles.projectDetails}><summary>{t.optionalProjectName}</summary><InputField label={t.title} placeholder={suggestedProjectName(goal, t.newProject)} maxLength={240} disabled={saving || uncertain || Boolean(savedProjectId)} value={title} onChange={(event) => setTitle(event.target.value)} /></details>
        <div className={styles.composerDropzone} data-dragging={dragging || undefined} onDragEnter={(event) => { event.preventDefault(); if (!saving) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
          <input ref={fileInput} id="work-source-input" className="tirlik-sr-only" type="file" multiple disabled={saving} accept=".txt,.md,.csv,.tsv,.xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
          <div><Upload size={21} aria-hidden="true" /><span><strong>{t.ownMaterials}</strong><small>{t.composerDropHint}</small></span><label className="tl-button tl-button--secondary" htmlFor="work-source-input" aria-disabled={saving}>{t.chooseFiles}</label></div>
        </div>
        {attachments.length > 0 && <ul className={styles.composerFiles}>{attachments.map((attachment) => <li key={attachment.id} data-state={attachment.state}><FileText size={19} aria-hidden="true" /><span><strong>{attachment.fileName}</strong><small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB · {composerStateCopy[attachment.state]}</small></span>{attachment.state === 'ready' ? <Check size={18} aria-label={t.composerFile_ready} /> : attachment.state === 'failed' || attachment.state === 'retry-processing' ? <XCircle size={18} aria-label={composerStateCopy[attachment.state]} /> : attachment.state === 'needs-file' ? <Button variant="quiet" icon={RefreshCw} onClick={() => fileInput.current?.click()}>{t.reselectFile}</Button> : attachment.state === 'needs-review' && attachment.sourceId ? <Link href={`/app/materials/sources/${attachment.sourceId}?workspaceId=${workspaceId}`}>{t.reviewFile}</Link> : null}<Button variant="quiet" icon={Trash2} disabled={saving} onClick={() => removeAttachment(attachment)}>{t.removeFile}</Button></li>)}</ul>}
        {savedProjectId && <p className={styles.composerSaved} role="status">{t.composerProjectSaved}</p>}
        {uncertain ? <p role="status">{t.taskUncertain}</p> : saveError instanceof Error && saveError.message.startsWith('composer-') ? <div className={styles.error} role="alert"><p>{saveError.message === 'composer-invalid-file' ? t.composerInvalidFile : saveError.message === 'composer-file-required' ? t.composerReselectRequired : saveError.message === 'composer-review-required' ? t.composerReviewRequired : saveError.message === 'composer-source-changed' ? t.composerSourceChanged : t.composerRetryFile}</p></div> : <WorkspaceError error={saveError} saving />}
        <div className={styles.composerActions}><Button variant="primary" type="submit" icon={ArrowUpRight} pending={saving} disabled={!draftReady || !goal.trim() || composerBlocked}>{uncertain ? t.taskCheck : t.startTask}</Button><label className="tl-button tl-button--secondary" htmlFor="work-source-input" aria-disabled={saving}><Upload size={18} />{t.ownMaterials}</label><Button icon={Plus} disabled={saving || uncertain || Boolean(savedProjectId)} onClick={() => setOpen(true)}>{t.manualCreate}</Button></div>
      </form></section>}
      <section className={styles.workLedger} aria-label={t.projects}>
        <div className={styles.filters}><Tabs label={t.projects} items={[{ id: 'active', label: t.active, content: null }, { id: 'archived', label: t.archived, content: null }]} value={status} onChange={(value) => setStatus(value as 'active' | 'archived')} /><InputField type="search" label={t.search} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} /></div>
        {!validWorkspace && <EmptyState icon={Folder} title={workspaceId ? t.forbidden : t.chooseWorkspace} description={workspaceId ? t.forbiddenDescription : t.chooseWorkspaceDescription} action={workspaceId ? <Button onClick={() => { setSelectedWorkspace(''); router.replace(workEntryHref(undefined, intentToken)); }}>{t.back}</Button> : undefined} />}
        <WorkspaceError error={error} retry={() => setReload((value) => value + 1)} />
        {validWorkspace && loading && !page && <LoadingState />}
        {page && page.projects.length === 0 && <EmptyState icon={query ? Search : FolderPlus} title={query ? t.noResults : t.emptyTitle} description={query ? t.noResultsDescription : t.emptyDescription} />}
        {page && page.projects.length > 0 && <><div className={styles.sectionHeading}><h2>{status === 'active' && !query ? t.recentSessions : t.projects}</h2></div><ul className={styles.projects}>{page.projects.map((project) => <li className={styles.project} key={project.id}><Link href={`/app/projects/${project.id}?resume=1`} prefetch={false}>
          <span className={styles.projectMark}><Folder size={26} /></span><h2>{project.title}</h2>{project.goal && <p>{project.goal}</p>}
          <div className={styles.projectFooter}><time dateTime={project.updatedAt}>{formatInstant(locale, project.updatedAt, { dateStyle: 'medium' })}</time><span>{t.open} <ArrowUpRight size={16} /></span></div>
        </Link></li>)}</ul></>}
        {page?.nextAfter && <div className={styles.more}><Button pending={loading} onClick={() => { void more(); }}>{t.more}</Button></div>}
      </section>
    </div>
    <Dialog open={open && validWorkspace} onOpenChange={setOpen} title={t.manualCreate} dismissible={!saving && !uncertain} dirty={Boolean(manualTitle)} onDiscard={() => { setManualTitle(''); projectCreation.current = undefined; }} footer={<><DialogClose disabled={saving || uncertain}>{t.cancel}</DialogClose><Button variant="primary" type="submit" form="manual-project" icon={Plus} pending={saving}>{uncertain ? t.checkCreation : t.manualCreate}</Button></>}>
      <form id="manual-project" className={styles.form} onSubmit={createManual}><fieldset className={styles.kindChoices} disabled={saving || uncertain}><legend>{t.materialType}</legend>{([{ kind: 'document', icon: FileText }, { kind: 'table', icon: FileSpreadsheet }, { kind: 'design', icon: Image }, { kind: 'plan', icon: LayoutList }] as const).map(({ kind, icon: Icon }) => <label key={kind}><input type="radio" name="manual-kind" checked={manualKind === kind} onChange={() => setManualKind(kind)} /><Icon size={20} aria-hidden="true" /><span>{t[kind]}</span></label>)}</fieldset><InputField label={t.title} placeholder={t[manualKind]} maxLength={240} disabled={saving || uncertain} value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} />{uncertain ? <p role="status">{t.uncertainCreation}</p> : <WorkspaceError error={saveError} saving />}</form>
    </Dialog>
  </main></WorkspaceShell>;
}
