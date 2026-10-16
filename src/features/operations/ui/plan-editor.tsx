'use client';


import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, CheckSquare2, CircleHelp, Copy, List, LockKeyhole, Plus, Redo2, Save, Sparkles, Trash2, Undo2, UnlockKeyhole, UsersRound, X } from 'lucide-react';
import { Button } from '@/ui';
import type { ArtifactSession } from '@/features/artifacts/client/session';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue } from '@/features/artifacts/domain/content-models';
import { useLocale } from '@/i18n/provider';
import { createPlanController } from '../client/controller';
import { operationsClient } from '../client/transport';
import type { AvailabilityVersion, CapacityAssessment, WorkResource } from '../contracts';
import { assessPlanCapacity, capacityAssessmentKey } from '../domain/capacity';
import { entryLockCommand, planCommand } from '../domain/commands';
import { bulkUpdateEntries, canonicalAssignments, duplicateEntry, insertEntry, moveEntryToLocalDate, removeEntries, reorderEntry, updateEntry, type OperationalPlanContent, type OperationalPlanEntry } from '../domain/model';
import type { PlanConstraintCode, PlanObjective, ProposeWorkPlanResult } from '../domain/propose-work-plan';
import { addCalendarDays, localDateMinuteToInstant, zonedParts } from '../domain/time';
import { assessAvailabilityVersionChange, type AvailabilityVersionImpact } from '../domain/impact';
import { operationsCopies } from '../locales';
import { ResourceDrawer } from './resource-drawer';
import styles from './plan.module.css';

type View = 'list' | 'calendar' | 'checklist';
type MaterialDraft = { enabled: boolean; availableAt: string };
type ProposalState = { result: ProposeWorkPlanResult; baseHash: string };
const localeTags = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' } as const;
const statusKeys = { todo: 'todo', 'in-progress': 'inProgress', done: 'done', cancelled: 'cancelled' } as const;
const reasonKeys: Record<CapacityAssessment['reasons'][number], keyof typeof operationsCopies.en> = {
  'resource-unassigned': 'reasonResourceUnassigned', 'resource-archived': 'reasonResourceArchived', 'availability-version-missing': 'reasonVersionMissing', 'availability-version-mismatch': 'reasonVersionMismatch', 'availability-not-effective': 'reasonNotEffective',
  'schedule-missing': 'reasonScheduleMissing', 'effort-missing': 'reasonEffortMissing', 'effort-unit-unknown': 'reasonEffortUnit', 'duration-missing': 'reasonDurationMissing',
  'scheduled-outside-availability': 'reasonOutside', 'effort-exceeds-window': 'reasonEffortWindow', 'overlapping-effort-exceeds-capacity': 'reasonOverlap', 'scope-too-large': 'reasonScope',
};

