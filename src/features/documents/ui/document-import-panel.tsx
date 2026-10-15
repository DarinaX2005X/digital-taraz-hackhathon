'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileCheck, FileInput, RefreshCw } from 'lucide-react';
import type { Locale } from '@/i18n';
import type { ArtifactMutationResult } from '@/features/artifacts/contracts';
import { Button, InputField } from '@/ui';
import { documentImportClient, DocumentImportError } from '../client/import';
import type { DocumentImportPreview } from '../contracts';
import { documentText, readDocument } from '../domain/document';
import { documentCopies, lossCopyKeys } from '../locales';
import styles from './documents.module.css';

type ImportDraft = { title: string; preview?: DocumentImportPreview; checked: boolean; uncertain: boolean; operation?: { key: string; title: string } };
export type DocumentImportMemory = { drafts: Map<string, ImportDraft> };
export function createDocumentImportMemory(): DocumentImportMemory { return { drafts: new Map() }; }
type Props = { workspaceId: string; sourceId: string; uploadId: string; expectedAuthzVersion: number; userId: string; title: string; locale: Locale; memory: DocumentImportMemory; onImported(result: ArtifactMutationResult): void; run<T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> };
export function DocumentImportPanel(props: Props) {
  const t = documentCopies[props.locale];
  const [draft, setDraft] = useState<ImportDraft>(() => props.memory.drafts.get(props.uploadId) ?? { title: props.title.replace(/\.docx$/i, ''), checked: false, uncertain: false });
  const { title, preview, checked, uncertain } = draft;
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  function updateDraft(patch: Partial<ImportDraft>) {
    const next = { ...(props.memory.drafts.get(props.uploadId) ?? draft), ...patch };
    props.memory.drafts.set(props.uploadId, next);
    setDraft(next);
  }
  async function perform(event: FormEvent, create: boolean) {
    event.preventDefault(); if (busy || (create && (!preview || !checked))) return;
    setBusy(true); setError(undefined);
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const fixed = draft.operation ?? { key: crypto.randomUUID(), title: title.trim() };
    updateDraft({ operation: fixed, ...(create ? { uncertain: true } : {}) });
    const input = { workspaceId: props.workspaceId, sourceId: props.sourceId, uploadId: props.uploadId, expectedAuthzVersion: props.expectedAuthzVersion, title: fixed.title };
    try {
      if (create) {
        const result = await props.run((signal) => documentImportClient.create({ ...input, previewHash: preview!.previewHash }, fixed.key, props.userId, signal), controller.signal);
        if (!controller.signal.aborted) { setDraft((previous) => ({ ...previous, uncertain: false })); props.memory.drafts.delete(props.uploadId); props.onImported(result); }
      } else {
        const result = await props.run((signal) => documentImportClient.preview(input, fixed.key, props.userId, signal), controller.signal);
        if (!controller.signal.aborted) updateDraft({ preview: result, checked: false });
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure);
        if (create) updateDraft({ uncertain: !(failure instanceof DocumentImportError && failure.status >= 400 && failure.status < 500) });
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const text = preview ? documentText(readDocument(preview.content).document) : '';
  return <section className={styles.importPanel} aria-label={t.import}>
    <form onSubmit={(event) => { void perform(event, Boolean(preview)); }} className={styles.form}>
      <InputField label={t.title} maxLength={240} required value={title} disabled={busy || Boolean(preview) || uncertain} onChange={(event) => updateDraft({ title: event.target.value, operation: undefined })} />
      {preview && <>
        <h3>{t.importLosses}</h3>
        <ul className={styles.losses}>{preview.losses.map((loss) => <li key={loss.code}>{t[lossCopyKeys[loss.code]]}{loss.count > 1 ? ` (${new Intl.NumberFormat(props.locale).format(loss.count)})` : ''}</li>)}</ul>
        <div className={styles.importPreview} aria-label={t.preview}>{text}</div>
        <label className={styles.checkbox}><input type="checkbox" checked={checked} disabled={busy || uncertain} onChange={(event) => updateDraft({ checked: event.target.checked })} />{t.importConfirm}</label>
      </>}
      {(error !== undefined || uncertain) && <p role="alert" className={styles.error}>{error instanceof DocumentImportError && error.status === 409 ? t.importChanged : uncertain ? t.importUnknown : t.importError}</p>}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" icon={error ? RefreshCw : preview ? FileCheck : FileInput} pending={busy} disabled={!title.trim() || (Boolean(preview) && !checked)}>{preview ? t.import : t.importPreview}</Button>
        {preview && !uncertain && <Button disabled={busy} onClick={() => { updateDraft({ preview: undefined, checked: false, operation: undefined }); setError(undefined); }}>{t.importBack}</Button>}
      </div>
    </form>
  </section>;
}
