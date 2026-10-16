'use client';

import { Copy, MoreHorizontal, MoveRight, PencilLine, Trash2, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { LibraryLifecycleAction, LibraryLifecycleMutationRequest, LibraryLifecycleResult, LibraryLifecycleState, LibraryObjectKind } from '@/contracts/library-lifecycle';
import { Button, Combobox, Dialog, DialogClose, IconButton, InputField, Menu, MenuItem, type OptionLoader, type SelectOption } from '@/ui';
import styles from './library-actions.module.css';

export type LibraryActionLabels = {
  more: string; rename: string; move: string; duplicate: string; trash: string; restore: string;
  title: string; project: string; cancel: string; apply: string; pending: string; invalid: string;
};

type Item = { kind: LibraryObjectKind; id: string; workspaceId: string; projectId: string; title: string; metadataRevision: number; lifecycleState: LibraryLifecycleState };

export function LibraryActions({ item, authzVersion, disabled = false, labels, loadProjects, onMutate }: {
  item: Item; authzVersion: number; disabled?: boolean; labels: LibraryActionLabels; loadProjects: OptionLoader;
  onMutate: (request: LibraryLifecycleMutationRequest) => Promise<LibraryLifecycleResult>;
}) {
  const [action, setAction] = useState<LibraryLifecycleAction>();
  const [title, setTitle] = useState(item.title), [project, setProject] = useState<SelectOption | null>({ id: item.projectId, label: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const available: { action: LibraryLifecycleAction; icon: typeof PencilLine }[] = item.lifecycleState === 'trashed'
    ? [{ action: 'restore', icon: Undo2 }]
    : [{ action: 'rename', icon: PencilLine }, { action: 'move', icon: MoveRight }, { action: 'duplicate', icon: Copy }, { action: 'trash', icon: Trash2 }];
  function open(next: LibraryLifecycleAction) { setAction(next); setTitle(next === 'duplicate' ? `${item.title} — ${labels.duplicate}` : item.title); setProject({ id: item.projectId, label: '' }); setError(false); }
  async function submit() {
    if (!action || busy) return;
    const cleanTitle = title.trim();
    if ((action === 'rename' || action === 'duplicate') && (!cleanTitle || cleanTitle.length > 240) || (action === 'move' || action === 'duplicate') && !project) { setError(true); return; }
    const base = { objectKind: item.kind, workspaceId: item.workspaceId, objectId: item.id, expectedAuthzVersion: authzVersion, expectedMetadataRevision: item.metadataRevision } as const;
    const command = action === 'rename' ? { ...base, action, title: cleanTitle }
      : action === 'move' ? { ...base, action, destinationProjectId: project!.id }
        : action === 'duplicate' ? { ...base, action, destinationProjectId: project!.id, title: cleanTitle, contentPolicy: 'fork-current' as const }
          : { ...base, action };
    setBusy(true); setError(false);
    try { await onMutate({ operationId: crypto.randomUUID(), command }); setAction(undefined); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  const Icon = action ? available.find((item) => item.action === action)?.icon ?? PencilLine : PencilLine;
  return <>
    <Menu label={labels.more} trigger={<IconButton icon={MoreHorizontal} label={labels.more} disabled={disabled} />}>
      {available.map((entry) => <MenuItem key={entry.action} icon={entry.icon} tone={entry.action === 'trash' ? 'danger' : 'default'} disabled={disabled} onClick={() => open(entry.action)}>{labels[entry.action]}</MenuItem>)}
    </Menu>
    {action && <Dialog open onOpenChange={(open) => { if (!open && !busy) setAction(undefined); }} title={labels[action]} initialFocus={cancel} footer={<><DialogClose ref={cancel} disabled={busy}>{labels.cancel}</DialogClose><Button icon={Icon} variant={action === 'trash' ? 'danger' : 'primary'} pending={busy} pendingLabel={labels.pending} onClick={() => { void submit(); }}>{labels.apply}</Button></>}>
      <div className={styles.fields}>
        {(action === 'rename' || action === 'duplicate') && <InputField label={labels.title} value={title} maxLength={240} required error={error ? labels.invalid : undefined} onChange={(event) => { setTitle(event.target.value); setError(false); }} />}
        {(action === 'move' || action === 'duplicate') && <Combobox label={labels.project} value={project} onChange={(value) => { setProject(value); setError(false); }} loadOptions={loadProjects} required error={error ? labels.invalid : undefined} />}
        {(action === 'trash' || action === 'restore') && <p className={styles.item}>{item.title}</p>}
        {error && action !== 'rename' && action !== 'duplicate' && <p className={styles.error} role="alert">{labels.invalid}</p>}
      </div>
    </Dialog>}
  </>;
}
