'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download, FileText, ListFilter, RefreshCw, Table2, Upload, X } from 'lucide-react';
import { type SourceDetail, type SourcePreview, type SourceUpload } from '@/contracts/sources';
import { useLocale } from '@/i18n/provider';
import { formatInstant, formatNumber } from '@/i18n';
import { Button, EmptyState, IconButton, LoadingState } from '@/ui';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { createDocumentImportMemory, DocumentImportPanel } from '@/features/documents/ui/document-import-panel';
import { SheetImportPanel } from '@/features/sheets/ui/sheet-import-panel';
import { sourceClient } from '../client/transport';
import { SourceError, SourceStatus, useSourceCopy } from './common';
import { PrivateSourceImage } from './private-image';
import { SourceRecognitionPanel, type SourceRecognitionMemory } from './recognition-panel';
import styles from './sources.module.css';

export function SourceDetailPage({ ownerId, initial, initialUploadId }: { ownerId: string; initial: SourceDetail; initialUploadId?: string }) {
  const t = useSourceCopy(), { locale } = useLocale(), access = useWorkspaceAccess(ownerId), { run } = access, router = useRouter();
  const { id: sourceId, workspaceId, projectId } = initial.source;
  const [detail, setDetail] = useState(initial), [selectedId, setSelectedId] = useState(initialUploadId ?? initial.uploads[0]?.id ?? '');
  const [preview, setPreview] = useState<SourcePreview>(), [chunk, setChunk] = useState(0), [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [importingId, setImportingId] = useState<string>();
  const [importMemory] = useState(createDocumentImportMemory);
  const [recognitionMemory] = useState<SourceRecognitionMemory>(() => new Map());
  useEffect(() => { if (access.phase === 'discarded') { importMemory.drafts.clear(); recognitionMemory.clear(); } }, [access.phase, importMemory, recognitionMemory]);
  const selected = detail.uploads.find((item) => item.id === selectedId);
  const active = access.phase === 'active';
  const requestContext = `${selectedId}:${chunk}:${reload}:${access.account.authEpoch}:${active}`;
  const [requestedContext, setRequestedContext] = useState(requestContext);
  if (requestContext !== requestedContext) { setRequestedContext(requestContext); setLoading(true); setError(undefined); setPreview(undefined); }
  useEffect(() => {
    if (!active || !selectedId) return;
    const controller = new AbortController();
    void run((signal) => sourceClient.preview(workspaceId, sourceId, selectedId, chunk, { userId: ownerId, signal }), controller.signal).then(setPreview).catch((failure) => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, sourceId, selectedId, chunk, reload, ownerId, active, run]);
  useEffect(() => {
    if (!active || !selected || !['processing', 'uploading', 'uploaded'].includes(selected.status)) return;
    const controller = new AbortController(); let stopped = false, timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      if (document.visibilityState === 'visible') {
        try { const next = await run((signal) => sourceClient.read(workspaceId, sourceId, { userId: ownerId, signal }, selectedId), controller.signal); if (!stopped) { setDetail(next); if (next.uploads.find((item) => item.id === selectedId)?.status !== selected.status) setReload((value) => value + 1); } }
        catch (failure) { if (!stopped) setError(failure); }
      }
      if (!stopped) timer = setTimeout(() => { void update(); }, 5000);
    };
    timer = setTimeout(() => { void update(); }, 3000);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [active, selected, selectedId, ownerId, workspaceId, sourceId, run]);

  async function mutate(action: 'finalize' | 'cancel') {
    if (!selected || busy) return;
    setBusy(true); setError(undefined);
    try {
      await run((signal) => sourceClient[action](workspaceId, selected.id, { userId: ownerId, signal }));
      const next = await run((signal) => sourceClient.read(workspaceId, sourceId, { userId: ownerId, signal }, selectedId));
      setDetail(next); setReload((value) => value + 1);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!selected || busy) return;
    setBusy(true); setError(undefined);
    try {
      const blob = await run((signal) => sourceClient.download(workspaceId, sourceId, selected.id, { userId: ownerId, signal }));
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = selected.fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  const returnTo = `/app/materials/sources/${sourceId}?${new URLSearchParams({ workspaceId, ...(selected ? { uploadId: selected.id, ...(selected.versionId ? { sourceVersionId: selected.versionId } : {}) } : {}) })}`;
  if (!active) return <WorkspaceShell workspaceId={workspaceId}><WorkspaceAccessState access={access} returnTo={returnTo} /></WorkspaceShell>;
  const manifest = selected?.manifest;
  const membership = access.account.viewer?.user.id === ownerId ? access.account.viewer.workspaces.find((item) => item.workspaceId === workspaceId) : undefined;
  const canImport = detail.canEdit && selected?.status === 'ready' && selected.format === 'docx' && membership;
  const notices: Record<string, string> = { 'uneven-rows': t.uneven, 'formulas-not-evaluated': t.formulas, 'spreadsheet-raw-values': t.rawValues, 'document-text-only': t.documentText, 'empty-content': t.emptyContent, 'vision-required': t.vision, 'recognition-review': t.review };
  const fragments = preview?.upload.id === selectedId && preview.ordinal === chunk ? preview.chunk.fragments : [];
  const tableFile = selected && ['csv', 'tsv', 'xlsx'].includes(selected.format);
  const table = tableFile || Boolean(fragments.length && fragments.every((fragment) => fragment.values));
  const image = selected && ['png', 'jpeg', 'webp'].includes(selected.format) && selected.byteHash;
  const canImportTable = detail.canEdit && selected?.status === 'ready' && selected.versionId && tableFile && membership;
  const columns = Math.max(0, ...fragments.map((fragment) => fragment.values?.length ?? 0));
  return <WorkspaceShell workspaceId={workspaceId}><main className={styles.main}>
    <Link className={styles.back} href={`/app/projects/${projectId}`}><ArrowLeft size={18} aria-hidden="true" />{t.back}</Link>
    <div className={styles.heading}><div><h1>{detail.source.title}</h1>{selected && <SourceStatus status={selected.status} />}</div><div className={styles.actions}>
      {selected?.byteHash && <Button icon={Download} pending={busy} onClick={() => { void download(); }}>{t.original}</Button>}
      {canImport && <Button icon={FileText} variant="primary" onClick={() => setImportingId(importingId === selected.id ? undefined : selected.id)}>{t.createDocument}</Button>}
      {selected?.status === 'ready' && selected.versionId && <Link className="tl-button tl-button--primary" href={`/app/projects/${projectId}?${new URLSearchParams({ sourceId, sourceVersionId: selected.versionId })}`}><ArrowRight size={20} aria-hidden="true" />{t.useInTask}</Link>}
      {canImportTable && <Button icon={Table2} onClick={() => setImportingId(importingId === selected.id ? undefined : selected.id)}>{t.createTable}</Button>}
      {detail.canEdit && selected?.status === 'ready' && selected.versionId && selected.manifest?.complete && (tableFile || selected.manifest.rowCount > 0) && <Link className="tl-button tl-button--secondary" href={`/app/materials?${new URLSearchParams({ workspaceId, projectId, sourceId, sourceVersionId: selected.versionId })}`}><ListFilter size={20} aria-hidden="true" />{t.map}</Link>}
      {detail.canEdit && <Link className="tl-button tl-button--secondary" href={`/app/materials/add?${new URLSearchParams({ workspaceId, projectId, sourceId })}`}><Upload size={20} aria-hidden="true" />{t.replace}</Link>}
    </div></div>
    <SourceError error={error} />
    {canImport && importingId === selected.id && <DocumentImportPanel key={`${selected.id}:${access.account.authEpoch}`} memory={importMemory} workspaceId={workspaceId} sourceId={sourceId} uploadId={selected.id} expectedAuthzVersion={membership.authzVersion} userId={ownerId} title={detail.source.title} locale={locale} run={run} onImported={(result) => router.push(`/app/projects/${result.artifact.projectId}/artifacts/${result.artifact.id}`)} />}
    {canImportTable && importingId === selected.id && <SheetImportPanel key={`${selected.id}:${access.account.authEpoch}`} workspaceId={workspaceId} sourceId={sourceId} sourceVersionId={selected.versionId!} userId={ownerId} authzVersion={membership.authzVersion} format={selected.format as 'csv' | 'tsv' | 'xlsx'} />}
    <dl className={styles.summary}>
      {selected && <><div><dt>{t.fileSize}</dt><dd>{formatNumber(locale, selected.byteSize / 1024, { maximumFractionDigits: 1 })} KB</dd></div><div><dt>{t.created}</dt><dd>{formatInstant(locale, selected.createdAt)}</dd></div></>}
      {manifest && <><div><dt>{table ? t.rows : t.fragments}</dt><dd>{formatNumber(locale, table ? manifest.rowCount : manifest.fragmentCount)}</dd></div>{manifest.pageCount > 0 && <div><dt>{t.pages}</dt><dd>{formatNumber(locale, manifest.pageCount)}</dd></div>}</>}
    </dl>
    {manifest?.diagnostics.length ? <div className={styles.diagnostics}>{manifest.diagnostics.map((code) => notices[code] && <p key={code}>{notices[code]}</p>)}</div> : null}
    {selected && detail.editableUploadIds.includes(selected.id) && ['uploaded', 'failed', 'processing', 'partial'].includes(selected.status) && <div className={styles.actions}>{selected.status !== 'partial' && <Button icon={RefreshCw} pending={busy} onClick={() => { void mutate('finalize'); }}>{t.retry}</Button>}<Button icon={X} disabled={busy} onClick={() => { void mutate('cancel'); }}>{t.cancel}</Button></div>}
    {selected?.manifest?.pageCount ? <SourceRecognitionPanel key={`${selected.id}:${access.account.authEpoch}`} workspaceId={workspaceId} uploadId={selected.id} ownerId={ownerId} editable={detail.editableUploadIds.includes(selected.id) && selected.status === 'partial'} run={run} memory={recognitionMemory} onChanged={() => { setReload((value) => value + 1); void run((signal) => sourceClient.read(workspaceId, sourceId, { userId: ownerId, signal }, selectedId)).then(setDetail).catch(setError); }} /> : null}
    <div className={styles.content}>
      <section className={styles.preview} aria-label={t.preview}>
        <div className={styles.previewHeader}><h2>{t.preview}</h2>{selected && <span className={styles.meta}>{selected.fileName}</span>}</div>
        {image && <PrivateSourceImage key={`${selected.id}:${access.account.authEpoch}`} workspaceId={workspaceId} uploadId={selected.id} ownerId={ownerId} fileName={selected.fileName} run={run} />}
        {(!image || fragments.length > 0) && <div className={styles.scroll} aria-busy={loading} tabIndex={0}>
          {loading && !fragments.length ? <LoadingState label={t.loading} /> : fragments.length ? table ? <table className={styles.table}><thead><tr><th scope="col">{t.row}</th>{Array.from({ length: columns }, (_, index) => <th key={index} scope="col">{t.column} {index + 1}</th>)}</tr></thead><tbody>{fragments.map((fragment) => <tr key={fragment.id}><td title={fragment.sheet}>{fragment.sheet && <span>{fragment.sheet}<br /></span>}{fragment.row}</td>{Array.from({ length: columns }, (_, index) => <td key={index}>{fragment.values?.[index] ?? ''}{fragment.formulas?.[String(index)] && <div className={styles.meta}>={fragment.formulas[String(index)]}</div>}</td>)}</tr>)}</tbody></table> : <div className={styles.text}>{fragments.map((fragment) => <div className={styles.fragment} key={fragment.id}>{fragment.page && <span className={styles.meta}>{t.page} {fragment.page}</span>}<p>{fragment.text ?? fragment.values?.map((value) => value || '—').join(' | ')}</p>{fragment.review === 'needs-review' && <span className={styles.meta}>{t.review}</span>}</div>)}</div> : <EmptyState icon={FileText} title={manifest ? t.empty : t.noPreview} />}
        </div>}
        {(preview?.chunkCount ?? 0) > 1 && <div className={styles.pagination}><IconButton icon={ChevronLeft} label={t.previous} disabled={chunk === 0 || loading} onClick={() => setChunk((value) => value - 1)} /><span>{t.part} {formatNumber(locale, chunk + 1)} {t.of} {formatNumber(locale, preview!.chunkCount)}</span><IconButton icon={ChevronRight} label={t.next} disabled={chunk + 1 >= preview!.chunkCount || loading} onClick={() => setChunk((value) => value + 1)} /></div>}
      </section>
      <aside className={styles.versions} aria-label={t.versions}><h2>{t.versions}</h2>{detail.uploads.map((item: SourceUpload) => <button type="button" className={styles.version} key={item.id} aria-pressed={item.id === selectedId} onClick={() => { setSelectedId(item.id); setChunk(0); }}><strong>{item.fileName}</strong><SourceStatus status={item.status} /><span className={styles.meta}>{formatInstant(locale, item.createdAt)}</span></button>)}</aside>
    </div>
  </main></WorkspaceShell>;
}
