'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, FileDown, RefreshCw } from 'lucide-react';
import { Button, CheckboxField, Dialog, InputField, SelectField } from '@/ui';
import { formatsForKind, registeredExportKinds, type CreateExport, type ExportFile, type ExportFormat, type ExportJob, type ExportLocale } from '../contracts';
import { exportCopy } from './copy';
import styles from './exports.module.css';

export interface ExportPanelProps {
  workspaceId: string; artifactId: string; locale: ExportLocale; userId: string; expectedAuthzVersion: number; kind: keyof typeof formatsForKind; revision: number; disabled?: boolean;
  beforeExport?: () => Promise<{ revision: number; expectedAuthzVersion: number } | null>;
  sheets?: { id: string; name: string }[]; pages?: { id: string; label: string }[];
}
class ExportRequestError extends Error { constructor(public code: string, public key: string) { super(key); } }
export function ExportPanel(props: ExportPanelProps) {
  const copy = exportCopy[props.locale], scope = `${props.workspaceId}:${props.artifactId}:${props.userId}`, trigger = useRef<HTMLButtonElement>(null);
  const available = registeredExportKinds.includes(props.kind);
  const [open, setOpen] = useState(false), [formats, setFormats] = useState<ExportFormat[]>([formatsForKind[props.kind][0]]), [historicalDraft, setHistoricalDraft] = useState(false), [replaceFonts, setReplaceFonts] = useState(false);
  const [sheetId, setSheetId] = useState(props.sheets?.[0]?.id ?? ''), [pageId, setPageId] = useState(''), [pageSize, setPageSize] = useState<'A4' | 'Letter'>('A4'), [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [margin, setMargin] = useState('20'), [header, setHeader] = useState(''), [footer, setFooter] = useState(''), [pageNumbers, setPageNumbers] = useState(true);
  const [selectedRevision, setSelectedRevision] = useState('current');
  const [versions, setVersions] = useState<{ scope: string; revisions: { revision: number; createdAt: string }[] }>({ scope, revisions: [] });
  const [view, setView] = useState<{ scope: string; jobs: ExportJob[] }>({ scope, jobs: [] }), [error, setError] = useState(''), [busy, setBusy] = useState(''), [unknownCreate, setUnknownCreate] = useState(false), [denied, setDenied] = useState(false);
  const operation = useRef<{ id: string; body: CreateExport; scope: string } | null>(null), abort = useRef<AbortController | null>(null), live = useRef(scope), busyRef = useRef(false), epoch = useRef(props.expectedAuthzVersion), cancelled = useRef(false);
  const jobs = view.scope === scope && !denied ? view.jobs : [];
  useEffect(() => { live.current = scope; epoch.current = props.expectedAuthzVersion; return () => { live.current = ''; abort.current?.abort(); }; }, [scope, props.expectedAuthzVersion]);
  const message = (cause: unknown) => {
    if (cause instanceof ExportRequestError) {
      if (['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(cause.code)) return copy.denied;
      if (cause.key.endsWith('historicalConsent')) return copy.stale;
      if (cause.key.endsWith('sheetRequired')) return copy.sheetHint;
      if (cause.key.endsWith('fontUnavailable')) return copy.fontError;
      if (cause.code === 'CONFLICT') return copy.conflict;
      return copy.unavailable;
    }
    return copy.unknown;
  };
  const handleError = (cause: unknown) => { if (live.current !== scope) return; setError(message(cause)); if (cause instanceof ExportRequestError && ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(cause.code)) { setDenied(true); setView({ scope, jobs: [] }); } };
  async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, { ...init, credentials: 'same-origin', headers: { 'X-Tirlik-User-Id': props.userId, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
    if (!response.ok) { const detail = await response.json().catch(() => ({})) as { code?: string; messageKey?: string }; throw new ExportRequestError(detail.code ?? 'UNAVAILABLE', detail.messageKey ?? 'exports.errors.unavailable'); }
    return response.json() as Promise<T>;
  }
  function accept(job: ExportJob) { if (live.current !== scope) return; epoch.current = job.authzVersion; setDenied(false); setView((previous) => ({ scope, jobs: [job, ...(previous.scope === scope ? previous.jobs.filter((item) => item.id !== job.id) : [])] })); }
  async function refresh() {
    if (busyRef.current) return; busyRef.current = true; setBusy('refresh'); setError('');
    try { const [result, saved] = await Promise.all([request<{ jobs: ExportJob[]; authzVersion: number }>(`/api/exports?workspaceId=${props.workspaceId}&artifactId=${props.artifactId}`), request<{ versions: { revision: number; createdAt: string }[] }>(`/api/artifacts/${props.artifactId}/versions?workspaceId=${props.workspaceId}&limit=50`)]); if (live.current === scope) { epoch.current = result.authzVersion; setDenied(false); setView({ scope, jobs: result.jobs }); setVersions({ scope, revisions: saved.versions }); } }
    catch (cause) { handleError(cause); } finally { busyRef.current = false; if (live.current === scope) setBusy(''); }
  }
  async function render(job: ExportJob, signal?: AbortSignal) { const result = await request<ExportJob>(`/api/exports/${job.id}/render`, { method: 'POST', body: JSON.stringify({ workspaceId: props.workspaceId, expectedAuthzVersion: epoch.current }), signal }); accept(result); return result; }
  async function prepare() {
    if (busyRef.current || props.disabled || denied || !available) return;
    if (!formats.length) { setError(copy.none); return; }
    const marginMm = Number(margin); if (!Number.isFinite(marginMm) || marginMm < 10 || marginMm > 45) { setError({ ru: 'Укажите поля от 10 до 45 мм.', kk: 'Жиектерді 10–45 мм аралығында көрсетіңіз.', en: 'Set margins between 10 and 45 mm.' }[props.locale]); return; }
    busyRef.current = true; cancelled.current = false; setBusy('prepare'); setError(''); const controller = new AbortController(); abort.current = controller;
    try {
      if (!operation.current || operation.current.scope !== scope) {
        const saved = props.beforeExport ? await props.beforeExport() : { revision: props.revision, expectedAuthzVersion: props.expectedAuthzVersion };
        if (!saved) { setError(copy.save); return; }
        epoch.current = saved.expectedAuthzVersion;
        operation.current = { id: crypto.randomUUID(), scope, body: { workspaceId: props.workspaceId, expectedAuthzVersion: saved.expectedAuthzVersion, locale: props.locale, historicalDraft, items: [{ artifactId: props.artifactId, revision: selectedRevision === 'current' ? saved.revision : Number(selectedRevision), formats, options: { layout: { pageSize, orientation, marginMm, headerText: header || undefined, footerText: footer || undefined, pageNumbers }, scale: 1, transparent: false, replaceUnsupportedFonts: replaceFonts, fontAssets: {}, ...(sheetId ? { sheetId } : {}), ...(pageId ? { pageIds: [pageId] } : {}) } }] } };
      }
      const frozen = operation.current;
      let job: ExportJob;
      try { job = await request<ExportJob>('/api/exports', { method: 'POST', headers: { 'Idempotency-Key': frozen.id }, body: JSON.stringify(frozen.body), signal: controller.signal }); }
      catch (cause) { if (cause instanceof ExportRequestError && !['UNAVAILABLE', 'RATE_LIMITED'].includes(cause.code)) { operation.current = null; setUnknownCreate(false); } else setUnknownCreate(true); throw cause; }
      operation.current = null; setUnknownCreate(false); accept(job); if (live.current !== scope) return;
      setBusy(job.id); await render(job, controller.signal);
    } catch (cause) { if (!cancelled.current) handleError(cause); } finally { busyRef.current = false; if (live.current === scope) setBusy(''); }
  }
  async function action(job: ExportJob, actionName: 'render' | 'cancel' | 'remove') {
    if (busyRef.current && actionName !== 'cancel') return;
    if (actionName !== 'cancel') { busyRef.current = true; cancelled.current = false; setBusy(job.id); } setError('');
    try {
      if (actionName === 'render') await render(job);
      else if (actionName === 'cancel') { const result = await request<ExportJob>(`/api/exports/${job.id}/cancel`, { method: 'POST', body: JSON.stringify({ workspaceId: props.workspaceId, expectedAuthzVersion: epoch.current }) }); cancelled.current = true; accept(result); abort.current?.abort(); }
      else { await request(`/api/exports/${job.id}`, { method: 'DELETE', body: JSON.stringify({ workspaceId: props.workspaceId, expectedAuthzVersion: epoch.current }) }); if (live.current === scope) setView((previous) => ({ scope, jobs: previous.jobs.filter((item) => item.id !== job.id) })); }
    } catch (cause) { if (!cancelled.current) handleError(cause); } finally { if (actionName !== 'cancel') { busyRef.current = false; if (live.current === scope) setBusy(''); } }
  }
  async function download(job: ExportJob, file: ExportFile) {
    if (busyRef.current) return; busyRef.current = true; setBusy(file.id); setError('');
    try {
      const response = await fetch(`/api/exports/${job.id}/files/${file.id}?workspaceId=${props.workspaceId}`, { credentials: 'same-origin', headers: { 'X-Tirlik-User-Id': props.userId } });
      if (!response.ok) { const detail = await response.json() as { code: string; messageKey: string }; throw new ExportRequestError(detail.code, detail.messageKey); }
      const blob = await response.blob(); if (live.current !== scope) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = file.fileName; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { handleError(cause); } finally { busyRef.current = false; if (live.current === scope) setBusy(''); }
  }
  return <><Button ref={trigger} icon={FileDown} disabled={props.disabled || !available} disabledReason={!available ? { ru: 'Экспорт этого материала пока недоступен.', kk: 'Бұл материалды экспорттау әзірге қолжетімсіз.', en: 'Export is not available for this material yet.' }[props.locale] : undefined} onClick={() => { setOpen(true); void refresh(); }}>{copy.open}</Button>
    <Dialog open={open} onOpenChange={setOpen} title={copy.title} description={copy.description} returnFocus={trigger} className={styles.dialog} dismissible={!unknownCreate && busy !== 'prepare'} footer={<><Button onClick={() => setOpen(false)} disabled={unknownCreate || busy === 'prepare'}>{copy.close}</Button><Button variant="primary" icon={FileDown} pending={busy === 'prepare'} pendingLabel={copy.preparing} disabled={Boolean(busy) || props.disabled || denied || !formats.length} onClick={() => void prepare()}>{unknownCreate ? copy.retryRequest : copy.prepare}</Button></>}>
      <div className={styles.body}>
        <SelectField label={copy.revision} value={selectedRevision} disabled={Boolean(busy) || unknownCreate} onChange={(event) => setSelectedRevision(event.target.value)}><option value="current">{copy.current} · {props.revision}</option>{(versions.scope === scope ? versions.revisions : []).map((version) => <option key={version.revision} value={version.revision}>{copy.revision} {version.revision} · {new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(version.createdAt))}</option>)}</SelectField>
        <fieldset className={styles.formats} disabled={Boolean(busy) || unknownCreate}><legend>{copy.format}</legend>{formatsForKind[props.kind].map((format) => <CheckboxField key={format} label={format.toUpperCase()} checked={formats.includes(format)} onChange={(event) => setFormats((current) => event.target.checked ? [...current, format] : current.filter((item) => item !== format))} />)}</fieldset>
        {formats.includes('csv') && <SelectField label={copy.sheet} value={sheetId} disabled={Boolean(busy) || unknownCreate} onChange={(event) => setSheetId(event.target.value)}><option value="">{copy.sheetHint}</option>{props.sheets?.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}</SelectField>}
        {props.kind === 'design' && props.pages && <SelectField label={copy.pages} value={pageId} disabled={Boolean(busy) || unknownCreate} onChange={(event) => setPageId(event.target.value)}><option value="">{copy.allPages}</option>{props.pages.map((page) => <option key={page.id} value={page.id}>{page.label}</option>)}</SelectField>}
        {props.kind === 'document' && <fieldset className={styles.layout} disabled={Boolean(busy) || unknownCreate}><legend>{copy.pageSize}</legend><div className={styles.columns}><SelectField label={copy.pageSize} value={pageSize} onChange={(event) => setPageSize(event.target.value as 'A4' | 'Letter')}><option>A4</option><option>Letter</option></SelectField><SelectField label={copy.orientation} value={orientation} onChange={(event) => setOrientation(event.target.value as 'portrait' | 'landscape')}><option value="portrait">{copy.portrait}</option><option value="landscape">{copy.landscape}</option></SelectField><InputField label={copy.margin} value={margin} type="number" min={10} max={45} unit="mm" onChange={(event) => setMargin(event.target.value)} /></div><InputField label={copy.header} value={header} maxLength={300} onChange={(event) => setHeader(event.target.value)} /><InputField label={copy.footer} value={footer} maxLength={300} onChange={(event) => setFooter(event.target.value)} /><CheckboxField label={copy.pageNumbers} checked={pageNumbers} onChange={(event) => setPageNumbers(event.target.checked)} /><CheckboxField label={copy.replaceFont} checked={replaceFonts} onChange={(event) => setReplaceFonts(event.target.checked)} /></fieldset>}
        <CheckboxField label={copy.historical} hint={copy.historicalHint} checked={historicalDraft} disabled={Boolean(busy) || unknownCreate} onChange={(event) => setHistoricalDraft(event.target.checked)} />
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <section aria-label={copy.history} className={styles.history}><div className={styles.historyHeading}><h3>{copy.history}</h3><Button variant="quiet" icon={RefreshCw} pending={busy === 'refresh'} disabled={Boolean(busy)} onClick={() => void refresh()}>{copy.refresh}</Button></div>
          {!jobs.length && <p className={styles.muted}>{copy.empty}</p>}
          {jobs.map((job) => <article className={styles.job} key={job.id}><header><span>{new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(job.createdAt))}</span><strong role="status">{copy.statuses[job.status]}</strong></header><p className={styles.muted}>{copy.frozen}{job.historicalDraft ? ` ${copy.historical}` : ''}</p><ul className={styles.files}>{job.files.map((file) => <li key={file.id}><div className={styles.fileInfo}><strong>{file.fileName}</strong><span>{copy.revision} {file.revision} · {copy.statuses[file.status]}{file.byteSize ? ` · ${new Intl.NumberFormat(props.locale, { maximumFractionDigits: 1 }).format(file.byteSize / 1024)} KB` : ''}</span>{file.errorKey && <span className={styles.error}>{file.errorKey.includes('font') ? copy.fontError : /mergedRowsPdf|nestedTablePdf/.test(file.errorKey) ? copy.layoutError : copy.unavailable}</span>}{file.warnings.length > 0 && <details><summary>{copy.warnings}</summary><ul>{file.warnings.map((warning, i) => <li key={`${warning.code}:${i}`}>{warning.message ?? copy.warnings}</li>)}</ul></details>}</div>{file.status === 'ready' && <Button icon={Download} pending={busy === file.id} disabled={Boolean(busy)} onClick={() => void download(job, file)}>{copy.download}</Button>}</li>)}</ul><div className={styles.actions}>{job.status !== 'ready' && job.status !== 'rendering' && <Button pending={busy === job.id} disabled={Boolean(busy)} onClick={() => void action(job, 'render')}>{copy.retry}</Button>}{(job.status === 'rendering' || busy === job.id) && <Button onClick={() => void action(job, 'cancel')}>{copy.cancel}</Button>}{job.status !== 'rendering' && <Button variant="quiet" disabled={Boolean(busy)} onClick={() => void action(job, 'remove')}>{copy.remove}</Button>}</div></article>)}
        </section>
      </div>
    </Dialog>
  </>;
}