export function PlanEditor({ session, onFlushReady }: { session: ArtifactSession; onFlushReady?: (flush: (() => Promise<boolean>) | null) => void }) {
  const { locale } = useLocale(), t = operationsCopies[locale];
  const [controller] = useState(() => createPlanController(session, () => operationsCopies[locale].reasonEdit));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot), snapshot = sessionState.snapshot;
  const [view, setView] = useState<View>('list'), [selected, setSelected] = useState<Set<string>>(new Set()), [activeId, setActiveId] = useState<string>();
  const [resourceOpen, setResourceOpen] = useState(false), [resources, setResources] = useState<WorkResource[]>([]), [versions, setVersions] = useState<AvailabilityVersion[]>([]);
  const [resourceError, setResourceError] = useState<unknown>(), [error, setError] = useState<unknown>(), [historyBusy, setHistoryBusy] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)), [accepting, setAccepting] = useState<string>(), [acceptReason, setAcceptReason] = useState('');
  const [availabilityImpact, setAvailabilityImpact] = useState<AvailabilityVersionImpact>();
  const [proposalOpen, setProposalOpen] = useState(false), [proposalBusy, setProposalBusy] = useState(false), [proposal, setProposal] = useState<ProposalState>();
  const [proposalError, setProposalError] = useState<unknown>(), [proposalObjective, setProposalObjective] = useState<PlanObjective>('earliest-finish');
  const [proposalWindow, setProposalWindow] = useState(() => { const today = zonedParts(new Date(), state.content.timezone).date; return { start: today, end: addCalendarDays(today, 14) }; });
  const [materialDrafts, setMaterialDrafts] = useState<Record<string, MaterialDraft>>({}), [lockBusy, setLockBusy] = useState(false);
  const [planningResourceIds, setPlanningResourceIds] = useState<Set<string>>(new Set());
  useEffect(() => controller.mount(), [controller]);
  useEffect(() => { controller.setReason(() => operationsCopies[locale].reasonEdit); }, [controller, locale]);
  useEffect(() => { onFlushReady?.(controller.flush); return () => onFlushReady?.(null); }, [controller, onFlushReady]);
  const assignedResourceIds = useMemo(() => [...new Set(state.content.entries.flatMap((entry) => canonicalAssignments(entry).map((item) => item.resourceId)))].sort(), [state.content.entries]);
  const assignedResourceKey = assignedResourceIds.join('\0');
  const viewerWorkspaceId = snapshot?.viewer.workspaceId, viewerUserId = snapshot?.viewer.userId;
  useEffect(() => {
    const ids = assignedResourceKey ? assignedResourceKey.split('\0') : [];
    const abort = new AbortController();
    void (async () => {
      setResourceError(undefined);
      if (!viewerWorkspaceId || !viewerUserId || !ids.length) { setResources([]); setVersions([]); return; }
      const loadedResources: WorkResource[] = [], loadedVersions: AvailabilityVersion[] = [];
      for (const id of ids) {
        const [resource, availability] = await Promise.all([
          operationsClient.read(viewerWorkspaceId, id, { userId: viewerUserId, signal: abort.signal }),
          operationsClient.availabilityHistory(viewerWorkspaceId, id, undefined, { userId: viewerUserId, signal: abort.signal }),
        ]);
        loadedResources.push(resource.resource); loadedVersions.push(...availability.versions);
      }
      if (!abort.signal.aborted) { setResources(loadedResources); setVersions(loadedVersions); }
    })().catch((failure) => { if (!abort.signal.aborted) setResourceError(failure); });
    return () => abort.abort();
  }, [assignedResourceKey, viewerWorkspaceId, viewerUserId]);
  useEffect(() => {
    if (!proposalOpen || !viewerWorkspaceId || !viewerUserId) return;
    const abort = new AbortController();
    void (async () => {
      const loaded: WorkResource[] = [];
      let after: string | undefined;
      do {
        const page = await operationsClient.list({ workspaceId: viewerWorkspaceId, status: 'active', after, limit: 50 }, { userId: viewerUserId, signal: abort.signal });
        loaded.push(...page.resources); after = page.nextAfter ?? undefined;
        if (loaded.length >= 2_000) after = undefined;
      } while (after && !abort.signal.aborted);
      if (!abort.signal.aborted) setResources((current) => [...loaded, ...current.filter((item) => !loaded.some((next) => next.id === item.id))]);
    })().catch((failure) => { if (!abort.signal.aborted) setResourceError(failure); });
    return () => abort.abort();
  }, [assignedResourceKey, proposalOpen, viewerUserId, viewerWorkspaceId]);
  const assessments = useMemo(() => assessPlanCapacity({ plan: state.content, resources, availabilityVersions: versions }), [state.content, resources, versions]);
  const byEntry = useMemo(() => {
    const result = new Map<string, CapacityAssessment[]>();
    for (const assessment of assessments) for (const id of assessment.affectedEntryIds) result.set(id, [...(result.get(id) ?? []), assessment]);
    return result;
  }, [assessments]);
  const active = state.content.entries.find((entry) => entry.id === activeId);
  const lockedEntryIds = useMemo(() => state.content.entries.filter((entry) => Boolean(snapshot?.locks?.[entry.id])).map((entry) => entry.id), [snapshot?.locks, state.content.entries]);
  const lockedEntrySet = useMemo(() => new Set(lockedEntryIds), [lockedEntryIds]);
  const canEdit = Boolean(snapshot?.permissions.edit && sessionState.storageReady && ['ready', 'dirty', 'saving'].includes(state.phase) && !sessionState.operation.operation && !historyBusy && !proposalBusy && !lockBusy);
  const resourceMap = useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources]);
  const publishResources = useCallback((loaded: WorkResource[], availability: AvailabilityVersion[]) => {
    setResources((current) => [...loaded, ...current.filter((item) => !loaded.some((next) => next.id === item.id))]);
    setVersions((current) => [...availability, ...current.filter((item) => !availability.some((next) => next.id === item.id))]);
  }, []);
  if (!snapshot || state.phase === 'hidden') return null;
  function change(next: OperationalPlanContent, boundary: 'typing' | 'format' | 'structure' = 'format') { if (!controller.change(next, boundary)) setError(new Error('operations.errors.edit')); }
  function patch(id: string, value: Partial<OperationalPlanEntry>, boundary: 'typing' | 'format' = 'format') { try { change(updateEntry(state.content, id, value), boundary); } catch (failure) { setError(failure); } }
  function add() {
    const id = crypto.randomUUID(), entry: OperationalPlanEntry = { id, title: t.addTask, status: 'todo', resourceIds: [], dependencies: [], checklist: [], availabilityVersionIds: [], assignments: [] };
    try { change(insertEntry(state.content, entry), 'structure'); setActiveId(id); setSelected(new Set([id])); } catch (failure) { setError(failure); }
  }
  function remove(ids: string[]) { try { change(removeEntries(state.content, ids), 'structure'); setSelected(new Set()); if (activeId && ids.includes(activeId)) setActiveId(undefined); } catch (failure) { setError(failure); } }
  function duplicate(id: string) { try { const nextId = crypto.randomUUID(); change(duplicateEntry(state.content, id, nextId, () => crypto.randomUUID()), 'structure'); setActiveId(nextId); } catch (failure) { setError(failure); } }
  function duplicateSelected() {
    try {
      let next = state.content;
      const copies: string[] = [];
      for (const id of selected) {
        const nextId = crypto.randomUUID();
        next = duplicateEntry(next, id, nextId, () => crypto.randomUUID());
        copies.push(nextId);
      }
      change(next, 'structure');
      setSelected(new Set(copies));
      setActiveId(copies.at(-1));
    } catch (failure) { setError(failure); }
  }
  function move(id: string, direction: -1 | 1) {
    const index = state.content.entries.findIndex((entry) => entry.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= state.content.entries.length) return;
    const beforeId = direction < 0 ? state.content.entries[target]!.id : state.content.entries[target + 1]?.id ?? null;
    try { change(reorderEntry(state.content, id, beforeId), 'structure'); } catch (failure) { setError(failure); }
  }
  function toggleSelection(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function history(action: 'undo' | 'redo') {
    if (!canEdit) return; setHistoryBusy(true); setError(undefined);
    try {
      if (!await controller.flush()) return;
      const group = session.getSnapshot().snapshot?.history.find((item) => action === 'undo' ? item.canUndo : item.canRedo); if (!group) return;
      const prepared = await session.prepareHistory(action, group.commandGroupId);
      if (prepared.group.artifacts.length > 1 || prepared.group.hasUnavailableArtifacts) throw new Error('operations.errors.historyReview');
      await session.run(prepared.operation);
    } catch (failure) { setError(failure); } finally { setHistoryBusy(false); }
  }
  function accept(assessment: CapacityAssessment) {
    if (!acceptReason.trim()) return;
    let next = state.content;
    for (const id of assessment.affectedEntryIds) next = updateEntry(next, id, { capacityOverride: { reason: acceptReason.trim(), actorId: snapshot!.viewer.userId, acceptedAt: new Date().toISOString(), assessmentKey: capacityAssessmentKey(assessment), availabilityVersionIds: [...new Set(assessment.affectedEntryIds.flatMap((entryId) => canonicalAssignments(next.entries.find((entry) => entry.id === entryId)!).flatMap((assignment) => assignment.availabilityVersionId ? [assignment.availabilityVersionId] : [])))] } });
    change(next); setAccepting(undefined); setAcceptReason('');
  }
  function toggleProposal() {
    setProposalOpen((open) => {
      if (!open) setPlanningResourceIds(new Set(assignedResourceKey ? assignedResourceKey.split('\0') : []));
      return !open;
    });
  }
  async function requestProposal() {
    if (!snapshot || !canEdit) return;
    setProposalBusy(true); setProposalError(undefined); setProposal(undefined);
    try {
      if (!await controller.flush()) throw new Error('operations.errors.proposalSaveRequired');
      const resourceRefs = new Map(resources.filter((resource) => planningResourceIds.has(resource.id) && resource.status === 'active' && resource.currentAvailabilityVersionId).map((resource) => [resource.id, { id: resource.id, revision: resource.revision, availabilityVersionId: resource.currentAvailabilityVersionId! }]));
      for (const entry of state.content.entries.filter((item) => lockedEntryIds.includes(item.id))) for (const assignment of canonicalAssignments(entry)) {
        if (assignment.resourceRevision !== undefined && assignment.availabilityVersionId) resourceRefs.set(assignment.resourceId, { id: assignment.resourceId, revision: assignment.resourceRevision, availabilityVersionId: assignment.availabilityVersionId });
      }
      const materialConstraints = state.content.entries.flatMap((entry) => {
        const draft = materialDrafts[entry.id];
        if (!draft?.enabled) return [];
        const availableAt = draft.availableAt ? inputInstant(draft.availableAt, state.content.timezone, 'start') : null;
        return (entry.sourceRefs ?? []).map((sourceRef) => ({ entryId: entry.id, sourceRef, availableAt }));
      });
      const currentHash = hashJson(state.content as unknown as JsonValue);
      const result = await operationsClient.propose({
        workspaceId: snapshot.viewer.workspaceId,
        expectedAuthzVersion: snapshot.viewer.authzVersion,
        input: {
          plan: state.content,
          resourceRefs: [...resourceRefs.values()],
          window: {
            start: new Date(localDateMinuteToInstant(proposalWindow.start, 0, state.content.timezone, 'start')).toISOString(),
            end: new Date(localDateMinuteToInstant(addCalendarDays(proposalWindow.end, 1), 0, state.content.timezone, 'start')).toISOString(),
          },
          lockedEntryIds,
          materialConstraints,
          objective: proposalObjective,
        },
      }, { userId: snapshot.viewer.userId });
      setProposal({ result, baseHash: currentHash });
    } catch (failure) { setProposalError(failure); }
    finally { setProposalBusy(false); }
  }
  async function applyProposal() {
    if (!proposal || proposalBusy) return;
    const selectedProposal = proposal;
    if (selectedProposal.baseHash !== hashJson(state.content as unknown as JsonValue)) { setProposalError(new Error('operations.errors.proposalChanged')); return; }
    setProposalBusy(true); setProposalError(undefined);
    try {
      const applied = await controller.command(async (base) => {
        if (selectedProposal.baseHash !== hashJson(base.content as unknown as JsonValue)) throw new Error('operations.errors.proposalChanged');
        const draft = await planCommand(base, selectedProposal.result.candidate, t.reasonProposal);
        if (!draft) throw new Error('operations.errors.proposalNoChanges');
        return draft;
      }, selectedProposal.result.candidate);
      if (!applied) throw new Error('operations.errors.proposalApply');
      setProposal(undefined); setProposalOpen(false);
    } catch (failure) { setProposalError(failure); }
    finally { setProposalBusy(false); }
  }
  async function toggleLock(entry: OperationalPlanEntry, locked: boolean) {
    if (!snapshot || lockBusy) return;
    setLockBusy(true); setError(undefined);
    try {
      await controller.command((base) => entryLockCommand(base, entry.id, !locked, t.lockReason), state.content);
    } catch (failure) { setError(failure); }
    finally { setLockBusy(false); }
  }
  const problem = state.phase === 'conflict' ? t.changed : state.phase === 'recovery' ? t.recovery : state.phase === 'failed' ? t.error : undefined;
  return <section className={styles.editor} aria-label={t.editor}>
    <div className={styles.topbar}>
      <div className={styles.viewSwitch} role="tablist" aria-label={t.editor}>{(['list', 'calendar', 'checklist'] as const).map((name) => <button key={name} type="button" role="tab" aria-selected={view === name} onClick={() => setView(name)}>{name === 'list' ? <List size={17} /> : name === 'calendar' ? <CalendarDays size={17} /> : <CheckSquare2 size={17} />}{t[name]}</button>)}</div>
      <div className={styles.toolbar} role="toolbar" aria-label={t.editor}>
        <button type="button" disabled={!canEdit || !snapshot.history.some((item) => item.canUndo)} aria-label={t.undo} title={t.undo} onClick={() => { void history('undo'); }}><Undo2 size={18} /></button>
        <button type="button" disabled={!canEdit || !snapshot.history.some((item) => item.canRedo)} aria-label={t.redo} title={t.redo} onClick={() => { void history('redo'); }}><Redo2 size={18} /></button>
        <Button icon={UsersRound} onClick={() => setResourceOpen(true)}>{t.resources}</Button><Button icon={Sparkles} disabled={!canEdit} onClick={toggleProposal}>{t.proposePlan}</Button><Button icon={Plus} variant="primary" disabled={!canEdit} onClick={add}>{t.addTask}</Button>
        <button type="button" disabled={!canEdit} aria-label={t.save} title={t.save} onClick={() => { void controller.flush().catch(setError); }}><Save size={18} /></button>
      </div>
    </div>
    {Boolean(problem || error || resourceError) && <div className={styles.notice} role="alert"><AlertTriangle size={18} /><p>{problem ?? t.error}</p>{state.phase === 'failed' && <Button onClick={() => { void controller.retry(); }}>{t.retry}</Button>}</div>}
    {proposalOpen && <ProposalPanel content={state.content} resources={resourceMap} planningResourceIds={planningResourceIds} copy={t} timezone={state.content.timezone} canEdit={canEdit} busy={proposalBusy} error={proposalError} objective={proposalObjective} window={proposalWindow} materialDrafts={materialDrafts} proposal={proposal?.result} onObjective={setProposalObjective} onWindow={setProposalWindow} onMaterials={setMaterialDrafts} onPlanningResources={setPlanningResourceIds} onRequest={() => { void requestProposal(); }} onApply={() => { void applyProposal(); }} onDismiss={() => { setProposal(undefined); setProposalError(undefined); }} />}
    {availabilityImpact && <div className={styles.impactNotice} role="status"><CalendarDays size={18} /><div><strong>{t.availabilityChanged}</strong><p>{t.availabilityImpact.replace('{count}', String(availabilityImpact.affectedEntryIds.length))}</p><ul>{availabilityImpact.entries.map((item) => <li key={item.entryId}>{state.content.entries.find((entry) => entry.id === item.entryId)?.title ?? item.entryId}: {item.before} → {item.after}</li>)}</ul><div><Button variant="primary" disabled={!canEdit} onClick={() => { change(availabilityImpact.previewPlan); setAvailabilityImpact(undefined); }}>{t.applyAvailabilityVersion}</Button><Button onClick={() => setAvailabilityImpact(undefined)}>{t.keepAvailabilityVersion}</Button></div></div></div>}
    {!snapshot.permissions.edit && <div className={styles.readOnly}>{t.readOnly}</div>}
    {selected.size > 0 && <BulkBar count={selected.size} copy={t} disabled={!canEdit} onStatus={(status) => { change(bulkUpdateEntries(state.content, [...selected], { status })); }} onDuplicate={duplicateSelected} onRemove={() => remove([...selected])} onClear={() => setSelected(new Set())} />}
    <div className={styles.workbench}>
      <div className={styles.planMain}>
        {view === 'list' && <PlanList content={state.content} selected={selected} activeId={activeId} locked={lockedEntrySet} canEdit={canEdit} copy={t} locale={locale} resources={resourceMap} assessments={byEntry} onSelect={toggleSelection} onActivate={setActiveId} onPatch={patch} onMove={move} onDuplicate={duplicate} onRemove={(id) => remove([id])} />}
        {view === 'calendar' && <PlanCalendar content={state.content} month={month} locked={lockedEntrySet} copy={t} locale={locale} canEdit={canEdit} assessments={byEntry} onMonth={setMonth} onActivate={setActiveId} onMoveDate={(id, date) => { try { change(moveEntryToLocalDate(state.content, id, date), 'structure'); } catch (failure) { setError(failure); } }} />}
        {view === 'checklist' && <PlanChecklists content={state.content} canEdit={canEdit} copy={t} onActivate={setActiveId} onChange={(next) => change(next, 'typing')} />}
      </div>
      <TaskInspector entry={active} content={state.content} projectId={snapshot.artifact.projectId} canEdit={canEdit} locked={Boolean(active && snapshot.locks?.[active.id])} copy={t} locale={locale} timezone={state.content.timezone} resources={resourceMap} assessments={active ? byEntry.get(active.id) ?? [] : []} accepting={accepting} acceptReason={acceptReason} onAccepting={setAccepting} onAcceptReason={setAcceptReason} onAccept={accept} onLock={() => active && void toggleLock(active, Boolean(snapshot.locks?.[active.id]))} onClose={() => setActiveId(undefined)} onPatch={(value, boundary) => active && patch(active.id, value, boundary)} onResources={() => setResourceOpen(true)} />
    </div>
    <footer className={styles.statusbar}><span>{state.content.timezone}</span><output aria-live="polite">{state.phase === 'saving' ? t.saving : state.phase === 'dirty' ? state.localSaved ? t.local : t.saving : t.saved}</output></footer>
    <ResourceDrawer open={resourceOpen} onOpenChange={setResourceOpen} snapshot={snapshot} assignments={active ? canonicalAssignments(active) : []} copy={t} onResolved={publishResources} onAvailabilityCreated={(resource, version, previousAvailabilityVersionId) => { const impact = assessAvailabilityVersionChange({ plan: state.content, resources: [...resources.filter((item) => item.id !== resource.id), resource], availabilityVersions: [...versions.filter((item) => item.id !== version.id), version], resourceId: resource.id, previousAvailabilityVersionId, nextAvailabilityVersion: version }); setAvailabilityImpact(impact.affectedEntryIds.length ? impact : undefined); }} onChange={(assignments) => { if (active) patch(active.id, { assignments, resourceIds: assignments.map((item) => item.resourceId), availabilityVersionIds: assignments.flatMap((item) => item.availabilityVersionId ? [item.availabilityVersionId] : []), capacityOverride: undefined }); }} />
  </section>;
}

