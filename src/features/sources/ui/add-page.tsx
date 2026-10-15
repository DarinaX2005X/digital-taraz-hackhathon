'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Upload, X } from 'lucide-react';
import { SOURCE_MAX_BYTES, type InitSourceUpload, type SourceFormat, type SourceOptions, type SourceSummary, type SourceUpload } from '@/contracts/sources';
import { useLocale } from '@/i18n/provider';
import { formatNumber } from '@/i18n';
import { Button, CheckboxField, Combobox, InputField, SelectField, Tabs, TextareaField, type OptionLoader, type SelectOption } from '@/ui';
import { useIdentityNavigationGuard } from '@/features/identity/ui/navigation-guard';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { workspaceClient } from '@/features/workspace/client/transport';
import { sourceClient, sourceFileFormat } from '../client/transport';
import { SourceError, SourceStatus, useSourceCopy } from './common';
import styles from './sources.module.css';

export function SourceAddPage({ ownerId, initialWorkspaceId, initialProject, previous }: { ownerId: string; initialWorkspaceId?: string; initialProject?: SelectOption; previous?: SourceSummary }) {
  const t = useSourceCopy(), { locale } = useLocale();
  const access = useWorkspaceAccess(ownerId), { run } = access;
  const memberships = access.account.viewer?.user.id === ownerId ? access.account.viewer.workspaces : [];
  const [selectedWorkspace, setSelectedWorkspace] = useState(initialWorkspaceId ?? '');
  const workspaceId = selectedWorkspace || memberships[0]?.workspaceId || '';
  const [project, setProject] = useState<SelectOption | null>(initialProject ?? null);
  const [mode, setMode] = useState('file'), [file, setFile] = useState<File>(), [text, setText] = useState('');
  const [title, setTitle] = useState(previous?.title ?? ''), [pasteFormat, setPasteFormat] = useState<SourceFormat>('text');
  const [encoding, setEncoding] = useState<SourceOptions['encoding']>('utf-8'), [delimiter, setDelimiter] = useState('');
  const [confidential, setConfidential] = useState(previous?.accessClass === 'confidential');
  const [stage, setStage] = useState<'preparing' | 'uploading' | 'processing'>(), [upload, setUpload] = useState<SourceUpload>();
  const [error, setError] = useState<unknown>(), [dragging, setDragging] = useState(false), [cancelling, setCancelling] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), pendingUpload = useRef<SourceUpload | undefined>(undefined);
  const operation = useRef<{ body: string; key: string } | undefined>(undefined);
  const completed = upload?.status === 'ready' || upload?.status === 'partial';
  const dirty = !completed && Boolean(file || text || title);
  const navigation = useIdentityNavigationGuard(dirty);
  const format = mode === 'file' ? file && sourceFileFormat(file.name) : pasteFormat;
  const loadProjects = useCallback<OptionLoader>(async (query, signal) => {
    if (!workspaceId) return [];
    const result = await run((inner) => workspaceClient.list({ workspaceId, query, limit: 30 }, { userId: ownerId, signal: inner }), signal);
    return result.projects.map((item) => ({ id: item.id, label: item.title }));
  }, [workspaceId, ownerId, run]);

  useEffect(() => () => controller.current?.abort(), []);
  if (access.phase === 'discarded' && !discarded) { setDiscarded(true); setFile(undefined); setText(''); setTitle(''); setProject(null); setUpload(undefined); }
  useEffect(() => { if (access.phase === 'discarded') { pendingUpload.current = undefined; operation.current = undefined; } }, [access.phase]);
  function choose(file: File | undefined) {
    if (!file || stage) return;
    setError(undefined); setUpload(undefined); pendingUpload.current = undefined; operation.current = undefined;
    if (file.size > SOURCE_MAX_BYTES) { setError(t.tooLarge); return; }
    if (!sourceFileFormat(file.name)) { setError(t.unsupported); return; }
    setFile(file); if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (stage || cancelling) return;
    if (!title.trim() || !project || !workspaceId || !format || (mode === 'file' ? !file : !text.trim())) { setError(t.required); return; }
    const bytes = mode === 'file' ? file! : new Blob([text], { type: 'text/plain' });
    if (bytes.size > SOURCE_MAX_BYTES || bytes.size < 1) { setError(t.tooLarge); return; }
    const input: InitSourceUpload = {
      workspaceId, projectId: project.id, title: title.trim(), fileName: mode === 'file' ? file!.name : `${title.trim().slice(0, 220)}.${pasteFormat === 'text' ? 'txt' : pasteFormat}`,
      size: bytes.size, format, expectedRevision: previous?.revision ?? 0, ...(previous ? { sourceId: previous.id } : {}),
      accessClass: confidential ? 'confidential' : 'internal', options: { encoding: mode === 'paste' ? 'utf-8' : encoding, ...(delimiter ? { delimiter: delimiter as ',' | ';' | '\t' } : {}) },
    };
    const body = JSON.stringify(input);
    if (operation.current?.body !== body) operation.current = { body, key: crypto.randomUUID() };
    const request = new AbortController(); controller.current = request;
    setError(undefined); setStage('preparing');
    try {
      const started = await run((signal) => sourceClient.init(input, operation.current!.key, { userId: ownerId, signal }), request.signal);
      pendingUpload.current = started.upload; setUpload(started.upload);
      if (started.token) {
        setStage('uploading');
        const stored = await run((signal) => sourceClient.put(workspaceId, started.upload.id, started.token!, bytes, { userId: ownerId, signal }), request.signal);
        pendingUpload.current = stored.upload; setUpload(stored.upload);
      }
      setStage('processing');
      const result = await run((signal) => sourceClient.finalize(workspaceId, started.upload.id, { userId: ownerId, signal }), request.signal);
      pendingUpload.current = result.upload; setUpload(result.upload);
    } catch (failure) { if (!request.signal.aborted) setError(failure); }
    finally { setStage(undefined); if (controller.current === request) controller.current = null; }
  }
  async function cancel() {
    controller.current?.abort(); setCancelling(true); setError(undefined);
    try {
      if (pendingUpload.current) {
        const result = await run((signal) => sourceClient.cancel(workspaceId, pendingUpload.current!.id, { userId: ownerId, signal }));
        setUpload(result.upload); pendingUpload.current = result.upload;
      }
      operation.current = undefined;
    } catch (failure) { setError(failure); }
    finally { setCancelling(false); setStage(undefined); }
  }
  const returnTo = `/app/materials/add?${new URLSearchParams({ ...(workspaceId ? { workspaceId } : {}), ...(project ? { projectId: project.id } : {}) })}`;
  if (access.phase !== 'active') return <WorkspaceShell workspaceId={workspaceId}><WorkspaceAccessState access={access} returnTo={returnTo} /></WorkspaceShell>;
  return <WorkspaceShell workspaceId={workspaceId}><main className={styles.main} onClickCapture={navigation.onClickCapture}>
    <Link className={styles.back} href={project ? `/app/projects/${project.id}` : '/app/work'}><ArrowLeft size={18} aria-hidden="true" />{project ? t.back : t.work}</Link>
    <div className={styles.heading}><h1>{previous ? t.newVersion : t.add}</h1></div>
    {completed ? <div className={styles.stack}>
      <div className={styles.notice} role="status"><CheckCircle2 size={24} aria-hidden="true" /><div><strong>{t.saved}</strong><p>{title}</p><SourceStatus status={upload.status} /></div></div>
      {upload.status === 'partial' && <p>{t.vision}</p>}
      <div className={styles.actions}><Link className="tl-button tl-button--primary" href={`/app/materials/sources/${upload.sourceId}?workspaceId=${workspaceId}`}><ArrowRight size={20} aria-hidden="true" />{t.open}</Link><Link className="tl-button tl-button--secondary" href={`/app/projects/${project?.id}`}>{t.back}</Link></div>
    </div> : <form onSubmit={submit} className={styles.form}>
      <div className={styles.inputArea}>
        <Tabs label={t.add} value={mode} onChange={(next) => { if (!stage) { setMode(next); setError(undefined); } }} appearance="segmented" items={[
          { id: 'file', label: t.file, disabled: Boolean(stage), content: <div className={styles.drop} data-dragging={dragging} onDragOver={(event) => { event.preventDefault(); if (!stage) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}>
            <FileUp size={44} strokeWidth={1.5} className={styles.dropIcon} aria-hidden="true" />
            <strong>{file?.name ?? t.drop}</strong><p>{file ? `${formatNumber(locale, file.size / 1024, { maximumFractionDigits: 1 })} KB` : t.formats}</p>
            <input className={styles.filePicker} ref={fileInput} type="file" accept=".csv,.tsv,.xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp,.txt,.md" tabIndex={-1} aria-label={t.choose} onChange={(event) => choose(event.target.files?.[0])} />
            <Button icon={Upload} disabled={Boolean(stage)} onClick={() => fileInput.current?.click()}>{t.choose}</Button>
          </div> },
          { id: 'paste', label: t.paste, disabled: Boolean(stage), content: <div className={styles.stack}><TextareaField label={t.text} rows={14} value={text} disabled={Boolean(stage)} onChange={(event) => { setText(event.target.value); operation.current = undefined; }} required={mode === 'paste'} /><SelectField label={t.file} value={pasteFormat} disabled={Boolean(stage)} onChange={(event) => setPasteFormat(event.target.value as SourceFormat)}><option value="text">{t.paste}</option><option value="csv">CSV</option><option value="tsv">TSV</option></SelectField></div> },
        ]} />
        <SourceError error={error} />
        {upload && <div role="status"><SourceStatus status={upload.status} /></div>}
        <div className={styles.actions}><Button type="submit" icon={Upload} variant="primary" pending={Boolean(stage)} pendingLabel={stage ? t[stage] : undefined} disabled={cancelling}>{t.addAction}</Button>{stage && <Button icon={X} pending={cancelling} onClick={() => { void cancel(); }}>{t.cancel}</Button>}{upload && <Link href={`/app/materials/sources/${upload.sourceId}?workspaceId=${workspaceId}`} className="tl-button tl-button--quiet">{t.open}</Link>}</div>
      </div>
      <div className={styles.settings}>
        {memberships.length > 1 && !previous && <SelectField label={t.work} value={workspaceId} disabled={Boolean(stage)} onChange={(event) => { setSelectedWorkspace(event.target.value); setProject(null); }} >{memberships.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</SelectField>}
        <Combobox label={t.project} value={project} onChange={setProject} loadOptions={loadProjects} required disabled={Boolean(stage) || Boolean(previous)} placeholder={t.chooseProject} />
        <InputField label={t.title} value={title} maxLength={240} required disabled={Boolean(stage)} onChange={(event) => setTitle(event.target.value)} />
        {(format === 'csv' || format === 'tsv') && <div className={styles.fieldRow}><SelectField label={t.delimiter} value={delimiter} disabled={Boolean(stage)} onChange={(event) => setDelimiter(event.target.value)}><option value="">{t.automatic}</option><option value=",">{t.comma}</option><option value=";">{t.semicolon}</option><option value={'\t'}>{t.tab}</option></SelectField>{mode === 'file' && <SelectField label={t.encoding} value={encoding} disabled={Boolean(stage)} onChange={(event) => setEncoding(event.target.value as SourceOptions['encoding'])}><option value="utf-8">UTF-8</option><option value="windows-1251">Windows-1251</option></SelectField>}</div>}
        <CheckboxField label={t.confidential} hint={t.confidentialHint} checked={confidential} disabled={Boolean(stage) || Boolean(previous)} onChange={(event) => setConfidential(event.target.checked)} />
      </div>
    </form>}
    {navigation.confirmation}
  </main></WorkspaceShell>;
}
