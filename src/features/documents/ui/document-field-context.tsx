'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BoundFact } from '@/contracts/materials';
import type { FieldBinding } from '@/contracts/artifacts';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { SourceFreshness } from '@/features/artifacts/contracts';
import { materialClient } from '@/features/materials/client/transport';
import { useLocale } from '@/i18n/provider';
import { Button } from '@/ui';
import { documentCopies } from '../locales';
import { documentFieldStatus } from '../domain/field-status';
import styles from './documents.module.css';

/** Missing records and revoked sources use the material service's distinct authorized states. */
export function DocumentFieldContext({ snapshot, binding, value, disabled, resources, onEdit, onRestore, onUnbind }: { snapshot: ArtifactSnapshot; binding: FieldBinding; value: string; disabled: boolean; resources: boolean; onEdit: () => void; onRestore: () => void; onUnbind: () => void }) {
  const t = documentCopies[useLocale().locale];
  const [result, setResult] = useState<{ refKey: string; fact?: BoundFact; freshness?: SourceFreshness; failed?: boolean }>();
  const { workspaceId, userId, authzVersion } = snapshot.viewer, cursor = snapshot.cursor;
  const sourceRef = binding.sourceRef, refKey = JSON.stringify(sourceRef);
  useEffect(() => {
    if (!resources) return;
    const abort = new AbortController();
    void materialClient.facts({ workspaceId, refs: [sourceRef] }, { userId, signal: abort.signal })
      .then((reply) => setResult({ refKey, fact: reply.facts[0], freshness: reply.sourceFreshness.find((item) => item.sourceRef.sourceId === sourceRef.sourceId) }))
      .catch(() => { if (!abort.signal.aborted) setResult({ refKey, failed: true }); });
    return () => abort.abort();
  }, [workspaceId, userId, authzVersion, cursor, sourceRef, refKey, resources]);
  const current = result?.refKey === refKey ? result : undefined;
  const fact = current?.fact;
  const freshness = fact ? documentFieldStatus(fact, current?.freshness) : undefined;
  const status = binding.override ? t.localOverride : !resources ? t.field : current?.failed ? t.error : !fact ? t.loading : freshness === 'missing' ? t.fieldMissing : freshness === 'unknown' ? t.sourceUnknown : freshness === 'unconfirmed' ? t.valueUnknown : freshness === 'stale' ? t.sourceStale : t.sourceCurrent;
  const labels = fact?.state !== 'unknown' ? fact?.pinned?.labels : undefined;
  return <section className={styles.fieldContext} aria-label={t.field}>
    <div className={styles.fieldCaption}><strong>{value}</strong><span role="status">{status}</span>{labels && <span>{labels.collection} · {labels.record} · {labels.field}</span>}</div>
    <div className={styles.actions}><Button disabled={disabled} onClick={onEdit}>{t.editHere}</Button>
      {resources && <Button disabled={disabled || !fact || !['current', 'stale'].includes(fact.state)} onClick={onRestore}>{t.restoreBinding}</Button>}
      <Button disabled={disabled} onClick={onUnbind}>{t.unbind}</Button>
      {resources && fact && fact.state !== 'unknown' && <Link href={`/app/materials/sources/${sourceRef.sourceId}`}>{t.openSource}</Link>}
    </div>
  </section>;
}