function ProposalPanel({ content, resources, planningResourceIds, copy: t, timezone, canEdit, busy, error, objective, window, materialDrafts, proposal, onObjective, onWindow, onMaterials, onPlanningResources, onRequest, onApply, onDismiss }: {
  content: OperationalPlanContent;
  resources: Map<string, WorkResource>;
  planningResourceIds: Set<string>;
  copy: typeof operationsCopies.en;
  timezone: string;
  canEdit: boolean;
  busy: boolean;
  error: unknown;
  objective: PlanObjective;
  window: { start: string; end: string };
  materialDrafts: Record<string, MaterialDraft>;
  proposal?: ProposeWorkPlanResult;
  onObjective: (value: PlanObjective) => void;
  onWindow: (value: { start: string; end: string }) => void;
  onMaterials: (value: Record<string, MaterialDraft>) => void;
  onPlanningResources: (value: Set<string>) => void;
  onRequest: () => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const materials = content.entries.filter((entry) => (entry.sourceRefs?.length ?? 0) > 0 && activeEntry(entry));
  const planningResources = [...resources.values()].filter((resource) => resource.status === 'active');
  const status = proposal?.status === 'feasible' ? t.proposalFeasible : proposal?.status === 'partial' ? t.proposalPartial : proposal?.status === 'infeasible' ? t.proposalInfeasible : t.proposalUnknown;
  return <section className={styles.proposalPanel} aria-label={t.planWork}>
    <header><div><span className={styles.eyebrow}>{t.planWork}</span><h2>{t.proposalTitle}</h2><p>{t.proposalDescription}</p></div>{proposal && <strong className={`${styles.proposalStatus} ${styles[`proposal_${proposal.status}`]}`}>{status}</strong>}</header>
    <div className={styles.proposalControls}>
      <label>{t.windowStart}<input type="date" value={window.start} disabled={busy} onChange={(event) => event.target.value && onWindow({ start: event.target.value, end: event.target.value > window.end ? event.target.value : window.end })} /></label>
      <label>{t.windowEnd}<input type="date" min={window.start} value={window.end} disabled={busy} onChange={(event) => event.target.value && onWindow({ ...window, end: event.target.value })} /></label>
      <label>{t.objective}<select value={objective} disabled={busy} onChange={(event) => onObjective(event.target.value as PlanObjective)}><option value="earliest-finish">{t.objectiveEarliest}</option><option value="least-change">{t.objectiveLeastChange}</option><option value="lowest-known-cost">{t.objectiveLowestCost}</option></select></label>
    </div>
    <fieldset className={styles.resourcePool}><legend>{t.resourcePool}</legend><p>{t.resourcePoolDescription}</p><div>{planningResources.map((resource) => <label key={resource.id}><input type="checkbox" checked={planningResourceIds.has(resource.id)} disabled={busy || !resource.currentAvailabilityVersionId} onChange={(event) => { const next = new Set(planningResourceIds); if (event.target.checked) next.add(resource.id); else next.delete(resource.id); onPlanningResources(next); }} /><span><strong>{resource.displayName}</strong><small>{resource.currentAvailabilityVersionId ? t.currentAvailability : t.availabilityUnknown}</small></span></label>)}</div>{planningResources.length === 0 && <p className={styles.muted}>{t.noPlanningResources}</p>}</fieldset>
    {materials.length > 0 && <details className={styles.materials}><summary>{t.materialConstraints}</summary><p>{t.materialDescription}</p>{materials.map((entry) => { const draft = materialDrafts[entry.id] ?? { enabled: false, availableAt: '' }; return <div key={entry.id} className={styles.materialRow}><label className={styles.materialToggle}><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => onMaterials({ ...materialDrafts, [entry.id]: { ...draft, enabled: event.target.checked } })} /><span><strong>{entry.title}</strong><small>{t.materialSources.replace('{count}', String(entry.sourceRefs!.length))}</small></span></label><label>{t.readyAt}<input type="datetime-local" value={draft.availableAt} disabled={busy || !draft.enabled} onChange={(event) => onMaterials({ ...materialDrafts, [entry.id]: { ...draft, availableAt: event.target.value } })} /></label><small>{draft.enabled && !draft.availableAt ? t.readyUnknown : timezone}</small></div>; })}</details>}
    {Boolean(error) && <div className={styles.proposalError} role="alert"><AlertTriangle size={18} /><span>{t.proposalError}</span></div>}
    {proposal && <div className={styles.proposalResult}>
      <div className={styles.proposalSummary}><div><h3>{t.compareChanges}</h3><strong>{t.candidateChanges.replace('{count}', String(proposal.changedEntryIds.length))}</strong></div><span>{t.proposalReceipt.replace('{count}', String(Object.keys(proposal.checkReceipt.inputRevisionVector).length))}</span></div>
      {proposal.changedEntryIds.length === 0 ? <p className={styles.muted}>{t.noCandidateChanges}</p> : <ul className={styles.candidateList}>{proposal.changedEntryIds.map((id) => { const before = content.entries.find((entry) => entry.id === id), after = proposal.candidate.entries.find((entry) => entry.id === id); if (!before || !after) return null; const beforeAssignment = canonicalAssignments(before)[0], afterAssignment = canonicalAssignments(after)[0]; return <li key={id}><strong>{before.title}</strong><div className={styles.candidateDiff}><span><small>{t.currentSchedule}</small>{formatCandidate(before, timezone)} · {beforeAssignment ? resources.get(beforeAssignment.resourceId)?.displayName ?? t.availabilityUnknown : t.noAssignments}</span><ArrowRight size={16} aria-hidden="true" /><span><small>{t.proposedSchedule}</small>{formatCandidate(after, timezone)} · {afterAssignment ? resources.get(afterAssignment.resourceId)?.displayName ?? t.availabilityUnknown : t.noAssignments}</span></div></li>; })}</ul>}
      {proposal.unresolved.length > 0 && <section className={styles.proposalIssues}><h3>{t.needsInput}</h3><ul>{proposal.unresolved.map((issue) => <li key={`${issue.entryId}:${issue.code}`}><strong>{content.entries.find((entry) => entry.id === issue.entryId)?.title ?? issue.entryId}</strong><span>{constraintLabel(issue.code, t)}</span></li>)}</ul></section>}
      {proposal.conflicts.length > 0 && <section className={styles.proposalIssues}><h3>{t.proposalConflicts}</h3><ul>{proposal.conflicts.map((issue) => <li key={`${issue.entryIds.join(':')}:${issue.code}`}><strong>{issue.entryIds.map((id) => content.entries.find((entry) => entry.id === id)?.title ?? id).join(', ')}</strong><span>{constraintLabel(issue.code, t)}</span></li>)}</ul></section>}
    </div>}
    <footer><Button icon={Sparkles} variant="primary" disabled={!canEdit || busy} onClick={onRequest}>{busy ? t.proposalWorking : t.buildCandidate}</Button>{proposal && <><Button disabled={!canEdit || busy || !['feasible', 'partial'].includes(proposal.status) || proposal.changedEntryIds.length === 0} onClick={onApply}>{t.applyCandidate}</Button><Button disabled={busy} onClick={onDismiss}>{t.discardCandidate}</Button></>}</footer>
  </section>;
}

