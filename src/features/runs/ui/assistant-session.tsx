'use client';

import Link from 'next/link';
import { ArrowUpRight, Bot, Check, ChevronLeft, Circle, FileText, LoaderCircle, Play, RefreshCw, Square, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResumeRun, Run, RunEvent } from '@/contracts/runs';
import type { FinanceRecalculateRequest, FinanceRecalculateResult } from '@/features/finance/contracts';
import { financeRecalculationClient } from '@/features/finance/client/recalculation';
import { formatDecimal } from '@/i18n';
import { useLocale } from '@/i18n/provider';
import { Button, Dialog, DialogClose, LoadingState } from '@/ui';
import { runClient, RunClientError } from '../client/transport';
import { openRunEvents } from '../client/events';
import { runCatalog, assistantSessionCatalog } from '../locales';
import { RunContinuation, type RunChange } from './run-continuation';
import { assistantSessionState, sessionArtifactResultHrefs, sessionResultHref, sessionResults, type SessionResultHrefResolver } from './session-state';
import { DecisionPanel } from './decision-panel';
import { WorkDecisionPanel } from '@/features/campaigns/ui/work-decision-panel';
import { WorkPreviewPanel } from './work-preview-panel';
import styles from './runs.module.css';

const actionIcons = { planned: Circle, claimed: LoaderCircle, succeeded: Check, failed: XCircle, skipped: Square } as const;

export interface AssistantSessionTransportContext {
  userId: string;
  workspaceId: string;
  projectId: string;
  signal?: AbortSignal;
}

export interface AssistantSessionTransport {
  latest?: (context: AssistantSessionTransportContext) => Promise<Run | undefined>;
  read: (runId: string, context: AssistantSessionTransportContext) => Promise<Run>;
  watch?: (run: Run, onEvent: (event: RunEvent) => void, context: AssistantSessionTransportContext) => Promise<{ settled: boolean }>;
  cancel?: (runId: string, expectedEpoch: number, idempotencyKey: string, context: AssistantSessionTransportContext) => Promise<Run>;
  continue: (runId: string, input: ResumeRun, idempotencyKey: string, context: AssistantSessionTransportContext) => Promise<Run>;
  recalculateFinance?: (input: FinanceRecalculateRequest, idempotencyKey: string, context: AssistantSessionTransportContext) => Promise<FinanceRecalculateResult>;
}

const authenticatedTransport: AssistantSessionTransport = {
  async latest(context) {
    const page = await runClient.list(context.workspaceId, { userId: context.userId, signal: context.signal }, undefined, context.projectId);
    return page.runs[0];
  },
  read: (runId, context) => runClient.read(runId, { userId: context.userId, signal: context.signal }),
  watch: (run, onEvent, context) => openRunEvents(run.id, run.cursor, onEvent, { userId: context.userId, signal: context.signal }),
  cancel: (runId, expectedEpoch, idempotencyKey, context) => runClient.cancel(runId, expectedEpoch, idempotencyKey, { userId: context.userId, signal: context.signal }),
  continue: (runId, input, idempotencyKey, context) => runClient.continue(runId, input, idempotencyKey, { userId: context.userId, signal: context.signal }),
  recalculateFinance: (input, idempotencyKey, context) => financeRecalculationClient(input, idempotencyKey, { userId: context.userId, signal: context.signal }),
};

export interface AssistantSessionProps {
  userId: string;
  workspaceId: string;
  projectId: string;
  initialRunId?: string;
  sessionPath?: string;
  empty?: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onRunChange?: (runId: string) => void;
  onRunData?: (run: Run | undefined) => void;
  onAccessLost?: () => void;
  transport?: AssistantSessionTransport;
  resultHref?: SessionResultHrefResolver;
  runHref?: (runId: string) => string;
  draftScopeKey?: string;
}

