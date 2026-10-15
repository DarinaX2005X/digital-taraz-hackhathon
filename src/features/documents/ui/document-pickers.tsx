'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Dialog, Button, InputField, LoadingState } from '@/ui';
import { useLocale } from '@/i18n/provider';
import { sourceClient } from '@/features/sources/client/transport';
import { materialClient } from '@/features/materials/client/transport';
import type { SourceVisualAsset } from '@/contracts/sources';
import { CollectionListSchema, DatasetPageSchema, type MaterialCell } from '@/contracts/materials';
import type { SourceFreshness } from '@/features/artifacts/contracts';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import { documentCopies } from '../locales';
import { materialText } from '../domain/fields';
import styles from './documents.module.css';

export interface DocumentFact { cell: MaterialCell; sourceFreshness: SourceFreshness[] }
const context = (snapshot: ArtifactSnapshot) => ({ userId: snapshot.viewer.userId });

/** Uses canonical source asset listing, never a user-entered private asset identity. */
export function DocumentImagePicker({ snapshot, onClose, onChoose }: { snapshot: ArtifactSnapshot; onClose: () => void; onChoose: (asset: SourceVisualAsset) => void }) {
  const t = documentCopies[useLocale().locale];
  const { workspaceId, userId } = snapshot.viewer, projectId = snapshot.artifact.projectId;
  const [result, setResult] = useState<{ items: SourceVisualAsset[]; nextCursor: string | null }>();
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void sourceClient.listAssets({ workspaceId, projectId, kind: 'image' }, { userId, signal: abort.signal })
      .then(setResult).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [workspaceId, userId, projectId]);
  async function more() {
    if (!result?.nextCursor || busy) return;
    setBusy(true); setError(false);
    try { const next = await sourceClient.listAssets({ workspaceId: snapshot.viewer.workspaceId, projectId: snapshot.artifact.projectId, kind: 'image', after: result.nextCursor }, context(snapshot)); setResult({ items: [...result.items, ...next.items], nextCursor: next.nextCursor }); }
    catch { setError(true); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={t.imageChoose}>
    {error ? <p role="alert" className={styles.error}>{t.error}</p> : !result ? <LoadingState /> : null}
    <div className={styles.imageList}>{result?.items.map((asset) => <button type="button" key={asset.id} className={styles.imageOption} onClick={() => onChoose(asset)}><span>{asset.name}</span><span className={styles.muted}>{asset.width} × {asset.height}</span></button>)}</div>
    {result?.items.length === 0 && <p>{t.noImages}</p>}
    {result?.nextCursor && <Button pending={busy} onClick={() => { void more(); }}>{t.more}</Button>}
    <Link href="/app/materials">{t.addMaterial}</Link>
  </Dialog>;
}

export async function currentDocumentFact(snapshot: ArtifactSnapshot, ref: MaterialCell['sourceRef']): Promise<DocumentFact> {
  let result = await materialClient.facts({ workspaceId: snapshot.viewer.workspaceId, refs: [ref] }, context(snapshot));
  let fact = result.facts[0];
  if (fact?.state === 'stale' && fact.currentSourceRef) {
    result = await materialClient.facts({ workspaceId: snapshot.viewer.workspaceId, refs: [fact.currentSourceRef] }, context(snapshot)); fact = result.facts[0];
  }
  if (!fact?.canBind || fact.state !== 'current' || !fact.pinned || fact.pinned.value.kind === 'unknown') throw new Error('material-not-confirmed');
  return { cell: fact.pinned, sourceFreshness: result.sourceFreshness };
}

export function DocumentFactPicker({ snapshot, onClose, onChoose }: { snapshot: ArtifactSnapshot; onClose: () => void; onChoose: (fact: DocumentFact) => Promise<void> }) {
  const { locale } = useLocale(), t = documentCopies[locale];
  const { workspaceId, userId } = snapshot.viewer, projectId = snapshot.artifact.projectId;
  const [collections, setCollections] = useState<z.infer<typeof CollectionListSchema>>();
  const [dataset, setDataset] = useState<{ query: string; page: z.infer<typeof DatasetPageSchema> }>();
  const [collectionId, setCollectionId] = useState(''), [query, setQuery] = useState('');
  const [recordQuery, setRecordQuery] = useState('');
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void materialClient.list({ workspaceId, projectId, query }, { userId, signal: abort.signal })
      .then(setCollections).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [workspaceId, userId, projectId, query]);
  useEffect(() => {
    if (!collectionId) return;
    const abort = new AbortController();
    void materialClient.query({ workspaceId, collectionId, query: recordQuery }, { userId, signal: abort.signal })
      .then((page) => setDataset({ query: recordQuery, page })).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [workspaceId, userId, collectionId, recordQuery]);
  async function choose(cell: MaterialCell) {
    setBusy(true); setError(false);
    try { await onChoose(await currentDocumentFact(snapshot, cell.sourceRef)); }
    catch { setError(true); } finally { setBusy(false); }
  }
  async function more() {
    if (!dataset?.page.nextCursor || busy) return;
    setBusy(true); setError(false);
    try { const next = await materialClient.query({ workspaceId: snapshot.viewer.workspaceId, collectionId, query: recordQuery, revision: dataset.page.revision, after: dataset.page.nextCursor }, context(snapshot)); setDataset({ query: recordQuery, page: { ...next, records: [...dataset.page.records, ...next.records] } }); }
    catch { setError(true); } finally { setBusy(false); }
  }
  const currentDataset = dataset?.page.collection.id === collectionId && dataset.query === recordQuery ? dataset.page : undefined;
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={t.fieldInsert}>
    <div className={styles.form}>
      <InputField label={t.fieldSearch} value={query} maxLength={120} disabled={busy} onChange={(event) => { setQuery(event.target.value); setCollectionId(''); }} />
      {!collections && !error && <LoadingState />}
      <label>{t.chooseCollection}<select value={collectionId} disabled={busy} onChange={(event) => { setCollectionId(event.target.value); setError(false); }}><option value="">—</option>{collections?.collections.map((collection) => <option value={collection.id} key={collection.id}>{collection.title}</option>)}</select></label>
      {collectionId && <InputField label={t.chooseRecord} value={recordQuery} maxLength={120} disabled={busy} onChange={(event) => { setRecordQuery(event.target.value); setError(false); }} />}
      {collectionId && !currentDataset && !error && <LoadingState />}
      {currentDataset?.records.length === 0 && <p>{t.noFacts}</p>}
      <div className={styles.imageList}>{currentDataset?.records.flatMap((record) => currentDataset.collection.mapping?.fields.map((field) => {
        const cell = record.cells[field.id]; if (!cell) return null;
        const known = !record.missing && cell.value.kind !== 'unknown' && cell.reviewState !== 'needs-review' && cell.origin !== 'assumed';
        return <button type="button" className={styles.imageOption} key={`${record.recordId}:${field.id}`} disabled={busy || !known} onClick={() => { void choose(cell); }}><span>{record.label} · {field.label}<br /><strong>{known ? materialText(cell.value, locale) : t.valueUnknown}</strong></span></button>;
      }) ?? [])}</div>
      {currentDataset?.nextCursor && <Button pending={busy} onClick={() => { void more(); }}>{t.more}</Button>}
      {error && <p role="alert" className={styles.error}>{t.error}</p>}
    </div>
  </Dialog>;
}
