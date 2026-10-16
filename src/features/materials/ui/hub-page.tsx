'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Plus, RefreshCw } from 'lucide-react';
import { Button, Combobox, InputField, SelectField, Tabs, type OptionLoader, type SelectOption } from '@/ui';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { workspaceClient } from '@/features/workspace/client/transport';
import { LibraryActions, type LibraryActionLabels } from '@/features/workspace/ui/library-actions';
import { sourceClient } from '@/features/sources/client/transport';
import { SourceStatus } from '@/features/sources/ui/common';
import type { MaterialCollection } from '@/contracts/materials';
import type { SourceSummary, SourceFormat } from '@/contracts/sources';
import { materialClient } from '../client/transport';
import { MaterialError, useMaterialCopy } from './common';
import { MappingJourney } from './mapping-journey';
import { SourceThumbnail } from './source-thumbnail';
import styles from './materials.module.css';

export function MaterialsHub({ ownerId, initialWorkspaceId, initialProject, initialSource }: { ownerId: string; initialWorkspaceId?: string; initialProject?: SelectOption; initialSource?: { sourceId: string; sourceVersionId: string } }) {
  const t = useMaterialCopy(), access = useWorkspaceAccess(ownerId), { run } = access;
  const memberships = access.account.viewer?.user.id === ownerId ? access.account.viewer.workspaces : [];
  const [selectedWorkspace, setSelectedWorkspace] = useState(initialWorkspaceId ?? ''), workspaceId = selectedWorkspace || memberships[0]?.workspaceId || '';
  const [project, setProject] = useState<SelectOption | null>(initialProject ?? null), [query, setQuery] = useState(''), [format, setFormat] = useState(''), [kind, setKind] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [lifecycleState, setLifecycleState] = useState<'active' | 'archived' | 'trashed'>('active');
  const [tab, setTab] = useState('sources'), [sources, setSources] = useState<SourceSummary[]>([]), [collections, setCollections] = useState<MaterialCollection[]>([]), [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [selectedSource, setSelectedSource] = useState(initialSource);
  const loadProjects = useCallback<OptionLoader>(async (query, signal) => workspaceId ? (await run((signal) => workspaceClient.list({ workspaceId, query, limit: 30 }, { userId: ownerId, signal }), signal)).projects.map((item) => ({ id: item.id, label: item.title })) : [], [workspaceId, ownerId, run]);
  const load = useCallback(async (signal: AbortSignal, after?: string) => {
    const input = { workspaceId, projectId: project?.id, query, from: from || undefined, to: to || undefined, lifecycleState, after };
    if (tab === 'sources') { const result = await run((signal) => materialClient.sources({ ...input, format: format ? format as SourceFormat : undefined }, { userId: ownerId, signal }), signal); setSources((old) => after ? [...old, ...result.sources] : result.sources); setNext(result.nextCursor); }
    else { const result = await run((signal) => materialClient.list({ ...input, kind: kind ? kind as MaterialCollection['kind'] : undefined }, { userId: ownerId, signal }), signal); setCollections((old) => after ? [...old, ...result.collections] : result.collections); setNext(result.nextCursor); }
  }, [workspaceId, project?.id, query, from, to, lifecycleState, tab, format, kind, run, ownerId]);
  useEffect(() => {
    if (!workspaceId || access.phase !== 'active' || selectedSource) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { setBusy(true); setError(undefined); void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setError(error); }).finally(() => { if (!controller.signal.aborted) setBusy(false); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceId, access.phase, selectedSource, load, refresh]);
  const addHref = `/app/materials/add?${new URLSearchParams({ workspaceId, ...(project ? { projectId: project.id } : {}) })}`;
  if (access.phase !== 'active') return <WorkspaceShell workspaceId={workspaceId}><WorkspaceAccessState access={access} returnTo={`/app/materials?workspaceId=${workspaceId}`} /></WorkspaceShell>;
  if (selectedSource) return <MappingJourney ownerId={ownerId} workspaceId={workspaceId} source={selectedSource} onBack={() => setSelectedSource(undefined)} />;
  const membership = memberships.find((item) => item.workspaceId === workspaceId);
  const actionLabels: LibraryActionLabels = { more: t.moreActions, rename: t.rename, move: t.move, duplicate: t.duplicate, trash: t.trash, restore: t.restore, title: t.actionTitle, project: t.actionProject, cancel: t.actionCancel, apply: t.actionApply, pending: t.actionPending, invalid: t.actionInvalid };
  const refreshLibrary = () => { setSources([]); setCollections([]); setNext(null); setRefresh((value) => value + 1); };
  return <WorkspaceShell workspaceId={workspaceId}><main className={styles.main}>
    <div className={styles.heading}><div><h1>{t.materials}</h1><p>{t.intro}</p></div><Link className="tl-button tl-button--primary" href={addHref}><Plus size={20} aria-hidden="true" />{t.add}</Link></div>
    <div className={styles.filters}>
      <InputField label={t.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120} />
      <Combobox label={t.project} value={project} onChange={setProject} loadOptions={loadProjects} placeholder={t.allProjects} />
      {memberships.length > 1 ? <SelectField label={t.workspace} value={workspaceId} onChange={(e) => { setSelectedWorkspace(e.target.value); setProject(null); }} >{memberships.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</SelectField> : <div />}
      <SelectField label={t.lifecycle} value={lifecycleState} onChange={(event) => { setLifecycleState(event.target.value as typeof lifecycleState); setNext(null); }}><option value="active">{t.active}</option><option value="archived">{t.archived}</option><option value="trashed">{t.trashed}</option></SelectField>
      {tab === 'sources' ? <SelectField label={t.format} value={format} onChange={(e) => setFormat(e.target.value)}><option value="">{t.all}</option>{['csv','tsv','xlsx','docx','pdf','text','png','jpeg','webp'].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</SelectField> : <SelectField label={t.kind} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">{t.all}</option>{(['catalog','prices','history','brand','general'] as const).map((item) => <option key={item} value={item}>{item === 'history' ? t.historyKind : t[item]}</option>)}</SelectField>}
      <div className={styles.dates}><InputField type="date" label={t.from} value={from} onChange={(e) => setFrom(e.target.value)} /><InputField type="date" label={t.to} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
    </div>
    <MaterialError error={error} />
    <Tabs label={t.materials} value={tab} onChange={(value) => { setTab(value); setNext(null); }} items={[
      { id:'sources', label:t.sources, content:<ul className={styles.list}>{sources.map((source) => <li className={styles.listItem} key={source.id}><div className={styles.sourceIdentity}>{source.thumbnailUploadId&&<SourceThumbnail workspaceId={workspaceId} uploadId={source.thumbnailUploadId} ownerId={ownerId} title={source.title} run={run}/>}<div><h2>{source.lifecycleState === 'trashed' ? source.title : <Link href={`/app/materials/sources/${source.id}?${new URLSearchParams({ workspaceId, from: 'library' })}`}>{source.title}</Link>}</h2><p className={styles.meta}>{source.fileName} / {source.format.toUpperCase()}</p><SourceStatus status={source.status} /></div></div><div className={styles.actions}>{source.lifecycleState === 'active' && source.currentVersionId && source.status === 'ready' && <><Link className="tl-button tl-button--quiet" href={`/app/projects/${source.projectId}?workspace=${workspaceId}&sourceId=${source.id}&sourceVersionId=${source.currentVersionId}`}>{t.use}</Link><Button onClick={() => setSelectedSource({ sourceId:source.id, sourceVersionId:source.currentVersionId! })}>{t.map}</Button></>} {membership && <LibraryActions item={{ kind:'source', id:source.id, workspaceId, projectId:source.projectId, title:source.title, metadataRevision:source.metadataRevision, lifecycleState:source.lifecycleState }} authzVersion={membership.authzVersion} labels={actionLabels} loadProjects={loadProjects} onMutate={(request) => run((signal) => sourceClient.lifecycle(request, { userId:ownerId, signal }), undefined, false).then((result) => { refreshLibrary(); return result; })} />}</div></li>)}</ul> },
      { id:'collections', label:t.collections, content:<ul className={styles.list}>{collections.map((collection) => <li className={styles.listItem} key={collection.id}><div><h2>{collection.lifecycleState === 'trashed' ? collection.title : <Link href={`/app/materials/collections/${collection.id}?workspaceId=${workspaceId}`}>{collection.title}</Link>}</h2><p className={styles.meta}>{t.total}: {collection.recordCount} / {t.revision}: {collection.revision}</p></div><div className={styles.actions}>{collection.lifecycleState !== 'trashed' && <Link className="tl-button tl-button--secondary" href={`/app/materials/collections/${collection.id}?workspaceId=${workspaceId}`}>{t.open}</Link>}{membership && <LibraryActions item={{ kind:'collection', id:collection.id, workspaceId, projectId:collection.projectId, title:collection.title, metadataRevision:collection.metadataRevision, lifecycleState:collection.lifecycleState }} authzVersion={membership.authzVersion} labels={actionLabels} loadProjects={loadProjects} onMutate={(request) => run((signal) => materialClient.lifecycle(request, { userId:ownerId, signal }), undefined, false).then((result) => { refreshLibrary(); return result; })} />}</div></li>)}</ul> },
    ]} />
    {!busy && !error && !(tab === 'sources' ? sources.length : collections.length) && <div className={styles.empty}><FolderOpen size={36} aria-hidden="true" /><h2>{query || project || from || to || format || kind ? t.noResults : t.empty}</h2><p>{t.emptyHint}</p><Link href={addHref} className="tl-button tl-button--primary">{t.add}</Link></div>}
    <div className={styles.footer}><span role="status">{busy ? t.loading : ''}</span><div className={styles.actions}>{Boolean(error) && <Button icon={RefreshCw} onClick={() => setRefresh((value) => value + 1)}>{t.retry}</Button>}{next && <Button pending={busy} onClick={() => { setBusy(true); void load(new AbortController().signal, next).catch(setError).finally(() => setBusy(false)); }}>{t.more}</Button>}</div></div>
  </main></WorkspaceShell>;
}


