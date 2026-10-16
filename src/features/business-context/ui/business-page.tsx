'use client';

import Link from 'next/link';
import { Archive, Building2, CheckCircle2, CirclePause, History, Pencil, Play, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatDecimal, formatInstant, formatMoney, type Locale } from '@/i18n';
import { useLocale } from '@/i18n/provider';
import type { BusinessContextItem } from '@/contracts/business-work';
import { Button, CheckboxField, Dialog, DialogClose, EmptyState, InputField, LoadingState, SelectField, TextareaField } from '@/ui';
import { workspaceClient } from '@/features/workspace/client/transport';
import type { Project } from '@/features/workspace/contracts';
import { WorkspaceAccessState, WorkspaceShell, useWorkspaceAccess } from '@/features/workspace/ui/shell';
import { businessContextClient, BusinessContextRequestError } from '../client/transport';
import type { BusinessContextDetail, BusinessContextSummary } from '../contracts';
import { businessCopy } from '../locales';
import { recurringWorkClient, RecurringWorkRequestError } from '../../recurring-work/client/transport';
import type { OutcomeObservation, WorkOccurrence, WorkRuleDetail, WorkRuleSummary } from '../../recurring-work/contracts';
import styles from './business-page.module.css';

type FactCategory = BusinessContextItem['category'];
type FactDraft = { id: string; category: FactCategory; label: string; value: string; confirmed: boolean };
type ContextDraft = { context?: BusinessContextDetail; title: string; reason: string; facts: FactDraft[]; colors: string; fonts: string; voice: string };
type RuleDraft = { detail?: WorkRuleDetail; title: string; goal: string; reason: string; maximumUsd: string; contextIds: string[] };
type OutcomeDraft = { occurrenceId: string; label: string; metricKey: string; periodStart: string; periodEnd: string; value: string; evidence: string; note: string };

const emptyFact = (): FactDraft => ({ id: crypto.randomUUID(), category: 'profile', label: '', value: '', confirmed: false });
const emptyContext = (): ContextDraft => ({ title: '', reason: '', facts: [emptyFact()], colors: '', fonts: '', voice: '' });
const emptyRule = (): RuleDraft => ({ title: '', goal: '', reason: '', maximumUsd: '1.00', contextIds: [] });
const today = () => new Date().toISOString().slice(0, 10);
const emptyOutcome = (): OutcomeDraft => ({ occurrenceId: '', label: '', metricKey: '', periodStart: today(), periodEnd: today(), value: '', evidence: '', note: '' });
const lines = (value: string) => [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
const contextDraft = (detail: BusinessContextDetail): ContextDraft => ({
  context: detail, title: detail.version.title, reason: '',
  facts: detail.version.items.map((item) => ({ id: item.id, category: item.category, label: item.label, value: item.value.kind === 'text' ? item.value.value : JSON.stringify(item.value), confirmed: item.confirmed })),
  colors: detail.version.brandKit.colors.join('\n'), fonts: detail.version.brandKit.fontFamilies.join('\n'), voice: detail.version.brandKit.voiceRules.join('\n'),
});
const categoryKeys: FactCategory[] = ['profile', 'customer', 'supplier', 'contact', 'assumption', 'rule'];
const terminal = new Set<WorkOccurrence['state']>(['completed', 'failed', 'cancelled']);

function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const { locale } = useLocale(), t = businessCopy(locale);
  if (!error || error instanceof DOMException && error.name === 'AbortError') return null;
  const status = error instanceof BusinessContextRequestError || error instanceof RecurringWorkRequestError ? error.status : 0;
  return <div className={styles.error} role="alert"><p>{status === 409 ? t.conflict : status === 422 ? t.invalid : t.error}</p>{retry && <Button icon={RefreshCw} onClick={retry}>{t.retry}</Button>}</div>;
}

function valueText(locale: Locale, value: OutcomeObservation['value']) {
  if (value.kind === 'money') return formatMoney(locale, value.value);
  if (value.kind === 'quantity') return `${formatDecimal(locale, value.value.decimal)} ${value.value.unit}`;
  return String(value.value);
}

