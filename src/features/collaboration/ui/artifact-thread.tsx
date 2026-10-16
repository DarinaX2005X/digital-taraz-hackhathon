'use client';

import { CheckCircle2, MessageSquare, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { formatInstant } from '@/i18n';
import { useLocale } from '@/i18n/provider';
import { Button, EmptyState, LoadingState, TextareaField } from '@/ui';
import type { CollaborationTarget, CollaborationThread } from '../contracts';
import { collaborationClient, CollaborationRequestError } from '../client/transport';
import { collaborationCopy } from '../locales';
import styles from './artifact-thread.module.css';

export function ArtifactThread({ userId, workspaceId, projectId, artifactId, artifactRevision, target = { kind: 'artifact' }, disabled = false }: {
  userId: string; workspaceId: string; projectId: string; artifactId: string; artifactRevision: number; target?: CollaborationTarget; disabled?: boolean;
}) {
  const { locale } = useLocale(), t = collaborationCopy(locale);
  const [thread, setThread] = useState<CollaborationThread>(), [comment, setComment] = useState(''), [decisionNote, setDecisionNote] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState<unknown>(), [refresh, setRefresh] = useState(0);
  const key = `${workspaceId}:${projectId}:${artifactId}:${artifactRevision}`;
  const current = thread?.artifactId === artifactId && thread.artifactRevision === artifactRevision ? thread : undefined;

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(undefined); } });
    void collaborationClient.thread(artifactId, { workspaceId, projectId, revision: artifactRevision }, { userId, signal: controller.signal })
      .then(setThread).catch((failure) => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, artifactId, artifactRevision, projectId, userId, workspaceId, refresh]);

  async function submitComment(event: FormEvent) {
    event.preventDefault(); if (!current || !comment.trim() || disabled) return;
    setSaving(true); setError(undefined);
    try {
      await collaborationClient.comment({ workspaceId, projectId, artifactId, artifactRevision, parentId: null, target, body: comment.trim(), expectedAuthzVersion: current.authzVersion }, crypto.randomUUID(), { userId });
      setComment(''); setRefresh((value) => value + 1);
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function resolve(commentId: string, resolved: boolean) {
    if (!current || disabled) return; setSaving(true); setError(undefined);
    try { await collaborationClient.resolve(commentId, { workspaceId, expectedAuthzVersion: current.authzVersion, resolved }, crypto.randomUUID(), { userId }); setRefresh((value) => value + 1); }
    catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function decide(decision: 'approved' | 'changes_requested') {
    if (!current || disabled) return; setSaving(true); setError(undefined);
    try { await collaborationClient.decide({ workspaceId, projectId, artifactId, artifactRevision, decision, note: decisionNote.trim(), expectedAuthzVersion: current.authzVersion }, crypto.randomUUID(), { userId }); setDecisionNote(''); setRefresh((value) => value + 1); }
    catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  const message = error instanceof CollaborationRequestError && error.status === 409 ? t.conflict : t.error;
  return <section className={styles.thread} aria-labelledby="artifact-thread-title">
    <div className={styles.heading}><div><h2 id="artifact-thread-title">{t.comments}</h2><p>{t.versionTarget}</p></div><span>v{artifactRevision}</span></div>
    {Boolean(error) && <div className={styles.error} role="alert"><p>{message}</p><Button icon={RefreshCw} onClick={() => setRefresh((value) => value + 1)}>{t.retry}</Button></div>}
    {loading && !current ? <LoadingState label={t.loading} /> : current ? <>
      {current.latestDecision && <div className={styles.decision} data-decision={current.latestDecision.decision}><CheckCircle2 size={18} aria-hidden="true" /><span><strong>{current.latestDecision.decision === 'approved' ? t.approved : t.changesRequested}</strong>{current.latestDecision.note && <small>{current.latestDecision.note}</small>}</span><time dateTime={current.latestDecision.createdAt}>{formatInstant(locale, current.latestDecision.createdAt)}</time></div>}
      {current.comments.length ? <ol className={styles.comments}>{current.comments.map((item) => <li key={item.id} data-state={item.state}><div><MessageSquare size={17} aria-hidden="true" /><time dateTime={item.createdAt}>{formatInstant(locale, item.createdAt)}</time><span>{item.state === 'resolved' ? t.resolve : t.comment}</span></div><p>{item.body}</p>{(current.permissions.resolve || item.authorId === userId) && <Button variant="quiet" icon={item.state === 'open' ? CheckCircle2 : RotateCcw} disabled={saving || disabled} onClick={() => { void resolve(item.id, item.state === 'open'); }}>{item.state === 'open' ? t.resolve : t.reopen}</Button>}</li>)}</ol> : <EmptyState title={t.noComments} />}
      {current.permissions.comment && <form className={styles.form} onSubmit={submitComment}><TextareaField label={t.comment} required maxLength={8000} value={comment} disabled={saving || disabled} onChange={(event) => setComment(event.target.value)} /><Button type="submit" variant="primary" disabled={disabled} pending={saving} pendingLabel={t.saving}>{t.addComment}</Button></form>}
      {(current.permissions.approve || current.permissions.requestChanges) && <div className={styles.review}><TextareaField label={t.decisionNote} maxLength={8000} value={decisionNote} disabled={saving || disabled} onChange={(event) => setDecisionNote(event.target.value)} /><div>{current.permissions.requestChanges && <Button disabled={saving || disabled} onClick={() => { void decide('changes_requested'); }}>{t.requestChanges}</Button>}{current.permissions.approve && <Button variant="primary" disabled={saving || disabled} onClick={() => { void decide('approved'); }}>{t.approveVersion}</Button>}</div></div>}
    </> : null}
  </section>;
}
