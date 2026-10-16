'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Clock3, FileText, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Run, RunResultRef, RunState } from '@/contracts/runs';
import type { ArtifactSnapshot } from '@/features/artifacts/contracts';
import { createArtifactClient } from '@/features/artifacts/client/transport';
import { AuthDialog, useIdentityAccount } from '@/features/identity/ui';
import { createOperationsClient } from '@/features/operations/client/transport';
import { AssistantSession, type AssistantSessionTransport } from '@/features/runs/ui/assistant-session';
import { ArtifactWorkspacePage, type ArtifactWorkspaceTransport } from '@/features/workspace/ui/artifact-page';
import { LocaleProvider } from '@/i18n/provider';
import type { Locale } from '@/i18n/locales';
import { Button, CheckboxField, EmptyState, InlineNotice, LoadingState, LocaleSelect, ProductHeader, SelectField, Surface, TextareaField } from '@/ui';
import { demoClient, DemoRequestError } from '../client';
import type { DemoCopied, DemoSession, DemoStarted } from '../contracts';
import { demoCopy } from '../locales';
import styles from './demo.module.css';

type Failure = { kind: 'expired' | 'rate' | 'unavailable' | 'invalid'; retryAfter?: number };
type Material = { id: string; title: string; kind: 'input' | 'result'; revision?: number };
const settledStates = new Set<RunState>(['waiting_input', 'review_ready', 'completed', 'failed', 'cancelled']);
const storageKey = (locale: Locale) => `tirlik.demo-session.v2.${locale}`;
const interpolate = (value: string, variables: Record<string, string | number>) => Object.entries(variables).reduce((text, [key, replacement]) => text.replace(`{${key}}`, String(replacement)), value);

function mapFailure(error: unknown): Failure {
  if (error instanceof DemoRequestError) {
    if (error.status === 404 || error.status === 410 || error.code === 'DEMO_EXPIRED') return { kind: 'expired' };
    if (error.status === 429) return { kind: 'rate', retryAfter: error.retryAfterSeconds };
    return { kind: 'unavailable' };
  }
  if (error instanceof Error && (error.name === 'ZodError' || error.message.includes('parse'))) return { kind: 'invalid' };
  return { kind: 'unavailable' };
}

function failureText(failure: Failure, copy: typeof demoCopy.ru) {
  if (failure.kind === 'expired') return copy.expired;
  if (failure.kind === 'rate') return interpolate(copy.rate, { seconds: failure.retryAfter ?? 60 });
  if (failure.kind === 'invalid') return copy.invalid;
  return copy.unavailable;
}

function startedFromSession(session: DemoSession): DemoStarted {
  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    revision: session.revision,
    locale: session.locale,
    actorId: session.actorId,
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    inputRefs: session.inputRefs,
  };
}

function MaterialSelection({ materials, selected, disabled, onChange }: { materials: Material[]; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const toggle = (id: string, checked: boolean) => onChange(checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id));
  return <div className={styles.materialChoices}>{materials.map((material) => <CheckboxField key={material.id} label={material.title} checked={selected.includes(material.id)} disabled={disabled} onChange={(event) => toggle(material.id, event.target.checked)} />)}</div>;
}

export function DemoPage({ locale, initialArtifactId }: { locale: Locale; initialArtifactId?: string }) {
  return <LocaleProvider initialLocale={locale}><DemoContent locale={locale} initialArtifactId={initialArtifactId} /></LocaleProvider>;
}