export function BusinessPage({ ownerId, initialWorkspaceId }: { ownerId: string; initialWorkspaceId?: string }) {
  const { locale } = useLocale(), t = businessCopy(locale), access = useWorkspaceAccess(ownerId), { run } = access;
  const memberships = access.account.viewer?.user.id === ownerId ? access.account.viewer.workspaces : [];
  const [workspaceChoice, setWorkspaceChoice] = useState(initialWorkspaceId ?? '');
  const workspaceId = memberships.some((item) => item.workspaceId === workspaceChoice) ? workspaceChoice : memberships[0]?.workspaceId ?? '';
  const membership = memberships.find((item) => item.workspaceId === workspaceId);
  const [projects, setProjects] = useState<Project[]>([]), [projectChoice, setProjectChoice] = useState('');
  const projectId = projects.some((item) => item.id === projectChoice) ? projectChoice : projects[0]?.id ?? '';
  const [contexts, setContexts] = useState<BusinessContextSummary[]>([]), [contextAuthz, setContextAuthz] = useState(0);
  const [rules, setRules] = useState<WorkRuleSummary[]>([]), [ruleAuthz, setRuleAuthz] = useState(0);
  const [outcomes, setOutcomes] = useState<OutcomeObservation[]>([]), [outcomeAuthz, setOutcomeAuthz] = useState(0);
  const [occurrences, setOccurrences] = useState<WorkOccurrence[]>([]), [occurrenceRuleId, setOccurrenceRuleId] = useState(''), [selectedRuleId, setSelectedRuleId] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState<unknown>(), [refresh, setRefresh] = useState(0);
  const [contextEditor, setContextEditor] = useState<ContextDraft>(), [ruleEditor, setRuleEditor] = useState<RuleDraft>(), [outcomeEditor, setOutcomeEditor] = useState<OutcomeDraft>();
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [runtimeNotice, setRuntimeNotice] = useState(false);
  const currentRule = rules.find((item) => item.id === selectedRuleId) ?? rules[0];
  const currentRuleId = currentRule?.id ?? '';
  const visibleOccurrences = occurrenceRuleId === currentRuleId ? occurrences : [];
  const authzVersion = outcomeAuthz || ruleAuthz || contextAuthz || membership?.authzVersion || 0;

  useEffect(() => {
    if (access.phase !== 'active' || !workspaceId) return;
    const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(undefined); } });
    void run((signal) => workspaceClient.list({ workspaceId, status: 'active', order: 'recent', query: '', limit: 50 }, { userId: ownerId, signal }), controller.signal)
      .then((result) => setProjects(result.projects)).catch((failure) => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [access.phase, workspaceId, ownerId, run, refresh]);

  useEffect(() => {
    if (access.phase !== 'active' || !workspaceId) return;
    const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(undefined); } });
    const activeContexts = run((signal) => businessContextClient.list({ workspaceId, ...(projectId ? { projectId } : {}), status: 'active', query: '', limit: 100 }, { userId: ownerId, signal }), controller.signal, false);
    const archivedContexts = run((signal) => businessContextClient.list({ workspaceId, ...(projectId ? { projectId } : {}), status: 'archived', query: '', limit: 100 }, { userId: ownerId, signal }), controller.signal, false);
    const contextRequest = Promise.all([activeContexts, archivedContexts]).then(([active, archived]) => ({ contexts: [...active.contexts, ...archived.contexts], authzVersion: active.authzVersion }));
    const ruleRequest = projectId ? run((signal) => recurringWorkClient.listRules({ workspaceId, projectId, limit: 100 }, { userId: ownerId, signal }), controller.signal, false) : Promise.resolve({ rules: [], authzVersion: membership?.authzVersion ?? 0 });
    const outcomeRequest = projectId ? run((signal) => recurringWorkClient.listOutcomes({ workspaceId, projectId, limit: 100 }, { userId: ownerId, signal }), controller.signal, false) : Promise.resolve({ outcomes: [], authzVersion: membership?.authzVersion ?? 0 });
    void Promise.all([contextRequest, ruleRequest, outcomeRequest]).then(([contextPage, rulePage, outcomePage]) => {
      setContexts(contextPage.contexts); setContextAuthz(contextPage.authzVersion); setRules(rulePage.rules); setRuleAuthz(rulePage.authzVersion); setOutcomes(outcomePage.outcomes); setOutcomeAuthz(outcomePage.authzVersion);
      setSelectedRuleId((current) => rulePage.rules.some((item) => item.id === current) ? current : rulePage.rules[0]?.id ?? '');
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [access.phase, workspaceId, projectId, membership?.authzVersion, ownerId, run, refresh]);

  useEffect(() => {
    if (access.phase !== 'active' || !workspaceId || !currentRuleId) return;
    const controller = new AbortController();
    void run((signal) => recurringWorkClient.occurrences(currentRuleId, { workspaceId, limit: 100 }, { userId: ownerId, signal }), controller.signal, false)
      .then((page) => { setOccurrences(page.occurrences); setOccurrenceRuleId(currentRuleId); }).catch((failure) => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [access.phase, workspaceId, currentRuleId, ownerId, run, refresh]);

  const editableContext = useMemo(() => contextEditor?.context?.context.permissions.edit ?? true, [contextEditor]);

  async function openContext(item: BusinessContextSummary) {
    setError(undefined); setSaving(true);
    try { setContextEditor(contextDraft(await run((signal) => businessContextClient.read(item.id, { workspaceId, revision: item.currentRevision }, { userId: ownerId, signal }), undefined, false))); }
    catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function saveContext(event: FormEvent) {
    event.preventDefault(); if (!contextEditor || !membership) return;
    setSaving(true); setSaved(false); setError(undefined);
    try {
      const items = contextEditor.facts.filter((item) => item.label.trim() && item.value.trim()).map((item) => ({ id: item.id, category: item.category, label: item.label.trim(), value: { kind: 'text' as const, value: item.value.trim() }, sourceRefs: [], confirmed: item.confirmed, ownerId }));
      const snapshot = { title: contextEditor.title.trim(), items, brandKit: { assetRefs: [], colors: lines(contextEditor.colors), fontFamilies: lines(contextEditor.fonts), voiceRules: lines(contextEditor.voice) }, reason: contextEditor.reason.trim() };
      const result = contextEditor.context
        ? await run((signal) => businessContextClient.update(contextEditor.context!.context.id, { workspaceId, expectedAuthzVersion: contextEditor.context!.authzVersion, expectedRevision: contextEditor.context!.context.currentRevision, ...snapshot }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false)
        : await run((signal) => businessContextClient.create({ workspaceId, scope: projectId ? 'project' : 'workspace', projectId: projectId || null, expectedAuthzVersion: contextAuthz || membership.authzVersion, ...snapshot }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false);
      setContextEditor(contextDraft(result)); setSaved(true); setRefresh((value) => value + 1);
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function setContextStatus(item: BusinessContextSummary, status: 'active' | 'archived') {
    setSaving(true); setError(undefined);
    try { await run((signal) => businessContextClient.status(item.id, { workspaceId, expectedAuthzVersion: contextAuthz || membership?.authzVersion, expectedRevision: item.currentRevision, status }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false); setRefresh((value) => value + 1); }
    catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function openRule(item: WorkRuleSummary) {
    setSaving(true); setError(undefined);
    try {
      const detail = await run((signal) => recurringWorkClient.readRule(item.id, { workspaceId, version: item.currentVersion }, { userId: ownerId, signal }), undefined, false);
      setRuleEditor({ detail, title: detail.rule.title, goal: detail.version.definition.goal, reason: '', maximumUsd: detail.version.definition.budget.maximumUsd, contextIds: detail.version.definition.contextRefs.map((ref) => ref.contextId) });
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault(); if (!ruleEditor || !projectId || !membership) return;
    setSaving(true); setSaved(false); setError(undefined);
    try {
      const selectedContexts = await Promise.all(ruleEditor.contextIds.map((id) => run((signal) => businessContextClient.read(id, { workspaceId }, { userId: ownerId, signal }), undefined, false)));
      const definition = {
        goal: ruleEditor.goal.trim(), sourceSelectors: [],
        contextRefs: selectedContexts.map((item) => ({ contextId: item.context.id, revision: item.version.revision, itemIds: item.version.items.map((fact) => fact.id) })),
        capability: { id: 'business.goal', version: 1 }, procedureVersion: 1, trigger: { kind: 'manual' as const },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Almaty',
        outputPolicy: { mode: 'new-branch' as const, baseArtifact: null, reviewRequired: true as const, externalEffects: 'forbidden' as const },
        budget: { maximumUsd: ruleEditor.maximumUsd.trim(), maxOccurrencesPerDay: 4 },
      };
      const result = ruleEditor.detail
        ? await run((signal) => recurringWorkClient.updateRule(ruleEditor.detail!.rule.id, { workspaceId, expectedAuthzVersion: ruleEditor.detail!.authzVersion, expectedVersion: ruleEditor.detail!.rule.currentVersion, title: ruleEditor.title.trim(), definition, reason: ruleEditor.reason.trim() }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false)
        : await run((signal) => recurringWorkClient.createRule({ workspaceId, projectId, expectedAuthzVersion: ruleAuthz || membership.authzVersion, title: ruleEditor.title.trim(), state: 'paused', definition, reason: ruleEditor.reason.trim() }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false);
      setRuleEditor({ ...ruleEditor, detail: result, reason: '' }); setSaved(true); setRefresh((value) => value + 1);
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function setRuleState(item: WorkRuleSummary, state: 'enabled' | 'paused') {
    setSaving(true); setError(undefined);
    try { await run((signal) => recurringWorkClient.setRuleState(item.id, { workspaceId, expectedAuthzVersion: ruleAuthz || membership?.authzVersion, expectedVersion: item.currentVersion, state }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false); setRefresh((value) => value + 1); }
    catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function startRule(item: WorkRuleSummary) {
    setSaving(true); setError(undefined); setRuntimeNotice(false);
    try {
      const result = await run((signal) => recurringWorkClient.start(item.id, { ruleId: item.id, ruleVersion: item.currentVersion, occurrenceId: crypto.randomUUID(), trigger: { kind: 'manual', at: new Date().toISOString(), sourceRefs: [] } }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false);
      setRuntimeNotice(result.reasonCode === 'runtime_bridge_unavailable'); setSelectedRuleId(item.id); setRefresh((value) => value + 1);
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function mutateOccurrence(item: WorkOccurrence, action: 'cancel' | 'restart') {
    setSaving(true); setError(undefined);
    try {
      if (action === 'cancel') await run((signal) => recurringWorkClient.cancel(item.id, { workspaceId, expectedAuthzVersion: authzVersion }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false);
      else await run((signal) => recurringWorkClient.restart(item.id, { workspaceId, expectedAuthzVersion: authzVersion }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false);
      setRefresh((value) => value + 1);
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  async function saveOutcome(event: FormEvent) {
    event.preventDefault(); if (!outcomeEditor || !projectId) return;
    setSaving(true); setSaved(false); setError(undefined);
    try {
      await run((signal) => recurringWorkClient.createOutcome({ workspaceId, projectId, occurrenceId: outcomeEditor.occurrenceId || null, runId: null, artifactId: null, artifactRevision: null, periodStart: outcomeEditor.periodStart, periodEnd: outcomeEditor.periodEnd, metricKey: outcomeEditor.metricKey.trim(), label: outcomeEditor.label.trim(), value: { kind: 'text', value: outcomeEditor.value.trim() }, evidence: { kind: 'manual', sourceRefs: [], note: outcomeEditor.evidence.trim() }, note: outcomeEditor.note.trim(), expectedAuthzVersion: outcomeAuthz || authzVersion }, crypto.randomUUID(), { userId: ownerId, signal }), undefined, false);
      setOutcomeEditor(undefined); setSaved(true); setRefresh((value) => value + 1);
    } catch (failure) { setError(failure); } finally { setSaving(false); }
  }

  if (access.phase !== 'active') return <WorkspaceShell><WorkspaceAccessState access={access} returnTo="/app/business" /></WorkspaceShell>;
  return <WorkspaceShell workspaceId={workspaceId}><main className={styles.main}>
    <header className={styles.heading}><div><h1>{t.title}</h1><p>{t.intro}</p></div><Building2 size={38} aria-hidden="true" /></header>
    <div className={styles.selectors}>
      {memberships.length > 1 && <SelectField label={t.workspace} value={workspaceId} onChange={(event) => { setWorkspaceChoice(event.target.value); setProjectChoice(''); }} disabled={saving}>{memberships.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</SelectField>}
      <SelectField label={t.project} value={projectId} onChange={(event) => setProjectChoice(event.target.value)} disabled={saving || !projects.length}><option value="">{projects.length ? t.selectProject : t.noProjects}</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField>
    </div>
    <ErrorNotice error={error} retry={() => setRefresh((value) => value + 1)} />
    {runtimeNotice && <p className={styles.notice} role="status">{t.runtimeUnavailable}</p>}
    {saved && <p className={styles.saved} role="status">{t.saved}</p>}
    {loading && !contexts.length && !rules.length ? <LoadingState label={t.loading} /> : <div className={styles.columns}>
      <section className={styles.primary} aria-labelledby="business-context-title">
        <div className={styles.sectionHeading}><div><h2 id="business-context-title">{t.contexts}</h2><p>{t.contextsHint}</p></div><Button variant="primary" icon={Plus} onClick={() => { setContextEditor(emptyContext()); setSaved(false); }}>{t.addContext}</Button></div>
        {contexts.length ? <ul className={styles.contextList}>{contexts.map((item) => <li key={item.id}><div className={styles.itemHead}><div><h3>{item.title}</h3><p>{item.scope === 'workspace' ? t.scopeWorkspace : t.scopeProject} · {t.revision} {item.currentRevision}</p></div><span className={styles.status} data-state={item.status}>{item.status === 'active' ? t.enabled : t.disabled}</span></div><div className={styles.actions}>{item.permissions.edit && <Button icon={Pencil} onClick={() => { void openContext(item); }}>{t.editContext}</Button>}{item.permissions.archive && <Button icon={item.status === 'active' ? Archive : RotateCcw} onClick={() => { void setContextStatus(item, item.status === 'active' ? 'archived' : 'active'); }}>{item.status === 'active' ? t.archive : t.restore}</Button>}</div></li>)}</ul> : <EmptyState title={t.emptyContexts} action={<Button icon={Plus} onClick={() => setContextEditor(emptyContext())}>{t.addContext}</Button>} />}
      </section>
      <aside className={styles.secondary}>
        <section aria-labelledby="rules-title"><div className={styles.sectionHeading}><div><h2 id="rules-title">{t.rules}</h2><p>{t.rulesHint}</p></div>{projectId && <Button icon={Plus} onClick={() => { setRuleEditor(emptyRule()); setSaved(false); }}>{t.addRule}</Button>}</div>
          {!projectId ? <p className={styles.muted}>{t.selectProject}</p> : rules.length ? <ul className={styles.ruleList}>{rules.map((item) => <li key={item.id} data-selected={currentRule?.id === item.id}><button className={styles.ruleSelect} type="button" onClick={() => setSelectedRuleId(item.id)}><span><strong>{item.title}</strong><small>{t.revision} {item.currentVersion}</small></span><span className={styles.status} data-state={item.state}>{t[item.state]}</span></button><div className={styles.actions}>{item.permissions.edit && <Button icon={Pencil} variant="quiet" onClick={() => { void openRule(item); }}>{t.editContext}</Button>}{item.permissions.enable && <Button icon={item.state === 'enabled' ? CirclePause : CheckCircle2} variant="quiet" onClick={() => { void setRuleState(item, item.state === 'enabled' ? 'paused' : 'enabled'); }}>{item.state === 'enabled' ? t.pause : t.enable}</Button>}{item.permissions.run && <Button icon={Play} variant="primary" onClick={() => { void startRule(item); }}>{t.run}</Button>}</div></li>)}</ul> : <p className={styles.muted}>{t.noRules}</p>}
        </section>
        {currentRule && <section aria-labelledby="occurrences-title"><div className={styles.subheading}><h3 id="occurrences-title">{t.occurrences}</h3></div>{visibleOccurrences.length ? <ol className={styles.timeline}>{visibleOccurrences.map((item) => <li key={item.id}><History size={18} aria-hidden="true" /><div><strong>{t.status}: {item.state}</strong><time dateTime={item.createdAt}>{formatInstant(locale, item.createdAt)}</time>{item.reasonCode && <small>{t.reasonCode}: {item.reasonCode}</small>}<div className={styles.actions}>{item.runId && <Link href={`/app/projects/${item.projectId}?run=${item.runId}`}>{t.openRun}</Link>}{!terminal.has(item.state) && <Button variant="quiet" onClick={() => { void mutateOccurrence(item, 'cancel'); }}>{t.cancelRun}</Button>}{terminal.has(item.state) && item.state !== 'completed' && <Button variant="quiet" icon={RotateCcw} onClick={() => { void mutateOccurrence(item, 'restart'); }}>{t.restartRun}</Button>}</div></div></li>)}</ol> : <p className={styles.muted}>{t.noOccurrences}</p>}</section>}
      </aside>
    </div>}
    {projectId && <section className={styles.outcomes} aria-labelledby="outcomes-title"><div className={styles.sectionHeading}><div><h2 id="outcomes-title">{t.outcomes}</h2><p>{t.outcomesHint}</p></div><Button icon={Plus} onClick={() => setOutcomeEditor(emptyOutcome())} disabled={!visibleOccurrences.length}>{t.addOutcome}</Button></div>{outcomes.length ? <div className={styles.outcomeTable} role="table"><div className={styles.outcomeHeader} role="row"><span role="columnheader">{t.metric}</span><span role="columnheader">{t.period}</span><span role="columnheader">{t.resultValue}</span></div>{outcomes.map((item) => <div className={styles.outcomeRow} role="row" key={item.id}><strong role="cell">{item.label}</strong><span role="cell">{item.periodStart} — {item.periodEnd}</span><span role="cell">{valueText(locale, item.value)}</span>{item.evidence.note && <small>{item.evidence.note}</small>}</div>)}</div> : <p className={styles.muted}>{t.noOutcomes}</p>}</section>}

    <Dialog open={Boolean(contextEditor)} onOpenChange={(open) => { if (!open && !saving) setContextEditor(undefined); }} title={contextEditor?.context ? t.editContext : t.addContext} dismissible={!saving} dirty={Boolean(contextEditor?.title || contextEditor?.reason)} onDiscard={() => setContextEditor(undefined)} footer={<><DialogClose disabled={saving}>{t.cancel}</DialogClose><Button type="submit" form="business-context-form" variant="primary" pending={saving} pendingLabel={t.saving}>{t.save}</Button></>}>
      {contextEditor && <form id="business-context-form" className={styles.form} onSubmit={saveContext}><InputField label={t.titleField} required maxLength={240} value={contextEditor.title} disabled={!editableContext || saving} onChange={(event) => setContextEditor({ ...contextEditor, title: event.target.value })} /><InputField label={t.reason} required maxLength={1000} value={contextEditor.reason} disabled={!editableContext || saving} onChange={(event) => setContextEditor({ ...contextEditor, reason: event.target.value })} />
        <div className={styles.factList}>{contextEditor.facts.map((fact, index) => <fieldset key={fact.id} className={styles.fact}><legend>{t.category} {index + 1}</legend><SelectField label={t.category} value={fact.category} disabled={saving} onChange={(event) => setContextEditor({ ...contextEditor, facts: contextEditor.facts.map((item) => item.id === fact.id ? { ...item, category: event.target.value as FactCategory } : item) })}>{categoryKeys.map((category) => <option key={category} value={category}>{t[category]}</option>)}</SelectField><InputField label={t.label} required maxLength={240} value={fact.label} disabled={saving} onChange={(event) => setContextEditor({ ...contextEditor, facts: contextEditor.facts.map((item) => item.id === fact.id ? { ...item, label: event.target.value } : item) })} /><TextareaField label={t.value} required maxLength={4000} value={fact.value} disabled={saving} onChange={(event) => setContextEditor({ ...contextEditor, facts: contextEditor.facts.map((item) => item.id === fact.id ? { ...item, value: event.target.value } : item) })} /><div className={styles.factActions}><CheckboxField label={t.confirmed} checked={fact.confirmed} disabled={saving || Boolean(contextEditor.context && !contextEditor.context.context.permissions.confirm)} onChange={(event) => setContextEditor({ ...contextEditor, facts: contextEditor.facts.map((item) => item.id === fact.id ? { ...item, confirmed: event.target.checked } : item) })} />{contextEditor.facts.length > 1 && <Button type="button" variant="quiet" icon={Trash2} onClick={() => setContextEditor({ ...contextEditor, facts: contextEditor.facts.filter((item) => item.id !== fact.id) })}>{t.removeFact}</Button>}</div></fieldset>)}</div>
        <Button type="button" icon={Plus} onClick={() => setContextEditor({ ...contextEditor, facts: [...contextEditor.facts, emptyFact()] })}>{t.addFact}</Button><fieldset className={styles.brand}><legend>{t.brand}</legend><TextareaField label={t.colors} value={contextEditor.colors} disabled={saving} onChange={(event) => setContextEditor({ ...contextEditor, colors: event.target.value })} /><TextareaField label={t.fonts} value={contextEditor.fonts} disabled={saving} onChange={(event) => setContextEditor({ ...contextEditor, fonts: event.target.value })} /><TextareaField label={t.voice} value={contextEditor.voice} disabled={saving} onChange={(event) => setContextEditor({ ...contextEditor, voice: event.target.value })} /></fieldset>
      </form>}
    </Dialog>

    <Dialog open={Boolean(ruleEditor)} onOpenChange={(open) => { if (!open && !saving) setRuleEditor(undefined); }} title={ruleEditor?.detail ? t.editContext : t.addRule} dismissible={!saving} dirty={Boolean(ruleEditor?.title || ruleEditor?.goal)} onDiscard={() => setRuleEditor(undefined)} footer={<><DialogClose disabled={saving}>{t.cancel}</DialogClose><Button type="submit" form="work-rule-form" variant="primary" pending={saving} pendingLabel={t.saving}>{t.addRule}</Button></>}>
      {ruleEditor && <form id="work-rule-form" className={styles.form} onSubmit={saveRule}><InputField label={t.ruleTitle} required maxLength={240} value={ruleEditor.title} disabled={saving} onChange={(event) => setRuleEditor({ ...ruleEditor, title: event.target.value })} /><TextareaField label={t.goal} required maxLength={12000} value={ruleEditor.goal} disabled={saving} onChange={(event) => setRuleEditor({ ...ruleEditor, goal: event.target.value })} /><InputField label={t.budget} required inputMode="decimal" pattern="(?:0|[1-9]\d*)(?:\.\d{1,12})?" value={ruleEditor.maximumUsd} disabled={saving} onChange={(event) => setRuleEditor({ ...ruleEditor, maximumUsd: event.target.value })} /><InputField label={t.reason} required maxLength={1000} value={ruleEditor.reason} disabled={saving} onChange={(event) => setRuleEditor({ ...ruleEditor, reason: event.target.value })} /><fieldset className={styles.contextChoices}><legend>{t.contextForRule}</legend>{contexts.length ? contexts.map((item) => <CheckboxField key={item.id} label={`${item.title} · ${t.revision} ${item.currentRevision}`} checked={ruleEditor.contextIds.includes(item.id)} disabled={saving} onChange={(event) => setRuleEditor({ ...ruleEditor, contextIds: event.target.checked ? [...ruleEditor.contextIds, item.id] : ruleEditor.contextIds.filter((id) => id !== item.id) })} />) : <p>{t.noContextForRule}</p>}</fieldset></form>}
    </Dialog>

    <Dialog open={Boolean(outcomeEditor)} onOpenChange={(open) => { if (!open && !saving) setOutcomeEditor(undefined); }} title={t.addOutcome} dismissible={!saving} dirty={Boolean(outcomeEditor?.label || outcomeEditor?.value)} onDiscard={() => setOutcomeEditor(undefined)} footer={<><DialogClose disabled={saving}>{t.cancel}</DialogClose><Button type="submit" form="outcome-form" variant="primary" pending={saving} pendingLabel={t.saving}>{t.addOutcome}</Button></>}>
      {outcomeEditor && <form id="outcome-form" className={styles.form} onSubmit={saveOutcome}><SelectField label={t.relatedRun} required value={outcomeEditor.occurrenceId} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, occurrenceId: event.target.value })}><option value="">{t.choose}</option>{visibleOccurrences.map((item) => <option key={item.id} value={item.id}>{formatInstant(locale, item.createdAt)} · {item.state}</option>)}</SelectField><InputField label={t.metric} required maxLength={240} value={outcomeEditor.label} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, label: event.target.value })} /><InputField label={t.metricKey} required pattern="[a-z][a-z0-9_.-]{0,119}" value={outcomeEditor.metricKey} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, metricKey: event.target.value })} /><div className={styles.dateFields}><InputField type="date" label={t.periodStart} required value={outcomeEditor.periodStart} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, periodStart: event.target.value })} /><InputField type="date" label={t.periodEnd} required value={outcomeEditor.periodEnd} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, periodEnd: event.target.value })} /></div><InputField label={t.resultValue} required maxLength={4000} value={outcomeEditor.value} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, value: event.target.value })} /><TextareaField label={t.evidenceNote} required maxLength={2000} value={outcomeEditor.evidence} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, evidence: event.target.value })} /><TextareaField label={t.outcomeNote} maxLength={4000} value={outcomeEditor.note} disabled={saving} onChange={(event) => setOutcomeEditor({ ...outcomeEditor, note: event.target.value })} /></form>}
    </Dialog>
  </main></WorkspaceShell>;
}