function BulkBar({ count, copy: t, disabled, onStatus, onDuplicate, onRemove, onClear }: { count: number; copy: typeof operationsCopies.en; disabled: boolean; onStatus: (status: OperationalPlanEntry['status']) => void; onDuplicate: () => void; onRemove: () => void; onClear: () => void }) {
  return <div className={styles.bulkbar}><strong>{t.selected.replace('{count}', String(count))}</strong><select aria-label={t.bulkStatus} disabled={disabled} defaultValue="" onChange={(event) => { if (event.target.value) onStatus(event.target.value as OperationalPlanEntry['status']); event.target.value = ''; }}><option value="">{t.bulkStatus}</option>{Object.entries(statusKeys).map(([value, key]) => <option key={value} value={value}>{t[key]}</option>)}</select><Button icon={Copy} disabled={disabled} onClick={onDuplicate}>{t.duplicate}</Button><Button icon={Trash2} disabled={disabled} onClick={onRemove}>{t.remove}</Button><button type="button" className={styles.iconAction} aria-label={t.clearSelection} onClick={onClear}><X size={18} /></button></div>;
}

function PlanList({ content, selected, activeId, locked, canEdit, copy: t, locale, resources, assessments, onSelect, onActivate, onPatch, onMove, onDuplicate, onRemove }: { content: OperationalPlanContent; selected: Set<string>; activeId?: string; locked: ReadonlySet<string>; canEdit: boolean; copy: typeof operationsCopies.en; locale: keyof typeof localeTags; resources: Map<string, WorkResource>; assessments: Map<string, CapacityAssessment[]>; onSelect: (id: string) => void; onActivate: (id: string) => void; onPatch: (id: string, patch: Partial<OperationalPlanEntry>, boundary?: 'typing' | 'format') => void; onMove: (id: string, direction: -1 | 1) => void; onDuplicate: (id: string) => void; onRemove: (id: string) => void }) {
  if (!content.entries.length) return <div className={styles.empty}><Plus size={34} /><h2>{t.emptyPlan}</h2><p>{t.emptyPlanDescription}</p></div>;
  return <div className={styles.listTable} role="table" aria-label={t.editor}><div className={styles.listHeader} role="row"><span></span><span>{t.task}</span><span>{t.status}</span><span>{t.schedule}</span><span>{t.assignees}</span><span></span></div>{content.entries.map((entry, index) => {
    const result = assessments.get(entry.id) ?? [], conflict = result.some((item) => item.status === 'conflict'), unknown = !conflict && result.some((item) => item.status === 'availability-unknown');
    return <div key={entry.id} role="row" className={`${styles.taskRow} ${activeId === entry.id ? styles.activeRow : ''}`}>
      <span role="cell"><input type="checkbox" checked={selected.has(entry.id)} aria-label={`${t.task}: ${entry.title}`} onChange={() => onSelect(entry.id)} /></span>
      <span role="cell" className={styles.titleCell}><span className={styles.titleLine}><input value={entry.title} maxLength={1000} disabled={!canEdit} aria-label={t.taskTitle} onFocus={() => onActivate(entry.id)} onChange={(event) => onPatch(entry.id, { title: event.target.value || entry.title }, 'typing')} />{locked.has(entry.id) && <span className={styles.lockMark} aria-label={t.lockedTask} title={t.lockedTask}><LockKeyhole size={13} /></span>}</span><button type="button" className={styles.rowOpen} onClick={() => onActivate(entry.id)}>{entry.description || entry.notes ? entry.description ?? entry.notes : t.inspect}</button></span>
      <span role="cell"><select value={entry.status} disabled={!canEdit} aria-label={t.status} onChange={(event) => onPatch(entry.id, { status: event.target.value as OperationalPlanEntry['status'] })}>{Object.entries(statusKeys).map(([value, key]) => <option key={value} value={value}>{t[key]}</option>)}</select></span>
      <span role="cell" className={styles.scheduleCell}>{entry.startDate && entry.endDate ? <><input type="date" value={entry.startDate} disabled={!canEdit} aria-label={t.start} onChange={(event) => event.target.value && onPatch(entry.id, allDayStartPatch(entry, event.target.value))} /><span>–</span><input type="date" min={entry.startDate} value={entry.endDate} disabled={!canEdit} aria-label={t.end} onChange={(event) => event.target.value && onPatch(entry.id, allDayEndPatch(entry, event.target.value))} /></> : entry.startAt && entry.endAt ? <button type="button" onClick={() => onActivate(entry.id)}>{new Intl.DateTimeFormat(localeTags[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.startAt))}</button> : <button type="button" onClick={() => onActivate(entry.id)}>{t.noDate}</button>}</span>
      <span role="cell" className={styles.assigneeCell}><button type="button" onClick={() => onActivate(entry.id)}>{canonicalAssignments(entry).length ? canonicalAssignments(entry).map((assignment) => resources.get(assignment.resourceId)?.displayName ?? t.availabilityUnknown).join(', ') : t.noAssignments}</button>{conflict ? <AlertTriangle className={styles.conflictIcon} size={18} aria-label={t.conflict} /> : unknown ? <CircleHelp className={styles.unknownIcon} size={18} aria-label={t.unknownCapacity} /> : null}</span>
      <span role="cell" className={styles.rowActions}><button type="button" disabled={!canEdit || index === 0} aria-label={t.moveUp} onClick={() => onMove(entry.id, -1)}><ArrowUp size={16} /></button><button type="button" disabled={!canEdit || index === content.entries.length - 1} aria-label={t.moveDown} onClick={() => onMove(entry.id, 1)}><ArrowDown size={16} /></button><button type="button" disabled={!canEdit} aria-label={t.duplicate} onClick={() => onDuplicate(entry.id)}><Copy size={16} /></button><button type="button" disabled={!canEdit} aria-label={t.remove} onClick={() => onRemove(entry.id)}><Trash2 size={16} /></button></span>
    </div>;
  })}</div>;
}