function DemoContent({ locale, initialArtifactId }: { locale: Locale; initialArtifactId?: string }) {
  const t = demoCopy[locale], router = useRouter(), account = useIdentityAccount();
  const [started, setStarted] = useState<DemoStarted>();
  const [session, setSession] = useState<DemoSession>();
  const [run, setRun] = useState<Run>();
  const [runId, setRunId] = useState<string>();
  const [goal, setGoal] = useState(t.goal);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const [artifactView, setArtifactView] = useState<{ id: string; snapshot: ArtifactSnapshot }>();
  const [selectedArtifacts, setSelectedArtifacts] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [copyResult, setCopyResult] = useState<DemoCopied>();
  const [pending, setPending] = useState<'restore' | 'start' | 'run' | 'copy'>();
  const [failure, setFailure] = useState<Failure>();
  const [authOpen, setAuthOpen] = useState(false);
  const runAttempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const copyAttempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const refreshedRun = useRef('');
  const activeSession = session ?? started;
  const sessionId = activeSession?.sessionId;

  const artifactResults = useMemo(() => {
    const results = run?.progress.results.filter((result): result is RunResultRef & { kind: 'artifact'; title: string } => result.kind === 'artifact') ?? [];
    const decision = run?.progress.workDecision;
    const selected = decision?.options.find((option) => option.id === decision.selectedOptionId);
    return selected ? results.filter((result) => selected.artifactIds.includes(result.id)) : results;
  }, [run]);

  const materials = useMemo<Material[]>(() => {
    const inputs = activeSession?.inputRefs.filter((ref) => ref.kind === 'artifact').map((ref, index) => ({ id: ref.id, revision: ref.revision, kind: 'input' as const, title: index === 0 ? t.inputBrief : index === 1 ? t.inputPlan : `${t.inputMaterial} ${index + 1}` })) ?? [];
    const known = new Set(inputs.map((item) => item.id));
    const results = artifactResults.filter((result) => !known.has(result.id)).map((result) => ({ id: result.id, revision: result.revision, kind: 'result' as const, title: result.title }));
    return [...inputs, ...results];
  }, [activeSession, artifactResults, t]);

  const resultMaterials = useMemo(() => materials.filter((material) => material.kind === 'result'), [materials]);
  const effectiveSelectedArtifactId = initialArtifactId && materials.some((item) => item.id === initialArtifactId)
    ? initialArtifactId
    : selectedArtifactId && materials.some((item) => item.id === selectedArtifactId) ? selectedArtifactId : materials[0]?.id;
  const effectiveSelectedArtifacts = selectedArtifacts.length && selectedArtifacts.every((id) => artifactResults.some((item) => item.id === id))
    ? selectedArtifacts
    : artifactResults.map((item) => item.id);
  const workspaces = account.viewer?.workspaces.filter((item) => item.scopes.includes('edit')) ?? [];
  const selectedWorkspaceId = workspaces.some((item) => item.workspaceId === workspaceId) ? workspaceId : workspaces[0]?.workspaceId ?? '';

  const workspaceTransport = useMemo<ArtifactWorkspaceTransport | undefined>(() => {
    if (!sessionId) return undefined;
    const resolvePath = (path: string) => `/api/demo/sessions/${encodeURIComponent(sessionId)}${path.slice(4)}`;
    return {
      artifacts: createArtifactClient({ resolvePath }),
      exports: { resolvePath, capabilities: { history: false, versions: true, fonts: false, cancel: false, remove: false, bundle: true } },
      cache: { databaseName: `tirlik-demo-artifacts-v1-${sessionId}` },
      operations: createOperationsClient({ resolvePath }),
    };
  }, [sessionId]);

  const assistantTransport = useMemo<AssistantSessionTransport | undefined>(() => sessionId ? {
    read: (targetRunId) => demoClient.run(sessionId, targetRunId),
    continue: (targetRunId, input, idempotencyKey) => demoClient.resumeRun(sessionId, targetRunId, input, idempotencyKey),
  } : undefined, [sessionId]);

  const adoptRun = useCallback((next: Run | undefined) => {
    setRun(next);
    if (next) setRunId(next.id);
  }, []);

  const refreshSession = useCallback(async (targetSessionId: string) => {
    const next = await demoClient.session(targetSessionId);
    setSession(next);
    setStarted(startedFromSession(next));
    return next;
  }, []);

  useEffect(() => {
    const id = (() => { try { return localStorage.getItem(storageKey(locale)); } catch { return null; } })();
    if (!id) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPending('restore');
      void demoClient.session(id).then(async (restored) => {
        if (cancelled) return;
        setSession(restored); setStarted(startedFromSession(restored));
        const latestRunId = restored.runIds.at(-1);
        if (latestRunId) adoptRun(await demoClient.run(restored.sessionId, latestRunId));
        setFailure(undefined);
      }).catch((error) => {
        if (cancelled) return;
        const mapped = mapFailure(error); setFailure(mapped);
        if (mapped.kind === 'expired') try { localStorage.removeItem(storageKey(locale)); } catch { /* Visible reset remains available. */ }
      }).finally(() => { if (!cancelled) setPending(undefined); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [locale, adoptRun]);

  useEffect(() => {
    if (!activeSession || !workspaceTransport || !effectiveSelectedArtifactId) return;
    const controller = new AbortController();
    void workspaceTransport.artifacts.snapshot(effectiveSelectedArtifactId, { viewer: { userId: activeSession.actorId, workspaceId: activeSession.workspaceId, authzVersion: 1 }, signal: controller.signal }, activeSession.projectId)
      .then((snapshot) => { if (!controller.signal.aborted) { setArtifactView({ id: effectiveSelectedArtifactId, snapshot }); setFailure(undefined); } })
      .catch((error) => { if (!controller.signal.aborted) setFailure(mapFailure(error)); })
    return () => controller.abort();
  }, [activeSession, workspaceTransport, effectiveSelectedArtifactId]);

  const refreshKey = run && settledStates.has(run.state) && sessionId ? `${sessionId}:${run.id}:${run.state}:${run.epoch}` : '';
  useEffect(() => {
    if (!refreshKey || !sessionId || refreshedRun.current === refreshKey) return;
    refreshedRun.current = refreshKey;
    const timer = window.setTimeout(() => { void refreshSession(sessionId).catch(() => undefined); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshKey, sessionId, refreshSession]);

  async function start() {
    if (pending) return;
    setPending('start'); setFailure(undefined); setCopyResult(undefined);
    try {
      const next = await demoClient.start(locale);
      setStarted(next); setSession(undefined); setRun(undefined); setRunId(undefined); setSelectedArtifacts([]); setSelectedArtifactId(next.inputRefs.find((ref) => ref.kind === 'artifact')?.id);
      try { localStorage.setItem(storageKey(locale), next.sessionId); } catch { /* The signed capability still protects the current tab. */ }
    } catch (error) { setFailure(mapFailure(error)); }
    finally { setPending(undefined); }
  }

  async function execute(retry = false) {
    if (!activeSession || pending) return;
    setPending('run'); setFailure(undefined); setCopyResult(undefined);
    try {
      const fresh = await refreshSession(activeSession.sessionId);
      const nextGoal = goal.trim() || t.goal;
      const signature = `${fresh.sessionId}:${fresh.revision}:${fresh.inputRefs.map((ref) => `${ref.id}:${ref.revision ?? ''}`).join(',')}:${nextGoal}`;
      if (retry || runAttempt.current?.signature !== signature) runAttempt.current = { signature, key: crypto.randomUUID() };
      const created = await demoClient.startRun(fresh.sessionId, { goal: nextGoal, inputRefs: fresh.inputRefs, expectedRevision: fresh.revision }, runAttempt.current!.key);
      setRunId(created.runId);
      adoptRun(await demoClient.run(fresh.sessionId, created.runId));
    } catch (error) { setFailure(mapFailure(error)); }
    finally { setPending(undefined); }
  }

  function reset() {
    if (sessionId) try { localStorage.removeItem(storageKey(locale)); } catch { /* The old scope still expires server-side. */ }
    setStarted(undefined); setSession(undefined); setRun(undefined); setRunId(undefined); setGoal(t.goal); setSelectedArtifactId(undefined); setArtifactView(undefined); setSelectedArtifacts([]); setFailure(undefined); setCopyResult(undefined); refreshedRun.current = '';
  }

  async function copy() {
    if (!activeSession || !selectedWorkspaceId || !effectiveSelectedArtifacts.length || pending) return;
    if (!account.viewer) { setAuthOpen(true); return; }
    setPending('copy'); setFailure(undefined);
    try {
      const fresh = await refreshSession(activeSession.sessionId);
      const signature = `${fresh.sessionId}:${fresh.revision}:${selectedWorkspaceId}:${[...effectiveSelectedArtifacts].sort().join(',')}`;
      if (copyAttempt.current?.signature !== signature) copyAttempt.current = { signature, key: crypto.randomUUID() };
      setCopyResult(await demoClient.copy(fresh.sessionId, { expectedRevision: fresh.revision, artifactIds: effectiveSelectedArtifacts, destinationWorkspaceId: selectedWorkspaceId }, copyAttempt.current!.key));
    } catch (error) { setFailure(mapFailure(error)); }
    finally { setPending(undefined); }
  }

  const scopedResultIds = new Set(session?.results.filter((result) => result.kind === 'artifact').map((result) => result.id) ?? []);
  const copyReady = resultMaterials.length > 0 && Boolean(run && ['review_ready', 'completed'].includes(run.state)) && resultMaterials.every((result) => scopedResultIds.has(result.id));
  const selectedMaterial = materials.find((material) => material.id === effectiveSelectedArtifactId);
  const artifactSnapshot = artifactView && artifactView.id === effectiveSelectedArtifactId ? artifactView.snapshot : undefined;
  const artifactLoading = Boolean(effectiveSelectedArtifactId && !artifactSnapshot);
  const artifactHref = (artifactId: string) => `/${locale}/demo?${new URLSearchParams({ artifact: artifactId })}#demo-workspace`;

  return <div className={styles.page}>
    <ProductHeader homeHref={`/${locale}`} homeLabel={t.home}><LocaleSelect compact selectedLocale={locale} onLocaleChange={(next) => router.push(`/${next}/demo`)} /></ProductHeader>
    <main className={styles.main}>
      <header className={styles.projectHeader}>
        <div className={styles.scopeLine}><span><ShieldCheck aria-hidden="true" size={16} />{t.scopeTitle}</span><p>{t.scopeBody}</p></div>
        <div className={styles.projectHeading}><div><p className={styles.overline}>{t.title}</p><h1>{t.projectTitle}</h1><p>{t.intro}</p></div>{activeSession && <p className={styles.expiry}><Clock3 size={17} aria-hidden="true" />{interpolate(t.expires, { time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activeSession.expiresAt)) })}</p>}</div>
        <dl className={styles.facts}><div><dt>{t.customer}</dt><dd>{t.customerValue}</dd></div><div><dt>{t.amount}</dt><dd>{t.amountValue}</dd></div><div><dt>{t.deadline}</dt><dd>{t.deadlineValue}</dd></div><div><dt>{t.load}</dt><dd>{t.loadValue}</dd></div></dl>
      </header>

      {failure && <InlineNotice tone={failure.kind === 'expired' ? 'warning' : 'danger'} title={failureText(failure, t)} action={failure.kind === 'expired' ? <Button icon={RefreshCw} onClick={() => { void start(); }}>{t.start}</Button> : activeSession && !runId ? <Button icon={RefreshCw} onClick={() => { void execute(true); }}>{t.retry}</Button> : undefined} />}

      <section id="demo-workspace" className={styles.workspace} aria-labelledby="demo-workspace-title">
        <div className={styles.workspaceHeading}><div><h2 id="demo-workspace-title">{t.caseTitle}</h2><p>{activeSession ? t.workspaceBody : t.startBody}</p></div><strong>{activeSession ? t.savedInputs : t.preparedStatus}</strong></div>
        <nav className={styles.materialTabs} aria-label={t.materialsTitle}>
          {activeSession ? materials.map((material) => <Link key={material.id} href={artifactHref(material.id)} prefetch={false} aria-current={material.id === effectiveSelectedArtifactId ? 'page' : undefined} data-kind={material.kind}><FileText size={18} aria-hidden="true" /><span><small>{material.kind === 'input' ? t.inputLabel : t.resultLabel}</small>{material.title}</span></Link>)
            : <><span className={styles.materialPreview}><FileText size={18} aria-hidden="true" /><span><small>{t.inputLabel}</small>{t.inputBrief}</span></span><span className={styles.materialPreview}><FileText size={18} aria-hidden="true" /><span><small>{t.inputLabel}</small>{t.inputPlan}</span></span></>}
        </nav>
        <div className={styles.workspaceLayout}>
          <div className={styles.sessionPane}>
            {run && ['failed', 'cancelled'].includes(run.state) && <InlineNotice tone="warning" title={t.runNeedsRestart} action={<Button icon={RefreshCw} pending={pending === 'run'} onClick={() => { void execute(true); }}>{t.restartRun}</Button>} />}
            {activeSession && runId && assistantTransport ? <AssistantSession key={activeSession.sessionId} userId={activeSession.actorId} workspaceId={activeSession.workspaceId} projectId={activeSession.projectId} initialRunId={runId} transport={assistantTransport} draftScopeKey={activeSession.sessionId} onRunData={adoptRun} onRunChange={setRunId} resultHref={(_activeRun, result) => result.kind === 'artifact' ? artifactHref(result.id) : null} runHref={() => `/${locale}/demo#demo-session`} />
              : <Surface className={styles.runStarter}>
                <p className={styles.eyebrow}>{t.sessionTitle}</p><h3>{activeSession ? t.sessionLead : t.preparedTitle}</h3><p>{activeSession ? t.sessionBody : t.preparedBody}</p>
                <TextareaField id="demo-goal" label={t.goalLabel} value={goal} rows={7} maxLength={12000} disabled={Boolean(pending)} onChange={(event) => setGoal(event.target.value)} />
                {activeSession ? <Button variant="primary" icon={Play} pending={pending === 'run'} pendingLabel={t.running} disabled={!goal.trim() || artifactLoading} onClick={() => { void execute(); }}>{t.run}</Button>
                  : <Button variant="primary" icon={Play} pending={pending === 'start'} pendingLabel={t.starting} disabled={!goal.trim()} onClick={() => { void start(); }}>{t.start}</Button>}
              </Surface>}
          </div>
          <div className={styles.artifactPane} aria-live="polite">
            {!activeSession ? <div className={styles.preparedInputs}><div><p className={styles.eyebrow}>{t.preparedLabel}</p><h2>{t.preparedInputsTitle}</h2><p>{t.preparedInputsBody}</p></div><article><FileText size={22} aria-hidden="true" /><div><span>{t.inputLabel}</span><h3>{t.inputBrief}</h3><p>{t.inputBriefBody}</p></div></article><article><Clock3 size={22} aria-hidden="true" /><div><span>{t.inputLabel}</span><h3>{t.inputPlan}</h3><p>{t.inputPlanBody}</p></div></article></div>
              : artifactLoading ? <LoadingState label={t.loadingMaterial} /> : artifactSnapshot && workspaceTransport ? <ArtifactWorkspacePage key={artifactSnapshot.artifact.id} initial={artifactSnapshot} projectTitle={t.projectTitle} mode="scoped" transport={workspaceTransport} /> : <EmptyState icon={FileText} title={t.materialUnavailable} description={selectedMaterial?.title ?? t.chooseMaterial} />}
          </div>
        </div>
      </section>

      {copyReady && <section className={styles.copy} aria-labelledby="demo-copy-title"><div><h2 id="demo-copy-title">{t.copyTitle}</h2><p>{t.copyBody}</p></div>
        <div className={styles.copyControls}><MaterialSelection materials={resultMaterials} selected={effectiveSelectedArtifacts} disabled={pending === 'copy'} onChange={setSelectedArtifacts} />
          {account.viewer ? workspaces.length ? <SelectField label={t.chooseWorkspace} value={selectedWorkspaceId} disabled={pending === 'copy'} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</option>)}</SelectField> : <InlineNotice tone="warning" title={t.noWorkspace} action={<Link className="tl-button tl-button--secondary" href="/settings/team">{t.openTeam}</Link>} /> : null}
          {copyResult ? <InlineNotice tone="success" title={t.copied} action={<Link className="tl-button tl-button--primary" href={`/app/projects/${copyResult.projectId}`}>{t.openCopy}<ArrowRight size={18} aria-hidden="true" /></Link>} />
            : <Button variant="primary" icon={BriefcaseBusiness} pending={pending === 'copy'} pendingLabel={t.copying} disabled={Boolean(account.viewer && (!selectedWorkspaceId || !effectiveSelectedArtifacts.length))} onClick={() => { if (account.viewer) void copy(); else setAuthOpen(true); }}>{account.viewer ? t.copy : t.signInToCopy}</Button>}
        </div>
      </section>}

      {activeSession && <div className={styles.reset}><Button variant="quiet" icon={RefreshCw} disabled={Boolean(pending)} onClick={reset}>{t.reset}</Button></div>}
    </main>
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={`/${locale}/demo${effectiveSelectedArtifactId ? `?artifact=${encodeURIComponent(effectiveSelectedArtifactId)}` : ''}`} onAuthenticated={() => setAuthOpen(false)} />
  </div>;
}
