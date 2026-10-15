'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, ScanText } from 'lucide-react';
import { SourcePageContentSchema, type SourceOcrQuote, type SourcePageContent, type SourceReview } from '@/contracts/sources';
import { useLocale } from '@/i18n/provider';
import { formatNumber } from '@/i18n';
import { Button, InputField, LoadingState, SelectField, TextareaField } from '@/ui';
import { sourceClient } from '../client/transport';
import { SourceError, useSourceCopy } from './common';
import { PrivateSourceImage } from './private-image';
import { runCatalog } from '@/features/runs/locales';
import styles from './sources.module.css';

export type SourceRecognitionMemory = Map<string, { revision: number; content: SourcePageContent }>;
type RunRequest = <T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T>;
export function SourceRecognitionPanel({ workspaceId, uploadId, ownerId, editable, run, memory, onChanged }: { workspaceId: string; uploadId: string; ownerId: string; editable: boolean; run: RunRequest; memory: SourceRecognitionMemory; onChanged: () => void }) {
  const t = useSourceCopy(), { locale } = useLocale();
  const [review, setReview] = useState<SourceReview>(), [quote, setQuote] = useState<SourceOcrQuote>(), [pageLimit, setPageLimit] = useState(3), [selectedPage, setSelectedPage] = useState<number>();
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const requestKey = useRef<{ limit: number; key: string } | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const request = new AbortController(); let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, polls = 0;
    const refresh = async () => {
      try {
        const next = await run((signal) => sourceClient.review(workspaceId, uploadId, { userId: ownerId, signal }), request.signal);
        if (stopped) return;
        setReview(next);
        if (next.pages.some((page) => page.runId && page.state === 'pending') && polls++ < 120) timer = setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); else timer = setTimeout(() => { void refresh(); }, 5000); }, 5000);
      } catch (failure) { if (!stopped) setError(failure); }
    };
    void refresh();
    return () => { stopped = true; request.abort(); if (timer) clearTimeout(timer); };
  }, [workspaceId, uploadId, ownerId, run, reload]);
  useEffect(() => {
    if (!editable) return;
    const request = new AbortController();
    void run((signal) => sourceClient.recognitionQuote(workspaceId, uploadId, pageLimit, { userId: ownerId, signal }), request.signal).then((value) => { if (!request.signal.aborted) setQuote(value); }).catch((failure) => { if (!request.signal.aborted) setError(failure); });
    return () => request.abort();
  }, [workspaceId, uploadId, ownerId, editable, pageLimit, run, reload, review?.pendingPages, review?.failedPages]);
  async function start() {
    const pending = review?.pendingStart;
    if (busy || (!pending && !quote?.available)) return;
    const request = new AbortController(); controller.current = request;
    if (requestKey.current?.limit !== pageLimit) requestKey.current = { limit: pageLimit, key: crypto.randomUUID() };
    setBusy(true); setError(undefined);
    try {
      await run((signal) => sourceClient.recognize(workspaceId, uploadId, pending?.locale ?? locale, pending?.pageLimit ?? pageLimit, { pages: pending?.expectedPages ?? quote!.pages, maximumUsd: pending?.maximumUsd ?? quote!.maximumUsd! }, pending?.operationId ?? requestKey.current!.key, { userId: ownerId, signal }), request.signal);
      requestKey.current = undefined; setReload((value) => value + 1); onChanged();
    } catch (failure) { if (!request.signal.aborted) setError(failure); }
    finally { if (!request.signal.aborted) setBusy(false); if (controller.current === request) controller.current = null; }
  }
  if (!review) return <LoadingState label={t.loading} />;
  if (!review.pages.length) return null;
  const selected = review.pages.find((page) => page.page === selectedPage) ?? review.pages.find((page) => page.state === 'needs-review') ?? review.pages.find((page) => page.original);
  const runIds = [...new Set(review.pages.flatMap((page) => page.runId ? [page.runId] : []))];
  const failed = review.pages.filter((page) => page.state === 'failed');
  return <section className={styles.recognition} aria-label={t.recognition}>
    <div className={styles.previewHeader}><h2>{t.recognition}</h2><Button icon={RefreshCw} disabled={busy} onClick={() => setReload((value) => value + 1)}>{t.refresh}</Button></div>
    <p>{t.recognitionIntro}</p>
    <dl className={styles.summary}><div><dt>{t.awaitingReview}</dt><dd>{formatNumber(locale, review.reviewPages)}</dd></div><div><dt>{t.pageAccepted}</dt><dd>{formatNumber(locale, review.readyPages)}</dd></div><div><dt>{t.remaining}</dt><dd>{formatNumber(locale, review.pendingPages)}</dd></div><div><dt>{t.failedPages}</dt><dd>{formatNumber(locale, review.failedPages)}</dd></div></dl>
    {failed.length > 0 && <div className={styles.diagnostics} role="alert"><p>{t.failedPages}: {failed.map((page) => page.page).join(', ')}</p>{failed.map((page) => page.failure ? <p key={page.page}>{t.page} {page.page}: {runCatalog[locale].failures[page.failure]}</p> : null)}</div>}
    <SourceError error={error} />
    {editable && review.pendingPages + review.failedPages > 0 && <div className={styles.recognitionStart}>
      <SelectField label={t.pageBatch} value={String(pageLimit)} disabled={busy || Boolean(review.pendingStart)} onChange={(event) => { setPageLimit(Number(event.target.value)); setQuote(undefined); }}>{[1, 3, 5, 10].map((count) => <option key={count} value={count}>{formatNumber(locale, count)}</option>)}</SelectField>
      {review.pendingStart ? <><p>{t.pages}: {review.pendingStart.expectedPages.join(', ')}<br /><span className={styles.meta}>{t.maximumCost}: ${review.pendingStart.maximumUsd}</span></p><Button icon={RefreshCw} variant="primary" pending={busy} onClick={() => { void start(); }}>{t.retry}</Button></> : quote?.available ? <><p>{t.pages}: {quote.pages.join(', ')}<br /><span className={styles.meta}>{t.maximumCost}: ${quote.maximumUsd}</span></p><Button icon={ScanText} variant="primary" pending={busy} onClick={() => { void start(); }}>{t.recognizePages}</Button></> : quote && quote.reason !== 'no-pages' ? <p className={styles.meta}>{t.recognitionUnavailable}</p> : null}
    </div>}
    {runIds.length > 0 && <div className={styles.actions}>{runIds.map((id, index) => <Link key={id} className="tl-button tl-button--quiet" href={`/app/runs/${id}`}>{t.openRun}{runIds.length > 1 ? ` ${index + 1}` : ''}</Link>)}</div>}
    {selected?.original && <><div className={styles.pageTabs} role="group" aria-label={t.pages}>{review.pages.filter((page) => page.original).map((page) => <Button key={page.page} variant={page.page === selected.page ? 'secondary' : 'quiet'} onClick={() => setSelectedPage(page.page)}>{t.page} {page.page}{page.reviewedAt ? ' ✓' : ''}</Button>)}</div><PageReview key={`${uploadId}:${selected.page}:${selected.revision}`} page={selected} uploadId={uploadId} workspaceId={workspaceId} ownerId={ownerId} editable={editable} run={run} memory={memory} onAccepted={(next) => { setReview(next); setReload((value) => value + 1); onChanged(); }} /></>}
  </section>;
}

