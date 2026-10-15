'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/i18n/provider';
import { ArtifactMutationResultSchema } from '@/features/artifacts/contracts';
import { sheetCopy, importWarning } from '../locales';
import type { SheetImport } from '../server/import';
import styles from './sheets.module.css';

type Preview = Pick<SheetImport, 'sample' | 'warnings' | 'previewHash'> & { title: string };
export function SheetImportPanel(props: { workspaceId: string; sourceId: string; sourceVersionId: string; userId: string; authzVersion: number; format: 'xlsx' | 'csv' | 'tsv' }) {
  const { locale } = useLocale(), copy = sheetCopy[locale], router = useRouter();
  const operation = useRef<string | null>(null), generation = useRef(0);
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [error, setError] = useState('');
  useEffect(() => () => { generation.current++; }, [props.userId, props.workspaceId, props.sourceId, props.sourceVersionId]);
  async function run(action: 'preview' | 'create') {
    if (busy || action === 'create' && (!preview || preview.warnings.length > 0 && !accepted)) return;
    const mine = ++generation.current; operation.current ??= crypto.randomUUID(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/sheets/import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Tirlik-User-Id': props.userId, 'Idempotency-Key': operation.current }, body: JSON.stringify({ action, workspaceId: props.workspaceId, sourceId: props.sourceId, sourceVersionId: props.sourceVersionId, expectedAuthzVersion: props.authzVersion, ...(action === 'create' ? { previewHash: preview!.previewHash } : {}) }) });
      const body = await response.json(); if (mine !== generation.current) return;
      if (!response.ok) { if ([401, 403, 404, 409].includes(response.status)) setPreview(null); throw new Error(copy.importError); }
      if (action === 'preview') { setPreview(body as Preview); setAccepted(false); }
      else { const result = ArtifactMutationResultSchema.parse(body); router.push(`/app/projects/${result.artifact.projectId}/artifacts/${result.artifact.id}?workspace=${props.workspaceId}`); }
    } catch (caught) { if (mine === generation.current) setError(caught instanceof TypeError ? copy.importUnknown : copy.importError); }
    finally { if (mine === generation.current) setBusy(false); }
  }
  return <section className={styles.importPanel} aria-label={copy.create}>
    {!preview ? <button type="button" disabled={busy} onClick={() => void run('preview')}>{busy ? copy.loading : copy.preview}</button> : <>
      <h3>{preview.title}</h3>
      {preview.sample.map((sheet) => <div className={styles.previewSheet} key={sheet.sheetId}><strong>{sheet.name}</strong><div className={styles.previewTable}><table><tbody>{sheet.cells.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div></div>)}
      {preview.warnings.length > 0 && <div><h4>{copy.losses}</h4><ul>{[...new Set(preview.warnings.map((warning) => importWarning(locale, warning.code)))].map((warning) => <li key={warning}>{warning}</li>)}</ul><label><input type="checkbox" checked={accepted} disabled={busy} onChange={(event) => setAccepted(event.target.checked)} />{copy.acceptLosses}</label></div>}
      <button type="button" disabled={busy || preview.warnings.length > 0 && !accepted} onClick={() => void run('create')}>{busy ? copy.saving : copy.create}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
