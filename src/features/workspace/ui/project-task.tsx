'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FileText } from 'lucide-react';
import type { SourceSummary } from '@/contracts/sources';
import { useLocale } from '@/i18n/provider';
import { runClient } from '@/features/runs/client/transport';
import { sourceClient } from '@/features/sources/client/transport';
import { Button } from '@/ui';
import { isDefiniteRequestRejection } from '../domain/request-attempt';
import { prepareTaskRequest, readTaskRequest, readTaskSelection, taskRequestKey, taskSelectionKey, type TaskRequest } from '../domain/task-request';
import { WorkspaceError, useWorkspaceCopy } from './shell';
import styles from './workspace.module.css';

export function ProjectTask({ ownerId, workspaceId, projectId, goal, sources, active, canEdit, selectedSource, beforeStart, onBusyChange, onStarted, run }: {
  ownerId: string; workspaceId: string; projectId: string; goal: string; sources: SourceSummary[] | undefined;
  active: boolean; canEdit: boolean; selectedSource?: { sourceId: string; sourceVersionId: string };
  beforeStart: () => Promise<boolean>; onBusyChange: (busy: boolean) => void;
  onStarted: (runId: string) => void;
  run: <T>(action: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal, purge?: boolean) => Promise<T>;
}) {
  const t = useWorkspaceCopy(), { locale } = useLocale();
  const [selected, setSelected] = useState<string[]>([]), [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false), [restored, setRestored] = useState(false);
  const [error, setError] = useState<unknown>(), [sourceChanged, setSourceChanged] = useState(false);
  const [pinnedSource, setPinnedSource] = useState<{ id: string; title: string; revision: number }>();
  const [pinLoading, setPinLoading] = useState(false);
  const request = useRef<TaskRequest | undefined>(undefined), restoredSource = useRef<string | undefined>(undefined);
  const storageKey = taskRequestKey(ownerId, projectId);
  const selectionStorageKey = taskSelectionKey(ownerId, projectId);
  const readySources = sources?.filter((item) => item.status === 'ready' && item.currentVersionId && item.revision > 0) ?? [];

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = readTaskRequest(sessionStorage.getItem(storageKey), workspaceId, projectId);
        if (saved) { request.current = saved; setSelected(saved.input.inputRefs.filter((ref) => ref.kind === 'source').map((ref) => ref.id)); setUncertain(true); onBusyChange(true); }
        else setSelected(readTaskSelection(sessionStorage.getItem(selectionStorageKey)));
      } catch { /* The request stays in memory if this browser disallows tab storage. */ }
      setRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [storageKey, selectionStorageKey, workspaceId, projectId, onBusyChange]);
  useEffect(() => {
    if (!restored || request.current) return;
    try { sessionStorage.setItem(selectionStorageKey, JSON.stringify(selected)); } catch { /* The in-memory selection remains available. */ }
  }, [restored, selected, selectionStorageKey]);
  useEffect(() => {
    if (!selectedSource || restoredSource.current === selectedSource.sourceVersionId || request.current || !active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPinLoading(true);
      void run((signal) => sourceClient.readVersion(workspaceId, selectedSource.sourceId, selectedSource.sourceVersionId, { userId: ownerId, signal }), controller.signal, false).then((version) => {
        if (controller.signal.aborted) return;
        if (version.projectId !== projectId) throw new Error('source-project-mismatch');
        restoredSource.current = selectedSource.sourceVersionId;
        setPinnedSource({ id: selectedSource.sourceId, title: version.title, revision: version.sourceRef.revision });
        setSelected((previous) => [...new Set([...previous, selectedSource.sourceId])]); setSourceChanged(false);
      }).catch(() => { if (!controller.signal.aborted) setSourceChanged(true); }).finally(() => { if (!controller.signal.aborted) setPinLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selectedSource, active, run, workspaceId, projectId, ownerId]);

  async function start() {
    if (!active || !canEdit || pending || !restored || (!request.current && !goal.trim())) return;
    setPending(true); setError(undefined); onBusyChange(true);
    try {
      if (!request.current) {
        if (!await beforeStart()) { onBusyChange(false); return; }
        request.current = prepareTaskRequest({ workspaceId, projectId, goal, locale, sources: sources ?? [], selected, pinned: pinnedSource ? [{ kind: 'source', id: pinnedSource.id, revision: pinnedSource.revision }] : [] });
        try { sessionStorage.setItem(storageKey, JSON.stringify(request.current)); } catch { /* Page guards preserve the same request while mounted. */ }
      }
      const attempt = request.current;
      const result = await run((signal) => runClient.create(attempt.input, attempt.key, { userId: ownerId, signal }));
      request.current = undefined;
      try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(selectionStorageKey); } catch { /* A confirmed request is safe to replay by its existing idempotency key. */ }
      setUncertain(false); onBusyChange(false);
      onStarted(result.id);
    } catch (failure) {
      const rejected = isDefiniteRequestRejection(failure);
      if (rejected) { request.current = undefined; try { sessionStorage.removeItem(storageKey); } catch { /* Keep memory authoritative. */ } }
      setUncertain(!rejected && Boolean(request.current)); setError(failure); onBusyChange(!rejected && Boolean(request.current));
    } finally { setPending(false); }
  }

  return <section className={styles.taskComposer} aria-labelledby="task-materials-title">
    <div className={styles.sectionHeading}><h2 id="task-materials-title">{t.taskMaterials}</h2><span className={styles.meta}>{t.taskMaterialsHint}</span></div>
    {sourceChanged && <p role="status" className={styles.error}>{t.taskSourceChanged}</p>}
    {(readySources.length > 0 || pinnedSource) ? <fieldset className={styles.sourceChoices} disabled={!canEdit || pending || uncertain}><legend className="tirlik-sr-only">{t.taskMaterials}</legend>{[...(pinnedSource ? [pinnedSource] : []), ...readySources.filter((source) => source.id !== pinnedSource?.id)].map((source) => <label key={source.id} className={styles.sourceChoice}>
      <input type="checkbox" checked={selected.includes(source.id)} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, source.id] : previous.filter((id) => id !== source.id))} />
      <FileText size={19} aria-hidden="true" /><span>{source.title}</span><span className={styles.meta}>{t.sourceVersion} {source.revision}</span>
    </label>)}</fieldset> : <p className={styles.muted}>{t.taskWithoutFiles}</p>}
    {uncertain ? <p role="status">{t.taskUncertain}</p> : <WorkspaceError error={error} saving />}
    <div className={styles.actions}><Button type="button" variant="primary" icon={uncertain ? Check : ArrowRight} pending={pending} disabled={!canEdit || !restored || pinLoading || (!uncertain && !goal.trim())} onClick={() => { void start(); }}>{uncertain ? t.taskCheck : t.taskStart}</Button><span className={styles.meta}>{t.taskReview}</span></div>
  </section>;
}
