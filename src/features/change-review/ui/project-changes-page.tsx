'use client';

import Link from 'next/link';
import { ArrowLeft, Check, GitCompareArrows, RefreshCw, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeSet } from '@/contracts/dependencies';
import type { ArtifactViewer } from '@/features/artifacts/contracts';
import { artifactClient } from '@/features/artifacts/client/transport';
import { prepareHistoryOperation } from '@/features/artifacts/client/checked-history';
import { selectableGroups } from '@/features/dependencies/domain/proposal';
import { formatInstant } from '@/i18n';
import { useLocale } from '@/i18n/provider';
import { Button, EmptyState, LoadingState } from '@/ui';
import { createChangeReviewClient, type PendingReview } from '../client';
import { changeReviewCopy, changeReviewPageCopy } from '../locales';
import { ChangePreview } from './change-preview';
import styles from './changes.module.css';

export function ProjectChangesPage({ viewer, projectId, projectTitle, canEdit }: { viewer: ArtifactViewer; projectId: string; projectTitle: string; canEdit: boolean }) {
  const { locale } = useLocale(), t = changeReviewCopy[locale], page = changeReviewPageCopy[locale];
  const client = useMemo(() => createChangeReviewClient(viewer, projectId), [viewer, projectId]);
  const [items, setItems] = useState<ChangeSet[]>([]), [nextAfter, setNextAfter] = useState<string | null>(null);
  const [current, setCurrent] = useState<ChangeSet>(), [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), controller = useRef<AbortController | null>(null);
  const select = useCallback((value: ChangeSet) => {
    setCurrent(value);
    const settled = new Set([...value.acceptedGroupIds, ...value.rejectedGroupIds]);
    setSelected(selectableGroups(value.proposal).filter((id) => !settled.has(id)));
    setError(''); setNotice('');
  }, []);
  const load = useCallback(async (after?: string) => {
    const request = new AbortController(); controller.current = request;
    if (!after) setLoading(true); setError('');
    try {
      const result = await client.list(after, request.signal);
      if (!alive.current) return;
      setItems((previous) => after ? [...previous, ...result.changesets.filter((item) => !previous.some((old) => old.id === item.id))] : result.changesets);
      setNextAfter(result.nextAfter);
      if (!after && result.changesets[0]) select(result.changesets[0]);
    } catch { if (alive.current) setError(page.unavailable); }
    finally { if (alive.current) setLoading(false); }
  }, [client, page.unavailable, select]);
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(timer); alive.current = false; controller.current?.abort(); };
  }, [load]);
  function replace(value: ChangeSet) { setItems((list) => [value, ...list.filter((item) => item.id !== value.id)]); select(value); }
  async function submit(operation: PendingReview) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await client.submit(operation);
      if (!alive.current) return;
      replace(result.changeset);
      setNotice(operation.kind === 'accept' ? t.applied : operation.kind === 'reject' ? t.rejected : '');
    } catch { if (alive.current) setError(t.updated); }
    finally { if (alive.current) setBusy(false); }
  }
  function prepare() { void submit({ kind: 'prepare', id: crypto.randomUUID(), body: { workspaceId: viewer.workspaceId, projectId, expectedAuthzVersion: viewer.authzVersion } }); }
  function review(kind: 'accept' | 'reject') {
    if (!current || !selected.length) return;
    void submit({ kind, id: crypto.randomUUID(), changesetId: current.id, body: { workspaceId: viewer.workspaceId, projectId, expectedAuthzVersion: viewer.authzVersion, expectedRevision: current.revision, groupIds: selected } });
  }
  async function undo() {
    if (!current?.commandGroupId || busy) return;
    const artifactId = Object.keys(current.proposal.expectedArtifactRevisions)[0];
    if (!artifactId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const history = await artifactClient.history(artifactId, { viewer });
      const operation = prepareHistoryOperation(history, current.commandGroupId, 'undo');
      if (operation.kind !== 'undo') throw new Error('change-review-history-action-mismatch');
      await artifactClient.historyAction('undo', operation.body, { viewer });
      if (alive.current) setNotice(page.undoDone);
    } catch { if (alive.current) setError(page.undoUnavailable); }
    finally { if (alive.current) setBusy(false); }
  }
  return <main className={styles.page}>
    <Link className={styles.back} href={`/app/projects/${projectId}`}><ArrowLeft size={18} />{page.back}</Link>
    <header className={styles.pageHeader}><div><p className={styles.eyebrow}>{projectTitle}</p><h1>{page.title}</h1><p>{page.description}</p></div>{canEdit && <Button variant="primary" icon={GitCompareArrows} pending={busy} onClick={prepare}>{page.prepare}</Button>}</header>
    <div className={styles.reviewLayout}>
      <aside className={styles.reviewList} aria-label={page.list}><h2>{page.list}</h2>
        {loading && <LoadingState />}
        {!loading && !items.length && <p className={styles.hint}>{t.noLinks}</p>}
        {items.map((item) => <button type="button" key={item.id} className={current?.id === item.id ? styles.reviewSelected : styles.reviewItem} onClick={() => select(item)}><strong>{page.states[item.state]}</strong><span>{page.prepared} {formatInstant(locale, item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</span><small>{item.proposal.changes.filter((change) => change.state !== 'unchanged').length} · {item.acceptedGroupIds.length + item.rejectedGroupIds.length}</small></button>)}
        {nextAfter && <Button icon={RefreshCw} disabled={loading || busy} onClick={() => { void load(nextAfter); }}>{page.loadMore}</Button>}
      </aside>
      <section className={styles.reviewDetail} aria-live="polite">
        {error && <div className={styles.error} role="alert"><p>{error}</p><Button onClick={() => { void load(); }}>{page.retry}</Button></div>}
        {notice && <p className={styles.success} role="status">{notice}</p>}
        {!current && !loading && <EmptyState icon={GitCompareArrows} title={page.chooseReview} />}
        {current && <><div className={styles.reviewMeta}><strong>{page.states[current.state]}</strong><span>{page.prepared} {formatInstant(locale, current.createdAt, { dateStyle: 'long', timeStyle: 'short' })}</span></div><ChangePreview changeset={current} locale={locale} selected={selected} onSelect={setSelected} disabled={busy || !canEdit} />
          {canEdit && <div className={styles.actions}><Button variant="primary" icon={Check} disabled={!selected.length || busy} pending={busy} onClick={() => review('accept')}>{t.accept}</Button><Button icon={X} disabled={!selected.length || busy} onClick={() => review('reject')}>{t.reject}</Button>{current.commandGroupId && <Button icon={Undo2} disabled={busy} onClick={() => { void undo(); }}>{t.undo}</Button>}</div>}
        </>}
      </section>
    </div>
  </main>;
}
