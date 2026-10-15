'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Clock3, ExternalLink, FileCheck2, LoaderCircle, LogIn, PauseCircle, Play, RefreshCw, Settings, Square, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/provider';
import { formatDecimal, formatInstant, formatNumber } from '../../../i18n/format';
import type { Run, RunListPage, RunState, RunStepState } from '../../../contracts/runs';
import type { IdentityViewer } from '../../identity/contracts';
import { useIdentityAccount } from '../../identity/ui/identity-locale-provider';
import { AccountMenu } from '../../identity/ui/account-menu';
import { AuthDialog } from '../../identity/ui/credentials';
import { Button, Combobox, Dialog, DialogClose, EmptyState, IconButton, LoadingState, LocaleSelect, ProductHeader } from '../../../ui';
import { runCatalog, type RunCopy } from '../locales';
import { runClient, RunClientError, type RunRequestOptions } from '../client/transport';
import { openRunEvents } from '../client/events';
import { activeRun, observableRun, lostAccess, resultLink, runErrorText, runResults } from '../client/state';
import styles from './runs.module.css';
import { RunContinuation, type RunChange } from './run-continuation';

const stateIcons = { queued: Clock3, running: LoaderCircle, waiting_input: PauseCircle, review_ready: FileCheck2, completed: CheckCircle2, failed: XCircle, cancelled: Square };
const stepIcons = { planned: Circle, claimed: LoaderCircle, succeeded: Check, failed: XCircle, skipped: Square };
const pageVisible = () => document.visibilityState !== 'hidden';
function compactAmount(value: string) {
  const [whole = '0', fraction] = value.split('.');
  const trimmed = fraction?.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
function RunStatus({ state, text }: { state: RunState; text: RunCopy }) {
  const Icon = stateIcons[state];
  return <span className={styles.status} data-state={state}><Icon aria-hidden="true" size={18} className={state === 'running' ? 'tl-spin' : undefined} />{text.states[state]}</span>;
}
function StepStatus({ state, text }: { state: RunStepState; text: RunCopy }) {
  const Icon = stepIcons[state];
  return <span className={styles.stepIcon} data-state={state} aria-label={text.stepStates[state]}><Icon aria-hidden="true" size={20} className={state === 'claimed' ? 'tl-spin' : undefined} /></span>;
}
function ErrorNotice({ error, text, retry }: { error: unknown; text: RunCopy; retry: () => void }) {
  return <div className={styles.error}><p role="alert">{runErrorText(error, text)}</p><Button icon={RefreshCw} onClick={retry}>{text.checkState}</Button></div>;
}

function useGuardedRunRequest(viewer: IdentityViewer, authEpoch: number) {
  const { isCurrent, invalidate, refresh } = useIdentityAccount();
  return useCallback(async <T,>(signal: AbortSignal, action: (options: RunRequestOptions) => Promise<T>) => {
    if (signal.aborted || !isCurrent(viewer.user.id, authEpoch)) throw new DOMException('Aborted', 'AbortError');
    try {
      const result = await action({ userId: viewer.user.id, signal });
      if (signal.aborted || !isCurrent(viewer.user.id, authEpoch)) throw new DOMException('Aborted', 'AbortError');
      return result;
    } catch (error) {
      if (signal.aborted || !isCurrent(viewer.user.id, authEpoch)) throw new DOMException('Aborted', 'AbortError');
      if (error instanceof RunClientError && error.status === 401) invalidate(viewer.user.id, authEpoch);
      if (error instanceof RunClientError && error.messageKey === 'runs.errors.accountChanged') { invalidate(viewer.user.id, authEpoch); void refresh().catch(() => undefined); }
      throw error;
    }
  }, [viewer.user.id, authEpoch, isCurrent, invalidate, refresh]);
}
type Guard = ReturnType<typeof useGuardedRunRequest>;

function RunList({ workspaceId, projectId, guard, text }: { workspaceId: string; projectId?: string; guard: Guard; text: RunCopy }) {
  const { locale } = useLocale();
  const [data, setData] = useState<RunListPage>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [before, setBefore] = useState<string>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const lifetime = new AbortController();
    let current: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, busy = false, denied = false;
    async function load() {
      if (busy || denied || lifetime.signal.aborted || !pageVisible()) return;
      busy = true;
      current = new AbortController();
      const signal = AbortSignal.any([current.signal, lifetime.signal]);
      setPending(true);
      let delay = 15_000;
      try {
        const result = await guard(signal, (options) => runClient.list(workspaceId, options, before, projectId));
        setData(result); setError(undefined);
        if (result.runs.some(activeRun)) delay = 3000;
      } catch (failure) {
        if (!signal.aborted && !(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure);
          if (lostAccess(failure)) { setData(undefined); denied = true; }
        }
      } finally {
        busy = false;
        if (!lifetime.signal.aborted) {
          setPending(false);
          if (!denied && pageVisible()) timer = setTimeout(() => { void load(); }, delay);
        }
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') current?.abort();
      else void load();
    };
    void load();
    document.addEventListener('visibilitychange', visibility);
    return () => { lifetime.abort(); current?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [workspaceId, projectId, before, guard, version]);
  const refresh = () => setVersion((value) => value + 1);
  function navigate(next: string | undefined, older: boolean) {
    setHistory((values) => older ? [...values, before] : values.slice(0, -1));
    setBefore(next); setData(undefined); setError(undefined);
  }
  return <section aria-label={text.title} className={styles.collection}>
    <div className={styles.listToolbar}><span role="status" className={styles.muted}>{pending && data ? text.refreshing : ''}</span><IconButton icon={RefreshCw} label={text.refresh} pending={pending} onClick={refresh} /></div>
    {error !== undefined && <ErrorNotice error={error} text={text} retry={refresh} />}
    {!data && error === undefined && <LoadingState label={text.loading} />}
    {data && data.runs.length === 0 && <EmptyState title={text.emptyTitle} description={text.emptyText} icon={Activity} />}
    {data && data.runs.length > 0 && <ul className={styles.runList}>
      {data.runs.map((run) => <li key={run.id}>
        <Link href={`/app/runs/${run.id}`} className={styles.runLink}>
          <div className={styles.runHeading}><h2>{run.goal}</h2><RunStatus state={run.state} text={text} /></div>
          <div className={styles.runMeta}><time dateTime={run.updatedAt}>{formatInstant(locale, run.updatedAt)}</time><span>{text.stepsDone}: {formatNumber(locale, run.steps.filter((step) => step.state === 'succeeded').length)} / {formatNumber(locale, run.steps.length)}</span><ArrowRight aria-hidden="true" size={18} /></div>
          {run.failure && <p className={styles.rowFailure}>{text.failures[run.failure]}</p>}
        </Link>
      </li>)}
    </ul>}
    {(history.length > 0 || data?.nextCursor) && <nav className={styles.pagination} aria-label={text.title}>
      <Button icon={ArrowLeft} disabled={pending || history.length === 0} onClick={() => navigate(history.at(-1), false)}>{text.previous}</Button>
      <Button icon={ArrowRight} disabled={pending || !data?.nextCursor} onClick={() => { if (data?.nextCursor) navigate(data.nextCursor, true); }}>{text.next}</Button>
    </nav>}
  </section>;
}

function RunDetail({ runId, guard, text }: { runId: string; guard: Guard; text: RunCopy }) {
  const { locale } = useLocale();
  const router = useRouter();
  const [data, setData] = useState<Run>();
  const [error, setError] = useState<unknown>();
  const [connection, setConnection] = useState(false);
  const [version, setVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [commandError, setCommandError] = useState<unknown>();
  const command = useRef<{ kind: 'cancel' | 'resume'; epoch: number; key: string; stepId?: string; fingerprint: string } | null>(null);
  const commandController = useRef<AbortController | null>(null);
  useEffect(() => () => commandController.current?.abort(), []);
  useEffect(() => {
    const lifetime = new AbortController();
    let connectionController: AbortController | undefined, scheduled: ReturnType<typeof setTimeout> | undefined, cycleTimer: ReturnType<typeof setTimeout> | undefined;
    let busy = false, denied = false, refreshing = false, needsRefresh = false, cursor = 0, retry = 2000;
    let current: Run | undefined;
    const currentRun = (): Run | undefined => current;
    const signal = lifetime.signal;
    async function snapshot() {
      if (refreshing) { needsRefresh = true; return; }
      refreshing = true;
      try {
        do {
          needsRefresh = false;
          current = await guard(signal, (options) => runClient.read(runId, options));
          setData(current); setError(undefined);
          if (!activeRun(current)) setConnection(false);
          if (command.current && command.current.epoch !== current.epoch) { command.current = null; setCommandError(undefined); }
        } while (needsRefresh && !signal.aborted);
      } catch (failure) {
        if (!signal.aborted && !(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure);
          if (lostAccess(failure)) { denied = true; setData(undefined); connectionController?.abort(); }
        }
      } finally { refreshing = false; }
    }
    function changed() {
      if (!scheduled) scheduled = setTimeout(() => { scheduled = undefined; void snapshot(); }, 250);
    }
    async function cycle() {
      if (busy || denied || signal.aborted || !pageVisible()) return;
      busy = true;
      connectionController = new AbortController();
      const streamSignal = AbortSignal.any([signal, connectionController.signal]);
      try {
        await snapshot();
        const loaded = currentRun();
        if (!loaded || denied) return;
        cursor = loaded.cursor;
        if (!activeRun(loaded)) { retry = 15_000; return; }
        const result = await guard(streamSignal, (options) => openRunEvents(runId, cursor, (event) => {
          cursor = event.sequence; changed();
        }, options));
        cursor = result.cursor; retry = 2000; setConnection(false);
        await snapshot();
      } catch (failure) {
        if (!streamSignal.aborted && !(failure instanceof DOMException && failure.name === 'AbortError')) {
          if (lostAccess(failure)) { denied = true; setData(undefined); setError(failure); }
          else {
            setConnection(true); retry = Math.min(15_000, retry * 2);
            await snapshot();
            if (current) cursor = current.cursor;
          }
        }
      } finally {
        busy = false;
        if (!signal.aborted && !denied && pageVisible() && (!current || observableRun(current))) cycleTimer = setTimeout(() => { void cycle(); }, retry);
      }
    }
    const visibility = () => {
      clearTimeout(cycleTimer);
      if (document.visibilityState === 'hidden') connectionController?.abort();
      else { current = undefined; void cycle(); }
    };
    void cycle();
    document.addEventListener('visibilitychange', visibility);
    return () => { lifetime.abort(); connectionController?.abort(); clearTimeout(scheduled); clearTimeout(cycleTimer); document.removeEventListener('visibilitychange', visibility); };
  }, [runId, guard, version]);
  const refresh = () => setVersion((value) => value + 1);
  async function mutate(kind: 'cancel' | 'resume', stepId?: string, change: RunChange = {}) {
    if (!data || pending) return;
    const fingerprint = JSON.stringify(change);
    if (!command.current || command.current.kind !== kind || command.current.epoch !== data.epoch || command.current.stepId !== stepId || command.current.fingerprint !== fingerprint) command.current = { kind, epoch: data.epoch, key: crypto.randomUUID(), fingerprint, ...(stepId ? { stepId } : {}) };
    const intent = command.current;
    const controller = new AbortController(); commandController.current = controller;
    setPending(true); setCommandError(undefined);
    try {
      const result = await guard(controller.signal, (options) => kind === 'cancel' ? runClient.cancel(runId, intent.epoch, intent.key, options) : runClient.continue(runId, { expectedEpoch: intent.epoch, ...change, ...(stepId ? { stepId } : {}) }, intent.key, options));
      if (result.id !== runId) { command.current = null; router.push(`/app/runs/${result.id}`); return; }
      setData(result); setCancelOpen(false); command.current = null; refresh();
    } catch (failure) {
      if (!controller.signal.aborted && !(failure instanceof DOMException && failure.name === 'AbortError')) {
        setCommandError(failure);
        if (lostAccess(failure)) { setData(undefined); setError(failure); setCancelOpen(false); }
      }
    } finally { if (!controller.signal.aborted) setPending(false); }
  }
  const results = data ? runResults(data) : [];
  return <>
    <div className={styles.backRow}><Link href={data ? `/app/runs?workspace=${data.workspaceId}` : '/app/runs'} className={styles.backLink}><ArrowLeft aria-hidden="true" size={18} />{text.back}</Link><IconButton icon={RefreshCw} label={text.refresh} onClick={refresh} disabled={pending} /></div>
    {error !== undefined && <ErrorNotice error={error} text={text} retry={refresh} />}
    {!data && error === undefined && <LoadingState label={text.loading} />}
    {data && <article className={styles.detail}>
      <div className={styles.detailHeading}><h2>{data.goal}</h2><RunStatus state={data.state} text={text} /></div>
      {data.capabilityId.startsWith('runtime.') && <div className={styles.synthetic}><strong>{text.synthetic}</strong><p>{text.syntheticText}</p></div>}
      <div className={styles.detailMeta}><span>{text.started}: <time dateTime={data.startedAt ?? data.createdAt}>{formatInstant(locale, data.startedAt ?? data.createdAt)}</time></span><span>{text.updated}: <time dateTime={data.updatedAt}>{formatInstant(locale, data.updatedAt)}</time></span></div>
      <div className={styles.actions}>
        {data.actions.resume && !data.progress.questions.length && <Button icon={Play} variant="primary" pending={pending} pendingLabel={text.sending} onClick={() => { void mutate('resume'); }}>{text.resume}</Button>}
        {data.actions.cancel && <Button icon={Square} disabled={pending} onClick={() => setCancelOpen(true)}>{text.cancel}</Button>}
      </div>
      {data.failure && <p className={styles.failure} role="status">{text.failures[data.failure]}</p>}
      {commandError !== undefined && <ErrorNotice error={commandError} text={text} retry={refresh} />}
      {connection && <p className={styles.connection} role="status">{text.connectionLost}</p>}
      <RunContinuation key={data.id} run={data} locale={locale} pending={pending} onContinue={(change) => { void mutate('resume', undefined, change); }} />
      <div className={styles.detailColumns}>
        <section aria-labelledby="run-progress"><h3 id="run-progress">{text.steps}</h3><ol className={styles.steps}>
          {data.steps.map((step) => <li key={step.id} className={styles.step}>
            <StepStatus state={step.state} text={text} />
            <div className={styles.stepBody}><div className={styles.stepHeading}><strong>{text.actions[step.action]}</strong><span>{text.stepStates[step.state]}</span></div>
              {step.finishedAt && <time dateTime={step.finishedAt}>{formatInstant(locale, step.finishedAt)}</time>}
              {step.failure && <p>{text.failures[step.failure]}</p>}
              {data.actions.retryStepIds.includes(step.id) && <Button icon={RefreshCw} variant="quiet" pending={pending} onClick={() => { void mutate('resume', step.id); }}>{text.retryStep}</Button>}
            </div>
          </li>)}
        </ol></section>
        <aside className={styles.summary}>
          <section aria-labelledby="run-cost"><h3 id="run-cost">{text.budget}</h3><dl className={styles.cost}><div><dt>{text.spent}</dt><dd>{formatDecimal(locale, compactAmount(data.budget.spentUsd))} {text.dollars}</dd></div><div><dt>{text.reserved}</dt><dd>{formatDecimal(locale, compactAmount(data.budget.reservedUsd))} {text.dollars}</dd></div></dl></section>
          <section aria-labelledby="run-results"><h3 id="run-results">{text.results}</h3>{results.length ? <ul className={styles.results}>{results.map((result) => {
            const href = resultLink(data, result);
            const title = data.progress.results.find((item) => item.kind === result.kind && item.id === result.id)?.title ?? text[result.kind];
            return <li key={`${result.kind}:${result.id}:${result.revision ?? ''}`}>{href ? <Link href={href}>{title}<ExternalLink size={16} aria-hidden="true" /></Link> : <span>{title}{result.revision !== undefined && ` ${formatNumber(locale, result.revision)}`}</span>}</li>;
          })}</ul> : <p className={styles.muted}>{text.noResult}</p>}</section>
        </aside>
      </div>
      <Dialog open={cancelOpen} onOpenChange={(open) => { if (!pending) setCancelOpen(open); }} title={text.cancelTitle} description={text.cancelText} footer={<><DialogClose disabled={pending}>{text.keep}</DialogClose><Button icon={Square} variant="danger" pending={pending} pendingLabel={text.sending} onClick={() => { void mutate('cancel'); }}>{text.cancel}</Button></>}><p className={styles.dialogGoal}>{data.goal}</p>{commandError !== undefined && <p role="alert">{runErrorText(commandError, text)}</p>}</Dialog>
    </article>}
  </>;
}

function RunsPrivate({ viewer, authEpoch, initialWorkspaceId, projectId, runId, text }: { viewer: IdentityViewer; authEpoch: number; initialWorkspaceId?: string; projectId?: string; runId?: string; text: RunCopy }) {
  const router = useRouter();
  const guard = useGuardedRunRequest(viewer, authEpoch);
  const [selected, setSelected] = useState<string | null>(initialWorkspaceId ?? viewer.workspaces[0]?.workspaceId ?? null);
  if (runId) return <RunDetail key={runId} runId={runId} guard={guard} text={text} />;
  const options = viewer.workspaces.map((item) => ({ id: item.workspaceId, label: item.name }));
  const choice = options.find((item) => item.id === selected) ?? null;
  return <>
    <div className={styles.workspaceRow}>{options.length > 0 && <Combobox label={text.workspace} options={options} value={choice} onChange={(option) => { setSelected(option?.id ?? null); if (option) router.replace(`/app/runs?workspace=${option.id}`); }} />}<Link href="/settings/team" className={styles.textLink}>{text.manageWorkspace}</Link></div>
    {!options.length ? <EmptyState title={text.chooseWorkspace} description={text.noWorkspace} /> : !choice ? <p role="status">{selected ? text.noAccess : text.chooseWorkspace}</p> : <RunList key={`${choice.id}:${projectId ?? ''}`} workspaceId={choice.id} projectId={projectId} guard={guard} text={text} />}
  </>;
}

export function RunsPage({ initialWorkspaceId, projectId, runId }: { initialWorkspaceId?: string; projectId?: string; runId?: string }) {
  const { locale } = useLocale();
  const text = runCatalog[locale];
  const account = useIdentityAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const returnTo = runId ? `/app/runs/${runId}` : initialWorkspaceId ? `/app/runs?workspace=${initialWorkspaceId}` : '/app/runs';
  return <div className={styles.page}>
    <ProductHeader homeLabel={text.home}><Link href="/settings" className={styles.settingsLink} aria-label={text.settings}><Settings aria-hidden="true" size={18} /><span>{text.settings}</span></Link><LocaleSelect compact /><AccountMenu /></ProductHeader>
    <main className={styles.main}><h1>{runId ? text.detail : text.title}</h1>
      {!account.ready ? <LoadingState label={text.loading} /> : account.viewer ? <RunsPrivate key={`${account.viewer.user.id}:${account.viewer.session.id}:${account.authEpoch}`} viewer={account.viewer} authEpoch={account.authEpoch} initialWorkspaceId={initialWorkspaceId} projectId={projectId} runId={runId} text={text} /> : <EmptyState title={text.signInText} action={<Button icon={LogIn} variant="primary" onClick={() => setAuthOpen(true)}>{text.signIn}</Button>} />}
    </main>
    <AuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={returnTo} onAuthenticated={() => { setAuthOpen(false); void account.refresh().catch(() => undefined); }} />
  </div>;
}
