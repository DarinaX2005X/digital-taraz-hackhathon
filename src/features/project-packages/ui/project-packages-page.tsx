'use client';

import Link from 'next/link';
import { ArrowLeft, Download, PackageCheck, RefreshCw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ArtifactSummary, ArtifactViewer } from '@/features/artifacts/contracts';
import { ExportOptionsSchema, formatsForKind, type ExportFormat } from '@/features/exports/contracts';
import { formatInstant } from '@/i18n';
import { useLocale } from '@/i18n/provider';
import { Button, CheckboxField, InputField, TextareaField } from '@/ui';
import { createProjectPackageClient, ProjectPackageRequestError } from '../client';
import type { CreateProjectPackage, ProjectPackage } from '../contracts';
import { projectPackageCopy } from '../locales';
import styles from './packages.module.css';

const preferred: Record<keyof typeof formatsForKind, ExportFormat> = { document: 'pdf', table: 'xlsx', design: 'pdf', plan: 'pdf' };
export function ProjectPackagesPage({ viewer, projectId, projectTitle, artifacts, initialPackages, canEdit }: { viewer: ArtifactViewer; projectId: string; projectTitle: string; artifacts: ArtifactSummary[]; initialPackages: ProjectPackage[]; canEdit: boolean }) {
  const { locale } = useLocale(), t = projectPackageCopy[locale], client = useMemo(() => createProjectPackageClient(viewer, projectId), [viewer, projectId]);
  const releasable = artifacts.filter((item): item is ArtifactSummary & { kind: keyof typeof formatsForKind } => item.kind in formatsForKind).slice(0, 20);
  const [selected, setSelected] = useState(() => releasable.map((item) => item.id));
  const [formats, setFormats] = useState<Record<string, ExportFormat>>(() => Object.fromEntries(releasable.map((item) => [item.id, preferred[item.kind]])));
  const [title, setTitle] = useState(projectTitle), [audience, setAudience] = useState(t.defaultAudience), [omissions, setOmissions] = useState('');
  const [includeInternal, setIncludeInternal] = useState(false), [historical, setHistorical] = useState(false);
  const [packages, setPackages] = useState(initialPackages), [authzVersion, setAuthzVersion] = useState(viewer.authzVersion);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const operation = useRef<{ id: string; fingerprint: string; body: CreateProjectPackage } | undefined>(undefined);
  const failure = (cause: unknown) => cause instanceof ProjectPackageRequestError && [401, 403, 404].includes(cause.status) ? t.denied : t.failed;
  function accept(value: ProjectPackage) { setPackages((list) => [value, ...list.filter((item) => item.id !== value.id)]); setAuthzVersion(value.authzVersion); }
  async function refresh() {
    if (busy) return; setBusy('refresh'); setError('');
    try { const result = await client.list(); setPackages(result.packages); setAuthzVersion(result.authzVersion); }
    catch (cause) { setError(failure(cause)); } finally { setBusy(''); }
  }
  async function prepare(event: React.FormEvent) {
    event.preventDefault(); if (busy || !canEdit || !selected.length) return;
    const items = releasable.filter((item) => selected.includes(item.id)).map((item) => ({ artifactId: item.id, revision: item.currentRevision, formats: [formats[item.id] ?? preferred[item.kind]], options: ExportOptionsSchema.parse({}) }));
    const body: CreateProjectPackage = { workspaceId: viewer.workspaceId, expectedAuthzVersion: authzVersion, locale, historicalDraft: historical, privateFieldsPolicy: includeInternal ? 'include-authorized' : 'exclude-internal', release: { projectId, title: title.trim(), audience: audience.trim(), knownOmissions: [...new Set(omissions.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))] }, items };
    const fingerprint = JSON.stringify(body);
    if (!operation.current || operation.current.fingerprint !== fingerprint) operation.current = { id: crypto.randomUUID(), fingerprint, body };
    const pending = operation.current;
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await client.create(pending.body, pending.id); accept(created); operation.current = undefined;
      setBusy(created.id);
      try { accept(await client.render(created.id, created.authzVersion)); setNotice(t.notSent); }
      catch (cause) {
        setError(failure(cause));
        try { const result = await client.list(); setPackages(result.packages); setAuthzVersion(result.authzVersion); } catch { /* The queued job remains available for an explicit refresh. */ }
      }
    } catch (cause) { setError(failure(cause)); }
    finally { setBusy(''); }
  }
  async function retry(item: ProjectPackage) {
    if (busy) return; setBusy(item.id); setError('');
    try { accept(await client.render(item.id, authzVersion)); }
    catch (cause) { setError(failure(cause)); } finally { setBusy(''); }
  }
  async function download(item: ProjectPackage) {
    if (busy) return; setBusy(`download:${item.id}`); setError('');
    try { const result = await client.download(item.id); const url = URL.createObjectURL(result.blob), link = document.createElement('a'); link.href = url; link.download = result.fileName; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setError(failure(cause)); } finally { setBusy(''); }
  }
  return <main className={styles.page}>
    <Link className={styles.back} href={`/app/projects/${projectId}`}><ArrowLeft size={18} />{t.back}</Link>
    <header className={styles.heading}><div><h1>{t.title}</h1><p>{t.description}</p></div></header>
    <div className={styles.layout}>
      <form className={styles.composer} onSubmit={prepare}><h2>{t.contents}</h2>
        {!releasable.length && <p>{t.noArtifacts}</p>}
        <fieldset className={styles.artifacts} disabled={!canEdit || Boolean(busy)}>{releasable.map((artifact) => <label className={styles.artifact} key={artifact.id}><input type="checkbox" checked={selected.includes(artifact.id)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, artifact.id] : value.filter((id) => id !== artifact.id))} /><span><strong>{artifact.title}</strong><span>{t.revision} {artifact.currentRevision}</span></span><select aria-label={`${artifact.title}: ${t.format}`} value={formats[artifact.id]} onChange={(event) => setFormats((value) => ({ ...value, [artifact.id]: event.target.value as ExportFormat }))}>{formatsForKind[artifact.kind].map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>)}</fieldset>
        <InputField label={t.packageTitle} required maxLength={240} value={title} disabled={!canEdit || Boolean(busy)} onChange={(event) => { setTitle(event.target.value); operation.current = undefined; }} />
        <InputField label={t.audience} required maxLength={240} value={audience} disabled={!canEdit || Boolean(busy)} onChange={(event) => { setAudience(event.target.value); operation.current = undefined; }} />
        <TextareaField label={t.omissions} hint={t.omissionsHint} rows={4} maxLength={10000} value={omissions} disabled={!canEdit || Boolean(busy)} onChange={(event) => { setOmissions(event.target.value); operation.current = undefined; }} />
        <div className={styles.options}><CheckboxField label={t.includeInternal} checked={includeInternal} disabled={!canEdit || Boolean(busy)} onChange={(event) => setIncludeInternal(event.target.checked)} /><CheckboxField label={t.historical} checked={historical} disabled={!canEdit || Boolean(busy)} onChange={(event) => setHistorical(event.target.checked)} /></div>
        {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
        <Button type="submit" variant="primary" icon={PackageCheck} pending={busy === 'create'} pendingLabel={t.creating} disabled={!canEdit || !selected.length || !title.trim() || !audience.trim() || Boolean(busy)}>{t.create}</Button>
      </form>
      <section className={styles.history}><div className={styles.historyHeader}><h2>{t.history}</h2><Button icon={RefreshCw} pending={busy === 'refresh'} disabled={Boolean(busy)} onClick={() => { void refresh(); }}>{t.refresh}</Button></div>
        {!packages.length && <p className={styles.meta}>{t.empty}</p>}
        <div className={styles.jobs}>{packages.map((item) => <article className={styles.job} key={item.id}><header><div><h3>{item.release.title}</h3><p className={styles.meta}>{item.release.audience} · {formatInstant(locale, item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</p></div><strong>{t.statuses[item.status]}</strong></header>
          <p className={styles.meta}>{item.revisions.map((revision) => `${t.revision} ${revision.revision}`).join(' · ')} · {item.privateFieldsPolicy === 'include-authorized' ? t.policyInternal : t.policyExternal}</p>
          <ul className={styles.files}>{item.files.map((file) => <li key={file.id}><strong>{file.fileName}</strong> — {file.status}{file.byteSize ? ` · ${new Intl.NumberFormat(locale).format(file.byteSize)} B` : ''}</li>)}</ul>
          <details className={styles.omissions}><summary>{t.knownOmissions}</summary>{item.release.knownOmissions.length ? <ul>{item.release.knownOmissions.map((value) => <li key={value}>{value}</li>)}</ul> : <p>{t.noOmissions}</p>}</details><p className={styles.meta}>{t.notSent}</p>
          <div className={styles.actions}>{item.bundle && <Button icon={Download} pending={busy === `download:${item.id}`} disabled={Boolean(busy)} onClick={() => { void download(item); }}>{t.download}</Button>}{!['ready', 'rendering'].includes(item.status) && <Button pending={busy === item.id} disabled={Boolean(busy)} onClick={() => { void retry(item); }}>{t.retry}</Button>}</div>
        </article>)}</div>
      </section>
    </div>
  </main>;
}