function PlanCalendar({ content, month, locked, copy: t, locale, canEdit, assessments, onMonth, onActivate, onMoveDate }: { content: OperationalPlanContent; month: string; locked: ReadonlySet<string>; copy: typeof operationsCopies.en; locale: keyof typeof localeTags; canEdit: boolean; assessments: Map<string, CapacityAssessment[]>; onMonth: (month: string) => void; onActivate: (id: string) => void; onMoveDate: (id: string, date: string) => void }) {
  const [year, numericMonth] = month.split('-').map(Number), start = `${month}-01`, nextMonthDate = new Date(Date.UTC(year!, numericMonth!, 1)), nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`, end = addCalendarDays(nextMonth, -1);
  const leading = new Date(`${start}T00:00:00Z`).getUTCDay() || 7, gridStart = addCalendarDays(start, 1 - leading), days = Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
  const scheduled = (date: string) => content.entries.filter((entry) => entry.startDate && entry.endDate ? entry.startDate <= date && entry.endDate >= date : entry.startAt && entry.endAt ? zonedParts(entry.startAt, content.timezone).date <= date && zonedParts(Math.max(Date.parse(entry.startAt), Date.parse(entry.endAt) - 1), content.timezone).date >= date : false);
  function shift(delta: number) { const value = new Date(Date.UTC(year!, numericMonth! - 1 + delta, 1)); onMonth(`${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`); }
  return <div className={styles.calendarView}><header><button type="button" aria-label={t.monthPrevious} onClick={() => shift(-1)}><ArrowLeft size={18} /></button><h2>{new Intl.DateTimeFormat(localeTags[locale], { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${start}T00:00:00Z`))}</h2><button type="button" aria-label={t.monthNext} onClick={() => shift(1)}><ArrowRight size={18} /></button><Button onClick={() => onMonth(new Date().toISOString().slice(0, 7))}>{t.today}</Button></header><div className={styles.calendarWeekdays} aria-hidden="true">{[t.mon, t.tue, t.wed, t.thu, t.fri, t.sat, t.sun].map((day) => <span key={day}>{day}</span>)}</div><div className={styles.calendarGrid}>{days.map((date) => { const items = scheduled(date); return <div key={date} className={`${styles.calendarDay} ${date < start || date > end ? styles.outsideMonth : ''}`} onDragOver={(event) => { if (canEdit) event.preventDefault(); }} onDrop={(event) => { if (!canEdit) return; event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (id) onMoveDate(id, date); }}><time dateTime={date}>{Number(date.slice(-2))}</time>{items.slice(0, 4).map((entry) => <button type="button" key={entry.id} draggable={canEdit} className={`${styles.calendarTask} ${assessments.get(entry.id)?.some((item) => item.status === 'conflict') ? styles.calendarConflict : ''}`} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', entry.id); }} onClick={() => onActivate(entry.id)}>{locked.has(entry.id) && <LockKeyhole size={11} aria-hidden="true" />}{entry.title}</button>)}{items.length > 4 && <small>+{items.length - 4} {t.more}</small>}</div>; })}</div></div>;
}

function PlanChecklists({ content, canEdit, copy: t, onActivate, onChange }: { content: OperationalPlanContent; canEdit: boolean; copy: typeof operationsCopies.en; onActivate: (id: string) => void; onChange: (content: OperationalPlanContent) => void }) {
  if (!content.entries.length) return <div className={styles.empty}><CheckSquare2 size={34} /><h2>{t.emptyPlan}</h2><p>{t.emptyPlanDescription}</p></div>;
  return <div className={styles.checklistView}>{content.entries.map((entry) => <section key={entry.id}><header><button type="button" onClick={() => onActivate(entry.id)}><strong>{entry.title}</strong><span>{entry.checklist.filter((item) => item.done).length}/{entry.checklist.length}</span></button></header><ul>{entry.checklist.map((item) => <li key={item.id}><input type="checkbox" checked={item.done} disabled={!canEdit} aria-label={item.text} onChange={(event) => onChange(updateEntry(content, entry.id, { checklist: entry.checklist.map((next) => next.id === item.id ? { ...next, done: event.target.checked } : next) }))} /><input value={item.text} disabled={!canEdit} maxLength={1000} aria-label={t.checklistItem} onChange={(event) => onChange(updateEntry(content, entry.id, { checklist: entry.checklist.map((next) => next.id === item.id ? { ...next, text: event.target.value || next.text } : next) }))} /><button type="button" className={styles.iconAction} disabled={!canEdit} aria-label={t.remove} onClick={() => onChange(updateEntry(content, entry.id, { checklist: entry.checklist.filter((next) => next.id !== item.id) }))}><X size={16} /></button></li>)}</ul><Button icon={Plus} disabled={!canEdit} onClick={() => onChange(updateEntry(content, entry.id, { checklist: [...entry.checklist, { id: crypto.randomUUID(), text: t.checklistItem, done: false }] }))}>{t.addChecklist}</Button></section>)}</div>;
}

function TaskInspector({ entry, content, projectId, canEdit, locked, copy: t, locale, timezone, resources, assessments, accepting, acceptReason, onAccepting, onAcceptReason, onAccept, onLock, onClose, onPatch, onResources }: { entry?: OperationalPlanEntry; content: OperationalPlanContent; projectId: string; canEdit: boolean; locked: boolean; copy: typeof operationsCopies.en; locale: keyof typeof localeTags; timezone: string; resources: Map<string, WorkResource>; assessments: CapacityAssessment[]; accepting?: string; acceptReason: string; onAccepting: (id?: string) => void; onAcceptReason: (value: string) => void; onAccept: (assessment: CapacityAssessment) => void; onLock: () => void; onClose: () => void; onPatch: (patch: Partial<OperationalPlanEntry>, boundary?: 'typing' | 'format') => void; onResources: () => void }) {
  if (!entry) return <aside className={styles.inspector}><div className={styles.inspectorEmpty}><CircleHelp size={28} /><p>{t.inspect}</p></div></aside>;
  const mode = entry.startDate ? 'allDay' : entry.startAt ? 'timed' : 'unscheduled', assignments = canonicalAssignments(entry);
  function changeMode(value: string) {
    if (value === 'allDay') { const date = zonedParts(Date.now(), timezone).date; onPatch({ startDate: date, endDate: date, startAt: undefined, endAt: undefined, capacityOverride: undefined }); }
    else if (value === 'timed') { const now = new Date(), start = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000); onPatch({ startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), startDate: undefined, endDate: undefined, capacityOverride: undefined }); }
    else onPatch({ startDate: undefined, endDate: undefined, startAt: undefined, endAt: undefined, capacityOverride: undefined });
  }
  return <aside className={styles.inspector}><header><h2>{t.inspect}</h2><div className={styles.inspectorHeaderActions}><button type="button" className={styles.iconAction} disabled={!canEdit} aria-label={locked ? t.unlockTask : t.lockTask} title={locked ? t.unlockTask : t.lockTask} onClick={onLock}>{locked ? <UnlockKeyhole size={18} /> : <LockKeyhole size={18} />}</button><button type="button" className={styles.iconAction} aria-label={t.close} onClick={onClose}><X size={18} /></button></div></header><div className={styles.inspectorScroll}>
    <label>{t.taskTitle}<input value={entry.title} maxLength={1000} disabled={!canEdit} onChange={(event) => onPatch({ title: event.target.value || entry.title }, 'typing')} /></label>
    <label>{t.description}<textarea value={entry.description ?? ''} maxLength={12000} disabled={!canEdit} onChange={(event) => onPatch({ description: event.target.value || undefined }, 'typing')} /></label>
    <div className={styles.formRow}><label>{t.status}<select value={entry.status} disabled={!canEdit} onChange={(event) => onPatch({ status: event.target.value as OperationalPlanEntry['status'] })}>{Object.entries(statusKeys).map(([value, key]) => <option key={value} value={value}>{t[key]}</option>)}</select></label><label>{t.schedule}<select value={mode} disabled={!canEdit} onChange={(event) => changeMode(event.target.value)}><option value="unscheduled">{t.unscheduled}</option><option value="allDay">{t.allDay}</option><option value="timed">{t.timed}</option></select></label></div>
    {mode === 'allDay' && <div className={styles.formRow}><label>{t.start}<input type="date" value={entry.startDate} disabled={!canEdit} onChange={(event) => event.target.value && onPatch(allDayStartPatch(entry, event.target.value))} /></label><label>{t.end}<input type="date" min={entry.startDate} value={entry.endDate} disabled={!canEdit} onChange={(event) => event.target.value && onPatch(allDayEndPatch(entry, event.target.value))} /></label></div>}
    {mode === 'timed' && <div className={styles.formRow}><label>{t.start}<input type="datetime-local" value={instantInput(entry.startAt!, timezone)} disabled={!canEdit} onChange={(event) => event.target.value && onPatch(timedStartPatch(entry, inputInstant(event.target.value, timezone, 'start')))} /></label><label>{t.end}<input type="datetime-local" min={instantInput(entry.startAt!, timezone)} value={instantInput(entry.endAt!, timezone)} disabled={!canEdit} onChange={(event) => event.target.value && onPatch(timedEndPatch(entry, inputInstant(event.target.value, timezone, 'end')))} /></label></div>}
    <div className={styles.formRow}><label>{t.durationMinutes}<input type="number" min="0" max="10000000" value={entry.durationMinutes ?? ''} disabled={!canEdit} onChange={(event) => onPatch({ durationMinutes: event.target.value === '' ? undefined : Number(event.target.value), capacityOverride: undefined })} /></label><label>{t.effortValue}<input type="number" min="0" step="0.25" value={entry.effort?.decimal ?? ''} disabled={!canEdit || assignments.length > 1} onChange={(event) => onPatch({ effort: event.target.value === '' ? undefined : { decimal: event.target.value, unit: entry.effort?.unit ?? 'person-hours' }, capacityOverride: undefined })} /></label></div>
    <div className={styles.formRow}><label>{t.effortUnit}<select value={entry.effort?.unit ?? 'person-hours'} disabled={!canEdit || !entry.effort || assignments.length > 1} onChange={(event) => entry.effort && onPatch({ effort: { ...entry.effort, unit: event.target.value }, capacityOverride: undefined })}><option value="person-hours">{t.hours}</option><option value="person-minutes">{t.minutes}</option></select></label><QuantityFields key={`${entry.id}:${entry.quantity?.decimal ?? ''}:${entry.quantity?.unit ?? ''}`} entry={entry} canEdit={canEdit} copy={t} onPatch={onPatch} /></div>
    <label>{t.dependencies}<select multiple value={entry.dependencies} disabled={!canEdit} onChange={(event) => onPatch({ dependencies: [...event.currentTarget.selectedOptions].map((option) => option.value) })}>{content.entries.filter((item) => item.id !== entry.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <section className={styles.assignments}><div className={styles.sectionHeading}><h3>{t.assignees}</h3><Button icon={UsersRound} disabled={!canEdit} onClick={onResources}>{t.resources}</Button></div>{!assignments.length && <p className={styles.muted}>{t.noAssignments}</p>}{assignments.map((assignment) => <div key={assignment.resourceId} className={styles.assignment}><strong>{resources.get(assignment.resourceId)?.displayName ?? t.availabilityUnknown}</strong><label>{t.effortValue}<input type="number" min="0" step="0.25" value={assignment.effort?.decimal ?? ''} disabled={!canEdit} onChange={(event) => onPatch({ assignments: assignments.map((item) => item.resourceId === assignment.resourceId ? { ...item, effort: event.target.value ? { decimal: event.target.value, unit: item.effort?.unit ?? 'person-hours' } : undefined } : item), capacityOverride: undefined })} /></label><label>{t.effortUnit}<select value={assignment.effort?.unit ?? 'person-hours'} disabled={!canEdit || !assignment.effort} onChange={(event) => onPatch({ assignments: assignments.map((item) => item.resourceId === assignment.resourceId && item.effort ? { ...item, effort: { ...item.effort, unit: event.target.value } } : item), capacityOverride: undefined })}><option value="person-hours">{t.hours}</option><option value="person-minutes">{t.minutes}</option></select></label></div>)}</section>
    <label>{t.notes}<textarea value={entry.notes ?? ''} maxLength={12000} disabled={!canEdit} onChange={(event) => onPatch({ notes: event.target.value || undefined }, 'typing')} /></label>
    <CapacityPanel entry={entry} assessments={assessments} copy={t} locale={locale} accepting={accepting} acceptReason={acceptReason} disabled={!canEdit} onAccepting={onAccepting} onAcceptReason={onAcceptReason} onAccept={onAccept} />
    {(entry.linkedArtifactIds?.length ?? 0) > 0 && <section><h3>{t.linkedMaterials}</h3><ul className={styles.links}>{entry.linkedArtifactIds!.map((id) => <li key={id}><Link href={`/app/projects/${projectId}/artifacts/${id}`}>{t.openMaterial}</Link></li>)}</ul></section>}
  </div></aside>;
}

function CapacityPanel({ entry, assessments, copy: t, locale, accepting, acceptReason, disabled, onAccepting, onAcceptReason, onAccept }: { entry: OperationalPlanEntry; assessments: CapacityAssessment[]; copy: typeof operationsCopies.en; locale: keyof typeof localeTags; accepting?: string; acceptReason: string; disabled: boolean; onAccepting: (id?: string) => void; onAcceptReason: (value: string) => void; onAccept: (assessment: CapacityAssessment) => void }) {
  if (!assessments.length) return <div className={styles.capacityUnknown}><CircleHelp size={18} /><span>{entry.resourceIds.length ? t.unknownCapacity : t.noAssignments}</span></div>;
  return <section className={styles.capacity}><h3>{t.availability}</h3>{assessments.map((assessment, index) => { const key = `${assessment.resourceId}:${index}`, accepted = entry.capacityOverride?.assessmentKey === capacityAssessmentKey(assessment); return <div key={key} className={assessment.status === 'conflict' ? styles.capacityConflict : assessment.status === 'availability-unknown' ? styles.capacityUnknown : styles.capacityOkay}>
    {assessment.status === 'conflict' ? <AlertTriangle size={18} /> : assessment.status === 'availability-unknown' ? <CircleHelp size={18} /> : <CheckSquare2 size={18} />}<div><strong>{accepted ? t.accepted : assessment.status === 'conflict' ? t.conflict : assessment.status === 'availability-unknown' ? t.unknownCapacity : t.withinCapacity}</strong>{assessment.reasons.length > 0 && <ul>{assessment.reasons.map((reason) => <li key={reason}>{t[reasonKeys[reason]]}</li>)}</ul>}{assessment.demandedMinutes !== undefined && <p>{t.demanded}: {formatMinutes(assessment.demandedMinutes, t, locale)} · {t.capacity}: {assessment.availableMinutes === undefined ? '—' : formatMinutes(assessment.availableMinutes, t, locale)}</p>}{assessment.status === 'conflict' && !accepted && <>{accepting === key ? <div className={styles.acceptance}><textarea value={acceptReason} maxLength={1000} placeholder={t.acceptanceReason} aria-label={t.acceptanceReason} onChange={(event) => onAcceptReason(event.target.value)} /><Button disabled={!acceptReason.trim() || disabled} onClick={() => onAccept(assessment)}>{t.apply}</Button><Button onClick={() => onAccepting(undefined)}>{t.cancel}</Button></div> : <Button disabled={disabled} onClick={() => onAccepting(key)}>{t.acceptConflict}</Button>}</>}</div>
  </div>; })}</section>;
}

function QuantityFields({ entry, canEdit, copy: t, onPatch }: { entry: OperationalPlanEntry; canEdit: boolean; copy: typeof operationsCopies.en; onPatch: (patch: Partial<OperationalPlanEntry>, boundary?: 'typing' | 'format') => void }) {
  const decimal = useRef<HTMLInputElement>(null), unit = useRef<HTMLInputElement>(null);
  function publish(nextDecimal: string, nextUnit: string) {
    if (!nextDecimal) onPatch({ quantity: undefined, capacityOverride: undefined }, 'typing');
    else if (nextUnit.trim()) onPatch({ quantity: { decimal: nextDecimal, unit: nextUnit.trim() }, capacityOverride: undefined }, 'typing');
  }
  return <label>{t.quantity}<span className={styles.compoundInput}><input ref={decimal} type="number" min="0" step="any" defaultValue={entry.quantity?.decimal ?? ''} disabled={!canEdit} aria-label={t.quantity} onChange={(event) => publish(event.target.value, unit.current?.value ?? '')} /><input ref={unit} defaultValue={entry.quantity?.unit ?? ''} maxLength={40} aria-label={t.quantityUnit} placeholder={t.quantityUnit} disabled={!canEdit} onChange={(event) => publish(decimal.current?.value ?? '', event.target.value)} /></span></label>;
}

function instantInput(instant: string, timezone: string) { const value = zonedParts(instant, timezone); return `${value.date}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`; }
function inputInstant(value: string, timezone: string, edge: 'start' | 'end') { const [date, time] = value.split('T'), [hour, minute] = time!.split(':').map(Number); return new Date(localDateMinuteToInstant(date!, hour! * 60 + minute!, timezone, edge)).toISOString(); }
function allDayStartPatch(entry: OperationalPlanEntry, startDate: string): Partial<OperationalPlanEntry> {
  const span = entry.startDate && entry.endDate ? Math.max(0, Math.round((Date.parse(`${entry.endDate}T00:00:00Z`) - Date.parse(`${entry.startDate}T00:00:00Z`)) / 86_400_000)) : 0;
  return { startDate, endDate: addCalendarDays(startDate, span), capacityOverride: undefined };
}
function allDayEndPatch(entry: OperationalPlanEntry, requested: string): Partial<OperationalPlanEntry> {
  return { endDate: entry.startDate && requested < entry.startDate ? entry.startDate : requested, capacityOverride: undefined };
}
function timedStartPatch(entry: OperationalPlanEntry, startAt: string): Partial<OperationalPlanEntry> {
  const previousStart = entry.startAt ? Date.parse(entry.startAt) : NaN, previousEnd = entry.endAt ? Date.parse(entry.endAt) : NaN;
  const duration = Number.isFinite(previousStart) && Number.isFinite(previousEnd) && previousEnd > previousStart ? previousEnd - previousStart : 3_600_000;
  return { startAt, endAt: new Date(Date.parse(startAt) + duration).toISOString(), capacityOverride: undefined };
}
function timedEndPatch(entry: OperationalPlanEntry, requested: string): Partial<OperationalPlanEntry> {
  const start = Date.parse(entry.startAt ?? ''), end = Date.parse(requested);
  return { endAt: new Date(Number.isFinite(start) && end <= start ? start + 60_000 : end).toISOString(), capacityOverride: undefined };
}
function formatMinutes(minutes: number, t: typeof operationsCopies.en, locale: keyof typeof localeTags) { return minutes >= 60 ? `${(minutes / 60).toLocaleString(localeTags[locale], { maximumFractionDigits: 2 })} ${t.hours}` : `${minutes.toLocaleString(localeTags[locale], { maximumFractionDigits: 0 })} ${t.minutes}`; }
function activeEntry(entry: OperationalPlanEntry) { return entry.status === 'todo' || entry.status === 'in-progress'; }
function formatCandidate(entry: OperationalPlanEntry, timezone: string) {
  if (entry.startAt && entry.endAt) {
    const start = zonedParts(entry.startAt, timezone), end = zonedParts(entry.endAt, timezone);
    return `${start.date} ${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}–${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}`;
  }
  if (entry.startDate && entry.endDate) return entry.startDate === entry.endDate ? entry.startDate : `${entry.startDate}–${entry.endDate}`;
  return '—';
}
function constraintLabel(code: PlanConstraintCode, t: typeof operationsCopies.en) {
  if (['duration-missing', 'effort-missing', 'effort-unit-unknown'].includes(code)) return t.constraintWorkMissing;
  if (['assignment-missing', 'resource-missing', 'resource-archived', 'resource-capability-missing', 'resource-revision-changed', 'availability-missing'].includes(code)) return t.constraintResource;
  if (['material-after-window', 'material-date-unknown'].includes(code)) return t.constraintMaterial;
  if (['dependency-unresolved', 'dependency-order'].includes(code)) return t.constraintDependency;
  if (code === 'locked-assignment-invalid') return t.constraintLock;
  if (code === 'cost-unknown') return t.constraintCost;
  if (code === 'search-exhausted') return t.constraintSearch;
  return t.constraintWindow;
}

