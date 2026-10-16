'use client';


import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Plus, Search, Settings2, UserRoundPlus, X } from 'lucide-react';
import { Button, Dialog } from '@/ui';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import type { OperationsClient } from '../client/transport';
import type { AvailabilityVersion, ResourceAssignment, WorkResource } from '../contracts';
import type { OperationsCopy } from '../locales';
import styles from './plan.module.css';

interface Props {
  transport: OperationsClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ArtifactSnapshot;
  assignments: ResourceAssignment[];
  copy: OperationsCopy;
  onChange: (assignments: ResourceAssignment[]) => void;
  onResolved: (resources: WorkResource[], versions: AvailabilityVersion[]) => void;
  onAvailabilityCreated?: (resource: WorkResource, version: AvailabilityVersion, previousAvailabilityVersionId: string | null) => void;
}

export function ResourceDrawer({ transport, open, onOpenChange, snapshot, assignments, copy: t, onChange, onResolved, onAvailabilityCreated }: Props) {
  const [query, setQuery] = useState(''), [resources, setResources] = useState<WorkResource[]>([]), [versions, setVersions] = useState<AvailabilityVersion[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState<unknown>(), [createOpen, setCreateOpen] = useState(false), [manageId, setManageId] = useState<string>();
  const [more, setMore] = useState<string | null>(null), [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), timer = setTimeout(() => {
      setLoading(true); setError(undefined);
      void transport.list({ workspaceId: snapshot.viewer.workspaceId, query, limit: 30 }, { userId: snapshot.viewer.userId, signal: controller.signal })
        .then((result) => { setResources(result.resources); setMore(result.nextAfter); })
        .catch((failure) => { if (!controller.signal.aborted) setError(failure); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, reload, snapshot.viewer.workspaceId, snapshot.viewer.userId, transport]);
  useEffect(() => { onResolved(resources, versions); }, [resources, versions, onResolved]);
  const selected = useMemo(() => new Map(assignments.map((item) => [item.resourceId, item])), [assignments]);
  async function loadMore() {
    if (!more) return; setLoading(true); setError(undefined);
    try {
      const result = await transport.list({ workspaceId: snapshot.viewer.workspaceId, query, after: more, limit: 30 }, { userId: snapshot.viewer.userId });
      setResources((current) => [...current, ...result.resources.filter((item) => !current.some((old) => old.id === item.id))]); setMore(result.nextAfter);
    } catch (failure) { setError(failure); } finally { setLoading(false); }
  }
  function toggle(resource: WorkResource) {
    const existing = selected.get(resource.id);
    if (existing) onChange(assignments.filter((item) => item.resourceId !== resource.id));
    else onChange([...assignments, { resourceId: resource.id, resourceRevision: resource.revision, ...(resource.currentAvailabilityVersionId ? { availabilityVersionId: resource.currentAvailabilityVersionId } : {}) }]);
  }
  function created(resource: WorkResource) { setResources((current) => [resource, ...current.filter((item) => item.id !== resource.id)]); setCreateOpen(false); toggle(resource); }
  function availabilityCreated(resource: WorkResource, version: AvailabilityVersion) {
    const previousAvailabilityVersionId = resources.find((item) => item.id === resource.id)?.currentAvailabilityVersionId ?? null;
    setResources((current) => current.map((item) => item.id === resource.id ? resource : item));
    setVersions((current) => [version, ...current.filter((item) => item.id !== version.id)]);
    onAvailabilityCreated?.(resource, version, previousAvailabilityVersionId);
  }
  function resourceUpdated(resource: WorkResource) {
    setResources((current) => current.map((item) => item.id === resource.id ? resource : item));
  }
  const availabilityVersionsResolved = useCallback((items: AvailabilityVersion[]) => {
    setVersions((current) => [...items, ...current.filter((item) => !items.some((version) => version.id === item.id))]);
  }, []);
  const managed = resources.find((resource) => resource.id === manageId);
  return <>
    <Dialog open={open} onOpenChange={onOpenChange} placement="side" title={t.resources}>
      <div className={styles.drawerBody}>
        <label className={styles.searchField}><Search size={18} /><input value={query} maxLength={200} placeholder={t.searchResource} aria-label={t.searchResource} onChange={(event) => setQuery(event.target.value)} /></label>
        <Button icon={UserRoundPlus} onClick={() => setCreateOpen(true)}>{t.createResource}</Button>
        {Boolean(error) && <div className={styles.notice} role="alert"><p>{t.error}</p><Button onClick={() => setReload((value) => value + 1)}>{t.retry}</Button></div>}
        {loading && !resources.length && <p className={styles.muted}>{t.loadingResources}</p>}
        {!loading && !resources.length && <p className={styles.muted}>{t.resourceEmpty}</p>}
        <ul className={styles.resourceList}>{resources.map((resource) => {
          const assigned = selected.has(resource.id);
          return <li key={resource.id}>
            <button type="button" className={styles.resourceChoice} aria-pressed={assigned} onClick={() => toggle(resource)}>
              <span className={styles.resourceMark}>{assigned ? <Check size={17} /> : resource.displayName.slice(0, 1).toLocaleUpperCase()}</span>
              <span><strong>{resource.displayName}</strong><small>{t[resource.kind]} · {resource.currentAvailabilityVersionId ? t.currentAvailability : t.availabilityUnknown}</small></span>
              <span>{assigned ? t.unassign : t.assign}</span>
            </button>
            <button type="button" className={styles.iconAction} aria-label={`${t.manageAvailability}: ${resource.displayName}`} onClick={() => setManageId(resource.id)}><Settings2 size={18} /></button>
          </li>;
        })}</ul>
        {more && <Button pending={loading} onClick={() => { void loadMore(); }}>{t.more}</Button>}
      </div>
    </Dialog>
    <CreateResourceDialog transport={transport} open={createOpen} onOpenChange={setCreateOpen} snapshot={snapshot} copy={t} onCreated={created} />
    {managed && <AvailabilityDialog transport={transport} key={`${managed.id}:${managed.revision}`} resource={managed} open={Boolean(manageId)} onOpenChange={(value) => { if (!value) setManageId(undefined); }} snapshot={snapshot} copy={t} onUpdated={resourceUpdated} onCreated={availabilityCreated} onVersions={availabilityVersionsResolved} />}
  </>;
}

function CreateResourceDialog({ transport, open, onOpenChange, snapshot, copy: t, onCreated }: { transport: OperationsClient; open: boolean; onOpenChange: (open: boolean) => void; snapshot: ArtifactSnapshot; copy: OperationsCopy; onCreated: (resource: WorkResource) => void }) {
  const [name, setName] = useState(''), [kind, setKind] = useState<WorkResource['kind']>('person'), [timezone, setTimezone] = useState('Asia/Qyzylorda'), [pending, setPending] = useState(false), [error, setError] = useState<unknown>();
  async function submit() {
    if (!name.trim()) return; setPending(true); setError(undefined);
    try {
      const result = await transport.create({ workspaceId: snapshot.viewer.workspaceId, expectedAuthzVersion: snapshot.viewer.authzVersion, displayName: name.trim(), kind, timezone, accessClass: 'internal' }, crypto.randomUUID(), { userId: snapshot.viewer.userId });
      onCreated(result.resource); setName('');
    } catch (failure) { setError(failure); } finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange} title={t.createResource} footer={<><Button disabled={pending} onClick={() => onOpenChange(false)}>{t.cancel}</Button><Button variant="primary" pending={pending} disabled={!name.trim()} onClick={() => { void submit(); }}>{t.createResource}</Button></>}>
    <div className={styles.form}>
      <label>{t.resourceName}<input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label>
      <label>{t.resourceKind}<select value={kind} onChange={(event) => setKind(event.target.value as WorkResource['kind'])}><option value="person">{t.person}</option><option value="equipment">{t.equipment}</option><option value="place">{t.place}</option><option value="other">{t.other}</option></select></label>
      <label>{t.timezone}<input value={timezone} maxLength={80} onChange={(event) => setTimezone(event.target.value)} /></label>
      <p className={styles.explainer}><UserRoundPlus size={18} />{t.noAccountNote}</p>
      {Boolean(error) && <p className={styles.notice} role="alert">{t.error}</p>}
    </div>
  </Dialog>;
}

interface DayDraft { enabled: boolean; start: string; end: string }
const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const initialDays = (): DayDraft[] => Array.from({ length: 7 }, (_, index) => ({ enabled: index < 5, start: '09:00', end: '18:00' }));
const toMinute = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour! * 60 + minute!; };
const today = () => new Date().toISOString().slice(0, 10);

function AvailabilityDialog({ transport, resource, open, onOpenChange, snapshot, copy: t, onUpdated, onCreated, onVersions }: { transport: OperationsClient; resource: WorkResource; open: boolean; onOpenChange: (open: boolean) => void; snapshot: ArtifactSnapshot; copy: OperationsCopy; onUpdated: (resource: WorkResource) => void; onCreated: (resource: WorkResource, version: AvailabilityVersion) => void; onVersions: (versions: AvailabilityVersion[]) => void }) {
  const [days, setDays] = useState<DayDraft[]>(initialDays), [effectiveFrom, setEffectiveFrom] = useState(today), [effectiveTo, setEffectiveTo] = useState(''), [note, setNote] = useState('');
  const [exceptions, setExceptions] = useState<{ date: string; available: boolean; start: string; end: string; label: string }[]>([]), [history, setHistory] = useState<AvailabilityVersion[]>([]);
  const [pending, setPending] = useState(false), [editing, setEditing] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<unknown>();
  const [name, setName] = useState(resource.displayName), [kind, setKind] = useState(resource.kind), [resourceTimezone, setResourceTimezone] = useState(resource.timezone), [status, setStatus] = useState(resource.status);
  useEffect(() => {
    if (!open) return; const controller = new AbortController();
    void (async () => {
      setLoading(true); setError(undefined);
      try {
        const result = await transport.availabilityHistory(snapshot.viewer.workspaceId, resource.id, undefined, { userId: snapshot.viewer.userId, signal: controller.signal });
        if (!controller.signal.aborted) { setHistory(result.versions); onVersions(result.versions); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [open, resource.id, snapshot.viewer.workspaceId, snapshot.viewer.userId, onVersions, transport]);
  async function submit() {
    setPending(true); setError(undefined);
    try {
      const result = await transport.createAvailability(resource.id, {
        workspaceId: snapshot.viewer.workspaceId, expectedAuthzVersion: snapshot.viewer.authzVersion, expectedResourceRevision: resource.revision,
        timezone: resource.timezone, effectiveFrom, effectiveTo: effectiveTo || null,
        weekdays: days.flatMap((day, index) => day.enabled ? [{ weekday: index + 1, intervals: [{ startMinute: toMinute(day.start), endMinute: toMinute(day.end) }] }] : []),
        exceptions: exceptions.filter((item) => item.date).map((item) => ({ date: item.date, intervals: item.available ? [{ startMinute: toMinute(item.start), endMinute: toMinute(item.end) }] : [], ...(item.label.trim() ? { label: item.label.trim() } : {}) })),
        sourceRefs: [], verifiedAt: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}),
      }, crypto.randomUUID(), { userId: snapshot.viewer.userId });
      onCreated(result.resource, result.version); onOpenChange(false);
    } catch (failure) { setError(failure); } finally { setPending(false); }
  }
  async function saveResource() {
    if (!name.trim()) return; setEditing(true); setError(undefined);
    try {
      const result = await transport.update(resource.id, { workspaceId: snapshot.viewer.workspaceId, expectedAuthzVersion: snapshot.viewer.authzVersion, expectedRevision: resource.revision, displayName: name.trim(), kind, timezone: resourceTimezone, status }, crypto.randomUUID(), { userId: snapshot.viewer.userId });
      onUpdated(result.resource);
    } catch (failure) { setError(failure); } finally { setEditing(false); }
  }
  const valid = effectiveFrom && (!effectiveTo || effectiveTo >= effectiveFrom) && days.every((day) => !day.enabled || toMinute(day.start) < toMinute(day.end)) && exceptions.every((item) => !item.available || toMinute(item.start) < toMinute(item.end));
  const resourceChanged = name.trim() !== resource.displayName || kind !== resource.kind || resourceTimezone !== resource.timezone || status !== resource.status;
  return <Dialog open={open} onOpenChange={onOpenChange} title={`${t.availability} · ${resource.displayName}`} footer={<><Button disabled={pending} onClick={() => onOpenChange(false)}>{t.cancel}</Button><Button variant="primary" icon={CalendarClock} pending={pending} disabled={!valid} onClick={() => { void submit(); }}>{t.createAvailability}</Button></>}>
    <div className={styles.availabilityEditor}>
      <fieldset><legend>{t.resourceDetails}</legend><div className={styles.formRow}><label>{t.resourceName}<input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label><label>{t.resourceKind}<select value={kind} onChange={(event) => setKind(event.target.value as WorkResource['kind'])}><option value="person">{t.person}</option><option value="equipment">{t.equipment}</option><option value="place">{t.place}</option><option value="other">{t.other}</option></select></label></div><div className={styles.formRow}><label>{t.timezone}<input value={resourceTimezone} maxLength={80} onChange={(event) => setResourceTimezone(event.target.value)} /></label><label>{t.resourceStatus}<select value={status} onChange={(event) => setStatus(event.target.value as WorkResource['status'])}><option value="active">{t.activeResource}</option><option value="archived">{t.archivedResource}</option></select></label></div><Button pending={editing} disabled={!resourceChanged || !name.trim() || !resourceTimezone.trim()} onClick={() => { void saveResource(); }}>{t.saveResource}</Button></fieldset>
      <div className={styles.formRow}><label>{t.effectiveFrom}<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label><label>{t.effectiveTo}<input type="date" min={effectiveFrom} value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} /></label></div>
      <fieldset><legend>{t.weeklyHours}</legend>{days.map((day, index) => <div className={styles.dayRow} key={index}><label className={styles.checkLabel}><input type="checkbox" checked={day.enabled} onChange={(event) => setDays((current) => current.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item))} />{t[dayKeys[index]!]}</label><input aria-label={`${t.intervalStart} ${t[dayKeys[index]!]}`} type="time" disabled={!day.enabled} value={day.start} onChange={(event) => setDays((current) => current.map((item, position) => position === index ? { ...item, start: event.target.value } : item))} /><span>–</span><input aria-label={`${t.intervalEnd} ${t[dayKeys[index]!]}`} type="time" disabled={!day.enabled} value={day.end} onChange={(event) => setDays((current) => current.map((item, position) => position === index ? { ...item, end: event.target.value } : item))} /></div>)}</fieldset>
      <fieldset><legend>{t.exceptions}</legend>{exceptions.map((item, index) => <div className={styles.exceptionRow} key={index}><input aria-label={t.schedule} type="date" value={item.date} onChange={(event) => setExceptions((current) => current.map((entry, position) => position === index ? { ...entry, date: event.target.value } : entry))} /><label className={styles.checkLabel}><input type="checkbox" checked={item.available} onChange={(event) => setExceptions((current) => current.map((entry, position) => position === index ? { ...entry, available: event.target.checked } : entry))} />{item.available ? t.available : t.unavailable}</label>{item.available && <><input aria-label={t.intervalStart} type="time" value={item.start} onChange={(event) => setExceptions((current) => current.map((entry, position) => position === index ? { ...entry, start: event.target.value } : entry))} /><input aria-label={t.intervalEnd} type="time" value={item.end} onChange={(event) => setExceptions((current) => current.map((entry, position) => position === index ? { ...entry, end: event.target.value } : entry))} /></>}<input aria-label={t.availabilityNote} value={item.label} maxLength={240} onChange={(event) => setExceptions((current) => current.map((entry, position) => position === index ? { ...entry, label: event.target.value } : entry))} /><button type="button" className={styles.iconAction} aria-label={t.remove} onClick={() => setExceptions((current) => current.filter((_, position) => position !== index))}><X size={17} /></button></div>)}<Button icon={Plus} onClick={() => setExceptions((current) => [...current, { date: '', available: false, start: '09:00', end: '18:00', label: '' }])}>{t.addException}</Button></fieldset>
      <label>{t.availabilityNote}<textarea value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} /></label>
      {loading && <p className={styles.muted}>{t.loading}</p>}{history.length > 0 && <p className={styles.muted}>{t.currentAvailability}: v{history[0]!.revision} · {history[0]!.effectiveFrom}{history[0]!.effectiveTo ? ` — ${history[0]!.effectiveTo}` : ''}</p>}
      {Boolean(error) && <p className={styles.notice} role="alert">{t.error}</p>}
    </div>
  </Dialog>;
}