function PageReview({ page, uploadId, workspaceId, ownerId, editable, run, memory, onAccepted }: { page: SourceReview['pages'][number]; uploadId: string; workspaceId: string; ownerId: string; editable: boolean; run: RunRequest; memory: SourceRecognitionMemory; onAccepted: (review: SourceReview) => void }) {
  const t = useSourceCopy(), memoryKey = `${uploadId}:${page.page}`, saved = memory.get(memoryKey);
  const [content, setContent] = useState<SourcePageContent>(saved?.revision === page.revision ? saved.content : page.corrected ?? page.original!), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const canEdit = editable && page.state === 'needs-review';
  function change(index: number, text: string, column?: number) {
    const next = { ...content, blocks: content.blocks.map((block, at) => at !== index ? block : column === undefined ? { text } : { values: block.values!.map((value, cell) => cell === column ? text : value) }) };
    setContent(next); memory.set(memoryKey, { revision: page.revision, content: next });
  }
  async function accept() {
    if (!canEdit || busy) return;
    if (!SourcePageContentSchema.safeParse(content).success) { setError(t.reviewLimit); return; }
    const request = new AbortController(); controller.current = request; setBusy(true); setError(undefined);
    try { const next = await run((signal) => sourceClient.acceptPage(workspaceId, uploadId, page.page, page.revision, content, { userId: ownerId, signal }), request.signal); if (!request.signal.aborted) { memory.delete(memoryKey); onAccepted(next); } }
    catch (failure) { if (!request.signal.aborted) setError(failure); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className={styles.pageReview}>
    <div className={styles.actions}><h3>{t.page} {page.page}</h3>{page.reviewedAt && <span className={styles.status} data-state="ready"><Check size={16} />{t.pageAccepted}</span>}</div>
    <PrivateSourceImage workspaceId={workspaceId} uploadId={uploadId} ownerId={ownerId} page={page.page} fileName={`${t.page} ${page.page}`} run={run} />
    <p className={styles.meta}>{t.reviewInstruction}</p>
    {page.original!.warnings.map((warning, index) => <p className={styles.meta} key={index}>{warning}</p>)}
    {!content.blocks.length && <p>{t.emptyPage}</p>}
    <div className={styles.reviewColumns}><div><h4>{t.observed}</h4>{page.original!.blocks.map((block, index) => <div className={styles.rawBlock} key={index}>{block.values ? <table className={styles.table}><tbody><tr>{block.values.map((value, column) => <td key={column}>{value || '—'}</td>)}</tr></tbody></table> : <p>{block.text}</p>}</div>)}</div><div><h4>{t.corrected}</h4>{content.blocks.map((block, index) => <div className={styles.editedBlock} key={index}>{block.values ? <div className={styles.reviewCells}>{block.values.map((value, column) => <InputField key={column} label={`${t.row} ${index + 1}, ${t.column} ${column + 1}`} value={value} disabled={!canEdit || busy} onChange={(event) => change(index, event.target.value, column)} maxLength={4000} />)}</div> : <TextareaField label={`${t.fragments} ${index + 1}`} value={block.text ?? ''} disabled={!canEdit || busy} rows={Math.min(12, Math.max(3, (block.text?.length ?? 0) / 70))} onChange={(event) => change(index, event.target.value)} maxLength={16000} />}</div>)}</div></div>
    <SourceError error={error} />
    {canEdit && <Button icon={Check} variant="primary" pending={busy} onClick={() => { void accept(); }}>{t.acceptPage}</Button>}
  </div>;
}
