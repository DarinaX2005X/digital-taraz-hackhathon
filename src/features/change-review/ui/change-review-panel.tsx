'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GitCompareArrows, RefreshCw, Undo2 } from 'lucide-react';
import type { ChangeSet } from '@/contracts/dependencies';
import type { ArtifactViewer } from '@/features/artifacts/contracts';
import type { Locale } from '@/i18n/locales';
import { Button, Dialog } from '@/ui';
import { selectableGroups } from '@/features/dependencies/domain/proposal';
import { createChangeReviewClient, PendingReviewSchema, ReviewError, type PendingReview } from '../client';
import { changeReviewCopy } from '../locales';
import { ChangePreview } from './change-preview';
import styles from './changes.module.css';

export interface ChangeReviewPanelProps {
  viewer: ArtifactViewer; projectId: string; locale: Locale; disabled?: boolean;
  beforeReview?: () => Promise<boolean>;
  onCommitted?: (artifactIds: string[]) => Promise<void> | void;
  onUndo?: (commandGroupId: string) => Promise<void>;
}
export function ChangeReviewPanel(props: ChangeReviewPanelProps) {
  const { viewer, projectId, locale, disabled, beforeReview, onCommitted, onUndo } = props;
  const t = changeReviewCopy[locale], client = useMemo(() => createChangeReviewClient(viewer, projectId), [viewer, projectId]);
  const storageKey = `tirlik-linked-review:${viewer.userId}:${viewer.workspaceId}:${projectId}`;
  const [open, setOpen] = useState(false), [changeset, setChangeset] = useState<ChangeSet>(), [selected, setSelected] = useState<string[]>([]), [pending, setPending] = useState<PendingReview>(), [busy, setBusy] = useState(false), [message, setMessage] = useState<string>(), [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null), active = useRef(true), initialized = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  function persist(value: { pending?: PendingReview; changesetId?: string }) { try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* The visible current decision remains retryable for this session. */ } }
  async function show() {
    setOpen(true);
    if (initialized.current) return;
    initialized.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { pending?: unknown; changesetId?: string };
      if (saved.pending) {
        const parsed = PendingReviewSchema.safeParse(saved.pending);
        if (parsed.success && parsed.data.body.workspaceId === viewer.workspaceId && parsed.data.body.projectId === projectId) { setPending(parsed.data); setMessage(t.interrupted); setFailed(true); }
      }
      if (saved.changesetId) {
        const read = new AbortController(); controller.current = read; setBusy(true);
        const result = await client.read(saved.changesetId, read.signal);
        if (active.current) { setChangeset(result.changeset); setSelected(selectableGroups(result.changeset.proposal).filter((id) => ![...result.changeset.acceptedGroupIds, ...result.changeset.rejectedGroupIds].includes(id))); }
      }
    } catch { if (active.current) { setMessage(t.failed); setFailed(true); } }
    finally { if (active.current) setBusy(false); }
  }
  async function submit(operation: PendingReview) {
    if (busy) return;
    setBusy(true); setMessage(undefined); setFailed(false);
    const request = new AbortController(); controller.current = request;
    try {
      if (beforeReview && !await beforeReview()) { setMessage(t.saveFirst); setFailed(true); return; }
      persist({ pending: operation, changesetId: changeset?.id }); setPending(operation);
      const result = await client.submit(operation, request.signal);
      if (!active.current) return;
      setChangeset(result.changeset); setSelected(selectableGroups(result.changeset.proposal).filter((id) => ![...result.changeset.acceptedGroupIds, ...result.changeset.rejectedGroupIds].includes(id))); setPending(undefined);
      persist({ changesetId: result.changeset.id });
      setMessage(operation.kind === 'accept' ? t.applied : operation.kind === 'reject' ? t.rejected : undefined);
      if (result.receipt) await onCommitted?.(result.receipt.artifacts.map((artifact) => artifact.artifactId));
    } catch (error) {
      if (!active.current) return;
      const conflict = error instanceof ReviewError && error.status === 409;
      if (error instanceof ReviewError && !error.uncertain) { setPending(undefined); persist({ changesetId: changeset?.id }); }
      setMessage(conflict ? t.updated : t.failed); setFailed(true);
    } finally { if (active.current) setBusy(false); }
  }
  function prepare() { void submit({ kind: 'prepare', id: crypto.randomUUID(), body: { workspaceId: viewer.workspaceId, projectId, expectedAuthzVersion: viewer.authzVersion } }); }
  function review(kind: 'accept' | 'reject') { if (changeset && selected.length) void submit({ kind, id: crypto.randomUUID(), changesetId: changeset.id, body: { workspaceId: viewer.workspaceId, projectId, expectedAuthzVersion: viewer.authzVersion, expectedRevision: changeset.revision, groupIds: selected } }); }
  async function undo() {
    if (!changeset?.commandGroupId || !onUndo) return;
    setBusy(true); setMessage(undefined);
    try { if (beforeReview && !await beforeReview()) { setMessage(t.saveFirst); return; } await onUndo(changeset.commandGroupId); setChangeset(undefined); setSelected([]); persist({}); }
    catch { setMessage(t.updated); setFailed(true); }
    finally { if (active.current) setBusy(false); }
  }
  return <><Button icon={GitCompareArrows} disabled={disabled} onClick={() => { void show(); }}>{t.open}</Button>
    <Dialog open={open} onOpenChange={setOpen} title={t.title} description={t.description} placement="side" className={styles.panel} dismissible={!busy} footer={<div className={styles.actions}>
      {pending ? <Button variant="primary" pending={busy} pendingLabel={t.pending} onClick={() => { void submit(pending); }}>{t.retry}</Button> : <>
        <Button variant="primary" disabled={!selected.length || disabled} pending={busy} pendingLabel={t.pending} onClick={() => review('accept')}>{t.accept}</Button>
        <Button disabled={!selected.length || busy || disabled} onClick={() => review('reject')}>{t.reject}</Button>
        {changeset?.commandGroupId && onUndo && <Button icon={Undo2} disabled={busy || disabled} onClick={() => { void undo(); }}>{t.undo}</Button>}
      </>}
    </div>}>
      <div className={styles.refresh}><Button icon={RefreshCw} pending={busy} pendingLabel={t.checking} disabled={Boolean(pending) || disabled} onClick={prepare}>{t.check}</Button></div>
      {message && <p className={failed ? styles.error : styles.success} role={failed ? 'alert' : 'status'}>{message}</p>}
      {changeset ? <ChangePreview changeset={changeset} locale={locale} selected={selected} onSelect={setSelected} disabled={busy || Boolean(pending)} /> : !busy && <div className={styles.empty}><h3>{t.noLinks}</h3><p>{t.noLinksHint}</p></div>}
    </Dialog>
  </>;
}