export function AssistantSession({ userId, workspaceId, projectId, initialRunId, sessionPath, empty, collapsed = false, onCollapsedChange, onRunChange, onRunData, onAccessLost, transport = authenticatedTransport, resultHref, runHref, draftScopeKey }: AssistantSessionProps) {
  const { locale } = useLocale();
  const text = assistantSessionCatalog[locale], runText = runCatalog[locale];
  const [runId, setRunId] = useState(initialRunId), [data, setData] = useState<Run>();
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(), [pending, setPending] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false), [reload, setReload] = useState(0);
  const command = useRef<{ kind: 'cancel' | 'resume'; epoch: number; stepId?: string; fingerprint: string; key: string } | undefined>(undefined);
  const dataRef = useRef<Run | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const handleFailure = useCallback((failure: unknown) => {
    if (failure instanceof DOMException && failure.name === 'AbortError') return;
    setError(failure);
    const status = failure && typeof failure === 'object' && 'status' in failure && typeof failure.status === 'number' ? failure.status : undefined;
    if ((failure instanceof RunClientError || status !== undefined) && status !== undefined && [401, 403, 404, 410].includes(status)) { setRevoked(true); onAccessLost?.(); }
  }, [onAccessLost]);

  useEffect(() => {
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, eventRefresh: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState === 'hidden') { timer = setTimeout(() => { void load(); }, 15_000); return; }
      if (!dataRef.current) setLoading(true);
      try {
        let next: Run | undefined;
        const requested = initialRunId ?? runId;
        const context = { userId, workspaceId, projectId, signal: lifetime.signal };
        if (requested) next = await transport.read(requested, context);
        else if (transport.latest) { next = await transport.latest(context); if (next) setRunId(next.id); }
        if (next && (next.workspaceId !== workspaceId || next.projectId !== projectId)) throw new RunClientError('FORBIDDEN', 403);
        if (!lifetime.signal.aborted) { dataRef.current = next; setData(next); onRunData?.(next); setError(undefined); setRevoked(false); if (next) onRunChange?.(next.id); }
        const active = next && ['queued', 'running'].includes(next.state);
        if (next && active && document.visibilityState === 'visible') {
          const events = transport.watch ? await transport.watch(next, () => {
            if (!eventRefresh) eventRefresh = setTimeout(() => { eventRefresh = undefined; setReload((value) => value + 1); }, 250);
          }, context) : { settled: false };
          if (events.settled && !eventRefresh) eventRefresh = setTimeout(() => { eventRefresh = undefined; setReload((value) => value + 1); }, 0);
          else timer = setTimeout(() => { void load(); }, 2000);
        } else timer = setTimeout(() => { void load(); }, 15_000);
      } catch (failure) {
        if (!lifetime.signal.aborted) { handleFailure(failure); timer = setTimeout(() => { void load(); }, 15_000); }
      } finally { if (!lifetime.signal.aborted) setLoading(false); }
    };
    void load();
    return () => { lifetime.abort(); clearTimeout(timer); clearTimeout(eventRefresh); };
  }, [initialRunId, runId, userId, workspaceId, projectId, reload, handleFailure, onRunChange, onRunData, transport]);

  async function mutate(kind: 'cancel' | 'resume', change: RunChange = {}, stepId?: string) {
    if (!data || pending) return;
    const fingerprint = JSON.stringify(change);
    if (!command.current || command.current.kind !== kind || command.current.epoch !== data.epoch || command.current.stepId !== stepId || command.current.fingerprint !== fingerprint) {
      command.current = { kind, epoch: data.epoch, ...(stepId ? { stepId } : {}), fingerprint, key: crypto.randomUUID() };
    }
    const intent = command.current;
    setPending(true); setError(undefined);
    try {
      const context = { userId, workspaceId, projectId };
      const next = kind === 'cancel'
        ? await transport.cancel!(data.id, intent.epoch, intent.key, context)
        : await transport.continue(data.id, { expectedEpoch: intent.epoch, ...change, ...(stepId ? { stepId } : {}) }, intent.key, context);
      if (next.workspaceId !== workspaceId || next.projectId !== projectId) throw new RunClientError('FORBIDDEN', 403);
      if (!mounted.current) return;
      try { sessionStorage.removeItem(`tirlik.run-session-draft.v1:${draftScopeKey ?? userId}:${data.id}`); } catch { /* The confirmed server state is authoritative. */ }
      dataRef.current = next; command.current = undefined; setCancelOpen(false); setData(next); onRunData?.(next); setRunId(next.id); onRunChange?.(next.id); setReload((value) => value + 1);
    } catch (failure) { if (mounted.current) handleFailure(failure); }
    finally { if (mounted.current) setPending(false); }
  }

  const collapsedRail = <aside className={styles.assistantCollapsed} aria-label={text.assistant} hidden={!collapsed}>
    <Bot aria-hidden="true" size={21} />
    <span>{data ? text.states[assistantSessionState(data)] : text.assistant}</span>
    <Button variant="quiet" icon={ChevronLeft} onClick={() => onCollapsedChange?.(false)}>{text.expand}</Button>
  </aside>;

  const state = assistantSessionState(data);
  const results = data ? sessionResults(data) : [];
  const workDecisionResultHrefs = data?.progress.workDecision ? sessionArtifactResultHrefs(data, data.progress.workDecision.options.flatMap((option) => option.artifactIds), resultHref) : {};
  const receipts = data?.steps.filter((step) => step.state !== 'planned') ?? [];
  const decisionConditions = data?.progress.questions.filter((question) => question.id.startsWith('accept_conditions_')) ?? [];
  const resultlessCompletion = Boolean(data && ['completed', 'review_ready'].includes(data.state) && results.length === 0);
  return <>{collapsedRail}<aside className={styles.assistantSession} aria-labelledby="assistant-session-title" hidden={collapsed}>
    <header className={styles.assistantHeading}>
      <div><span className={styles.assistantIdentity}><Bot size={19} aria-hidden="true" />{text.assistant}</span><strong id="assistant-session-title">{data ? text.states[state] : text.states.empty}</strong></div>
      <div className={styles.assistantHeaderActions}>{loading && data && <LoaderCircle className="tl-spin" size={18} aria-label={runText.refreshing} />}{onCollapsedChange && <Button variant="quiet" onClick={() => onCollapsedChange(true)}>{text.collapse}</Button>}</div>
      <span className="tirlik-sr-only" role="status" aria-live="polite">{data ? `${text.states[state]}. ${text.results}: ${results.length}` : text.states.empty}</span>
    </header>
    {loading && !data ? <LoadingState label={runText.loading} /> : !data && revoked ? <div className={styles.assistantEmpty}><span className={styles.assistantState} data-state="revoked">{text.states.revoked}</span><h2>{runText.errors.forbidden}</h2><Button icon={RefreshCw} onClick={() => setReload((value) => value + 1)}>{text.checkAgain}</Button></div> : !data ? <div className={styles.assistantEmpty}><h2>{text.emptyTitle}</h2><p>{text.emptyText}</p>{empty}</div> : <div className={styles.assistantBody}>
      <section className={styles.assistantGoal}><span className={styles.assistantState} data-state={state}>{text.states[state]}</span><h2>{data.goal}</h2>{data.progress.summary && <p>{data.progress.summary}</p>}</section>
      {error !== undefined && <div className={styles.sessionError} role="alert"><p>{runText.errors.unavailable}</p><Button icon={RefreshCw} onClick={() => setReload((value) => value + 1)}>{text.checkAgain}</Button></div>}
      {data.failure && <p className={styles.sessionNotice}>{runText.failures[data.failure]}</p>}
      {resultlessCompletion && <div className={styles.resultRequired} role="status"><strong>{text.resultRequired}</strong><p>{text.resultRequiredText}</p></div>}
      {data.progress.decision && <DecisionPanel decision={data.progress.decision} locale={locale} workspaceId={workspaceId} copy={text} context={{ projectId, runId: data.id }} canChoose={data.actions.resume && data.progress.decision.selectedOptionId === null} pending={pending} pendingConditions={decisionConditions} onChoose={(selectedOptionId) => { void mutate('resume', { selectedOptionId }); }} onAcceptConditions={(acceptedConditionIds) => { void mutate('resume', { acceptedConditionIds }); }} />}
      {data.progress.workDecision && <WorkDecisionPanel decision={data.progress.workDecision} locale={locale} resultHrefs={workDecisionResultHrefs} canChoose={data.actions.resume && data.progress.workDecision.selectedOptionId === null} pending={pending} onChoose={(selectedOptionId) => { void mutate('resume', { selectedOptionId }); }} />}
      {data.progress.workPreview && <WorkPreviewPanel key={`${data.id}:${data.progress.workPreview.editable.artifactId}:${data.progress.workPreview.editable.revision}`} run={data} preview={data.progress.workPreview} locale={locale} context={{ userId, workspaceId, projectId }} resultHref={resultHref} onFinanceRecalculate={transport.recalculateFinance} />}
      <RunContinuation key={`${data.id}:${data.epoch}`} run={data} locale={locale} pending={pending} draftOwnerId={draftScopeKey ?? userId} structuredDecision runHref={runHref ?? ((targetRunId) => `${sessionPath ?? `/app/projects/${projectId}`}?run=${targetRunId}`)} onContinue={(change) => { void mutate('resume', change); }} />
      {data.actions.resume && !data.progress.questions.length && !(data.progress.decision && data.progress.decision.selectedOptionId === null) && <div className={styles.sessionActions}><Button variant="primary" icon={Play} pending={pending} onClick={() => { void mutate('resume'); }}>{runText.resume}</Button></div>}
      {!!data.progress.branches?.length && <section className={styles.assistantBranches}><h3>{text.branches}</h3><ul>{data.progress.branches.map((branch) => <li key={branch.id}><div><strong>{branch.title}</strong><span data-state={branch.state}>{text.branchStates[branch.state]}</span></div>{branch.resultRefs.length > 0 && <div className={styles.branchResults}>{branch.resultRefs.map((result) => { const href = sessionResultHref(data, result, resultHref); const title = data.progress.results.find((item) => item.kind === result.kind && item.id === result.id)?.title ?? runText[result.kind]; return href ? <Link key={`${result.kind}:${result.id}:${result.revision ?? ''}`} href={href}>{title}<ArrowUpRight size={14} aria-hidden="true" /></Link> : <span key={`${result.kind}:${result.id}:${result.revision ?? ''}`}>{title}</span>; })}</div>}</li>)}</ul></section>}
      {receipts.length > 0 && <section className={styles.assistantReceipts}><h3>{text.activity}</h3><ol>{receipts.map((step) => { const Icon = actionIcons[step.state]; return <li key={step.id}><Icon aria-hidden="true" size={17} className={step.state === 'claimed' ? 'tl-spin' : undefined} /><span><strong>{runText.actions[step.action]}</strong><small>{runText.stepStates[step.state]}</small></span>{data.actions.retryStepIds.includes(step.id) && <Button variant="quiet" icon={RefreshCw} pending={pending} onClick={() => { void mutate('resume', {}, step.id); }}>{runText.retryStep}</Button>}</li>; })}</ol></section>}
      <section className={styles.assistantResults}><h3>{text.results}</h3>{results.length ? <ul>{results.map((result) => { const href = sessionResultHref(data, result, resultHref); const title = data.progress.results.find((item) => item.kind === result.kind && item.id === result.id)?.title ?? runText[result.kind]; return <li key={`${result.kind}:${result.id}:${result.revision ?? ''}`}>{href ? <Link href={href}>{result.kind === 'artifact' ? <FileText size={18} aria-hidden="true" /> : null}<span>{title}</span><ArrowUpRight size={16} aria-hidden="true" /></Link> : <span>{title}</span>}</li>; })}</ul> : <p>{text.noResults}</p>}</section>
      <details className={styles.technicalDetails}><summary>{text.technical}</summary><dl><div><dt>{runText.spent}</dt><dd>{formatDecimal(locale, data.budget.spentUsd)} {runText.dollars}</dd></div><div><dt>{runText.reserved}</dt><dd>{formatDecimal(locale, data.budget.reservedUsd)} {runText.dollars}</dd></div></dl><Link href={(runHref ?? ((targetRunId) => `/app/runs/${targetRunId}`))(data.id)}>{text.fullActivity}<ArrowUpRight size={15} aria-hidden="true" /></Link></details>
      <div className={styles.sessionActions}>{data.actions.cancel && transport.cancel && <Button icon={Square} disabled={pending} onClick={() => setCancelOpen(true)}>{text.stop}</Button>}</div>
      <Dialog open={cancelOpen} onOpenChange={(open) => { if (!pending) setCancelOpen(open); }} title={text.stopTitle} description={text.stopText} footer={<><DialogClose disabled={pending}>{text.keepWorking}</DialogClose><Button variant="danger" icon={Square} pending={pending} onClick={() => { void mutate('cancel'); }}>{text.stop}</Button></>}><p>{data.goal}</p></Dialog>
    </div>}
  </aside></>;
}
