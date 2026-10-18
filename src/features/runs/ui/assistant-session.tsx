'use client';

import Link from 'next/link';
import { ArrowUpRight, Bot, Check, ChevronLeft, Circle, FileText, LoaderCircle, Play, RefreshCw, Square, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResumeRun, Run, RunEvent } from '@/contracts/runs';
import type { FinanceRecalculateRequest, FinanceRecalculateResult } from '@/features/finance/contracts';
import { financeRecalculationClient } from '@/features/finance/client/recalculation';
import { useLocale } from '@/i18n/provider';
import { Button, Dialog, DialogClose, LoadingState } from '@/ui';
import { runClient, RunClientError } from '../client/transport';
import { runErrorText } from '../client/state';
import { openRunEvents } from '../client/events';
import { runCatalog, assistantSessionCatalog } from '../locales';
import { RunContinuation, RunFollowupComposer, runAnswerDraftKey, runFollowupDraftKey, type RunChange } from './run-continuation';
import { assistantSessionState, followupComposerState, sessionArtifactResultHrefs, sessionConversationTurns, sessionFailureMessage, sessionResultHref, sessionResults, showGenericResume, type SessionResultHrefResolver } from './session-state';
import { DecisionPanel } from './decision-panel';
import { WorkDecisionPanel } from '@/features/campaigns/ui/work-decision-panel';
import { WorkPreviewPanel } from './work-preview-panel';
import styles from './runs.module.css';

const actionIcons = { planned: Circle, claimed: LoaderCircle, succeeded: Check, failed: XCircle, skipped: Square } as const;

const HISTORY_PAGE_SIZE = 3;
const HISTORY_LIMIT = 12;
const historyCatalog = {
  ru: { heading: 'Предыдущие сообщения', you: 'Вы', assistant: 'Тірлік', results: 'Материалы', loadEarlier: 'Показать более ранние', loading: 'Загружаем…', unavailable: 'Не удалось загрузить более ранние сообщения.', missingPrompt: 'Ассистент остановился, но не сохранил вопрос или доступное действие. Обновите задачу.', retry: 'Повторить' },
  kk: { heading: 'Алдыңғы хабарламалар', you: 'Сіз', assistant: 'Тірлік', results: 'Материалдар', loadEarlier: 'Ертерек хабарламаларды көрсету', loading: 'Жүктелуде…', unavailable: 'Ертерек хабарламалар жүктелмеді.', missingPrompt: 'Ассистент тоқтады, бірақ сұрақты немесе қолжетімді әрекетті сақтамады. Тапсырманы жаңартыңыз.', retry: 'Қайталау' },
  en: { heading: 'Earlier messages', you: 'You', assistant: 'Tirlik', results: 'Materials', loadEarlier: 'Show earlier messages', loading: 'Loading…', unavailable: 'Earlier messages could not be loaded.', missingPrompt: 'The assistant stopped without saving a question or an available action. Refresh the task.', retry: 'Try again' },
} as const;

interface AssistantHistoryState {
  activeRunId?: string;
  runs: Run[];
  nextParentRunId: string | null;
  loading: boolean;
  unavailable: boolean;
}

const emptyHistory = (): AssistantHistoryState => ({ runs: [], nextParentRunId: null, loading: false, unavailable: false });

function failureStatus(failure: unknown) {
  return failure && typeof failure === 'object' && 'status' in failure && typeof failure.status === 'number' ? failure.status : undefined;
}

async function readAncestorPage(startParentRunId: string, limit: number, seenRunIds: ReadonlySet<string>, transport: AssistantSessionTransport, context: AssistantSessionTransportContext) {
  const nearestFirst: Run[] = [], seen = new Set(seenRunIds);
  let parentRunId: string | null = startParentRunId;
  while (parentRunId && nearestFirst.length < limit && seen.size < HISTORY_LIMIT + 1) {
    if (seen.has(parentRunId)) return { runs: nearestFirst, nextParentRunId: null };
    seen.add(parentRunId);
    try {
      const ancestor: Run = await transport.read(parentRunId, context);
      if (ancestor.id !== parentRunId || ancestor.workspaceId !== context.workspaceId || ancestor.projectId !== context.projectId) throw new RunClientError('FORBIDDEN', 403);
      nearestFirst.push(ancestor);
      parentRunId = ancestor.progress.parentRunId;
    } catch (failure) {
      if (failureStatus(failure) === 404) return { runs: nearestFirst, nextParentRunId: null };
      throw failure;
    }
  }
  return { runs: nearestFirst, nextParentRunId: parentRunId };
}

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
  currentArtifactId?: string;
  prepareCurrentArtifact?: () => Promise<ResumeRun['currentArtifact'] | null>;
}

export function AssistantSession({ userId, workspaceId, projectId, initialRunId, sessionPath, empty, collapsed = false, onCollapsedChange, onRunChange, onRunData, onAccessLost, transport = authenticatedTransport, resultHref, runHref, draftScopeKey, currentArtifactId, prepareCurrentArtifact }: AssistantSessionProps) {
  const { locale } = useLocale();
  const text = assistantSessionCatalog[locale], runText = runCatalog[locale], historyText = historyCatalog[locale];
  const [runId, setRunId] = useState(initialRunId), [data, setData] = useState<Run>();
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(), [pending, setPending] = useState(false);
  const [commandError, setCommandError] = useState<unknown>();
  const [revoked, setRevoked] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false), [reload, setReload] = useState(0);
  const [history, setHistory] = useState<AssistantHistoryState>(emptyHistory);
  const [historyReload, setHistoryReload] = useState(0);
  const [liveEvent, setLiveEvent] = useState<RunEvent>();
  const command = useRef<{ kind: 'cancel' | 'resume'; epoch: number; stepId?: string; followup: boolean; fingerprint: string; key: string; input?: ResumeRun } | undefined>(undefined);
  const dataRef = useRef<Run | undefined>(undefined);
  const historyRequest = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; historyRequest.current?.abort(); };
  }, []);

  const clearPrivateData = useCallback(() => {
    historyRequest.current?.abort();
    command.current = undefined;
    dataRef.current = undefined;
    setData(undefined);
    setHistory(emptyHistory());
    setCommandError(undefined);
    setCancelOpen(false);
    onRunData?.(undefined);
    setRevoked(true);
    onAccessLost?.();
  }, [onAccessLost, onRunData]);

  const handleFailure = useCallback((failure: unknown, surface = true) => {
    if (failure instanceof DOMException && failure.name === 'AbortError') return;
    const status = failureStatus(failure);
    if ((failure instanceof RunClientError || status !== undefined) && status !== undefined && [401, 403, 404, 410].includes(status)) { clearPrivateData(); return; }
    if (surface) setError(failure);
  }, [clearPrivateData]);

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
        if (!lifetime.signal.aborted) {
          if (dataRef.current?.id !== next?.id) { historyRequest.current?.abort(); setHistory(emptyHistory()); }
          dataRef.current = next; setData(next); onRunData?.(next); setError(undefined); setRevoked(false); if (next) onRunChange?.(next.id);
        }
        const active = next && ['queued', 'running'].includes(next.state);
        if (next && active && document.visibilityState === 'visible') {
          const events = transport.watch ? await transport.watch(next, (event) => {
            setLiveEvent((current) => current?.runId === event.runId && current.sequence >= event.sequence ? current : event);
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

  const activeHistoryRunId = data?.id, activeParentRunId = data?.progress.parentRunId;
  useEffect(() => {
    const lifetime = new AbortController();
    historyRequest.current?.abort();
    historyRequest.current = lifetime;
    if (!activeHistoryRunId || !activeParentRunId) return () => lifetime.abort();
    const load = async () => {
      setHistory({ activeRunId: activeHistoryRunId, runs: [], nextParentRunId: activeParentRunId, loading: true, unavailable: false });
      try {
        const page = await readAncestorPage(activeParentRunId, HISTORY_PAGE_SIZE, new Set([activeHistoryRunId]), transport, { userId, workspaceId, projectId, signal: lifetime.signal });
        if (!lifetime.signal.aborted && dataRef.current?.id === activeHistoryRunId) setHistory({ activeRunId: activeHistoryRunId, runs: page.runs.reverse(), nextParentRunId: page.nextParentRunId, loading: false, unavailable: false });
      } catch (failure) {
        if (lifetime.signal.aborted) return;
        const status = failureStatus(failure);
        if (status !== undefined && [401, 403, 410].includes(status)) clearPrivateData();
        else if (dataRef.current?.id === activeHistoryRunId) setHistory({ activeRunId: activeHistoryRunId, runs: [], nextParentRunId: activeParentRunId, loading: false, unavailable: true });
      }
    };
    void load();
    return () => lifetime.abort();
  }, [activeHistoryRunId, activeParentRunId, userId, workspaceId, projectId, transport, historyReload, clearPrivateData]);

  async function loadEarlierHistory() {
    if (!data || history.activeRunId !== data.id || !history.nextParentRunId || history.loading || history.runs.length >= HISTORY_LIMIT) return;
    const activeRunId = data.id, nextParentRunId = history.nextParentRunId;
    const lifetime = new AbortController();
    historyRequest.current?.abort();
    historyRequest.current = lifetime;
    setHistory((current) => current.activeRunId === activeRunId ? { ...current, loading: true, unavailable: false } : current);
    try {
      const remaining = HISTORY_LIMIT - history.runs.length;
      const page = await readAncestorPage(nextParentRunId, Math.min(HISTORY_PAGE_SIZE, remaining), new Set([activeRunId, ...history.runs.map((run) => run.id)]), transport, { userId, workspaceId, projectId, signal: lifetime.signal });
      if (!lifetime.signal.aborted && mounted.current && dataRef.current?.id === activeRunId) setHistory((current) => current.activeRunId === activeRunId ? { ...current, runs: [...page.runs.reverse(), ...current.runs], nextParentRunId: page.nextParentRunId, loading: false, unavailable: false } : current);
    } catch (failure) {
      if (lifetime.signal.aborted) return;
      const status = failureStatus(failure);
      if (status !== undefined && [401, 403, 410].includes(status)) clearPrivateData();
      else if (mounted.current && dataRef.current?.id === activeRunId) setHistory((current) => current.activeRunId === activeRunId ? { ...current, loading: false, unavailable: true } : current);
    }
  }

  async function mutate(kind: 'cancel' | 'resume', change: RunChange = {}, stepId?: string, followup = false) {
    if (!data || pending) return;
    const fingerprint = JSON.stringify({ change, followup });
    if (!command.current || command.current.kind !== kind || command.current.epoch !== data.epoch || command.current.stepId !== stepId || command.current.fingerprint !== fingerprint) {
      command.current = { kind, epoch: data.epoch, ...(stepId ? { stepId } : {}), followup, fingerprint, key: crypto.randomUUID() };
    }
    const intent = command.current;
    setPending(true); setCommandError(undefined);
    try {
      const context = { userId, workspaceId, projectId };
      if (kind === 'resume' && !intent.input) {
        const currentArtifact = followup && prepareCurrentArtifact ? await prepareCurrentArtifact() : undefined;
        if (followup && prepareCurrentArtifact && !currentArtifact) throw new RunClientError('CONFLICT', 409);
        intent.input = { expectedEpoch: intent.epoch, ...change, ...(stepId ? { stepId } : {}), ...(currentArtifact ? { currentArtifact } : {}) };
      }
      const next = kind === 'cancel'
        ? await transport.cancel!(data.id, intent.epoch, intent.key, context)
        : await transport.continue(data.id, intent.input!, intent.key, context);
      if (next.workspaceId !== workspaceId || next.projectId !== projectId) throw new RunClientError('FORBIDDEN', 403);
      if (!mounted.current) return;
      try {
        const owner = draftScopeKey ?? userId;
        sessionStorage.removeItem(runAnswerDraftKey(owner, data.id));
        sessionStorage.removeItem(`tirlik.run-session-draft.v1:${owner}:${data.id}`);
        if (followup) sessionStorage.removeItem(runFollowupDraftKey(owner, data.id, currentArtifactId));
      } catch { /* The confirmed server state is authoritative. */ }
      historyRequest.current?.abort(); setHistory(emptyHistory());
      dataRef.current = next; command.current = undefined; setCommandError(undefined); setCancelOpen(false); setData(next); onRunData?.(next); setRunId(next.id); onRunChange?.(next.id); setReload((value) => value + 1);
    } catch (failure) {
      if (mounted.current) {
        if (failure instanceof RunClientError && failure.status === 409) { command.current = undefined; setReload((value) => value + 1); }
        setCommandError(failure); handleFailure(failure, false);
      }
    }
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
  const visibleLiveEvent = data && liveEvent?.runId === data.id ? liveEvent : undefined;
  const liveAction = visibleLiveEvent?.action ? runText.actions[visibleLiveEvent.action] : visibleLiveEvent ? runText.states[visibleLiveEvent.state] : undefined;
  const liveState = visibleLiveEvent?.stepState ? runText.stepStates[visibleLiveEvent.stepState] : visibleLiveEvent ? runText.states[visibleLiveEvent.state] : undefined;
  const retryStepId = data?.actions.retryStepIds[0];
  const canStop = Boolean(data?.actions.cancel && transport.cancel && (data.state === 'queued' || data.state === 'running'));
  const hasActivity = Boolean(data && (data.progress.plan.length || data.progress.branches?.length || receipts.length));
  const composerState = followupComposerState(data);
  const missingDecisionPrompt = Boolean(data?.state === 'waiting_input' && !data.failure && !data.actions.resume && data.progress.questions.length === 0 && data.progress.decision?.selectedOptionId !== null && data.progress.workDecision?.selectedOptionId !== null);
  return <>{collapsedRail}<aside className={styles.assistantSession} aria-labelledby="assistant-session-title" hidden={collapsed}>
    <header className={styles.assistantHeading}>
      <div><span className={styles.assistantIdentity}><Bot size={19} aria-hidden="true" />{text.assistant}</span><strong id="assistant-session-title">{data ? text.states[state] : text.states.empty}</strong></div>
      <div className={styles.assistantHeaderActions}>{loading && data && <LoaderCircle className="tl-spin" size={18} aria-label={runText.refreshing} />}{onCollapsedChange && <Button variant="quiet" onClick={() => onCollapsedChange(true)}>{text.collapse}</Button>}</div>
      <span className="tirlik-sr-only" role="status" aria-live="polite">{data ? `${text.states[state]}. ${text.results}: ${results.length}` : text.states.empty}</span>
    </header>
    {loading && !data ? <LoadingState label={runText.loading} /> : !data && revoked ? <div className={styles.assistantEmpty}><span className={styles.assistantState} data-state="revoked">{text.states.revoked}</span><h2>{runText.errors.forbidden}</h2><Button icon={RefreshCw} onClick={() => setReload((value) => value + 1)}>{text.checkAgain}</Button></div> : !data ? <div className={styles.assistantEmpty}><h2>{text.emptyTitle}</h2><p>{text.emptyText}</p>{empty}</div> : <div className={styles.assistantBody}>
      {history.activeRunId === data.id && (history.runs.length > 0 || history.loading || history.unavailable) && <section className={styles.assistantHistory} aria-labelledby="assistant-history-title">
        <h3 id="assistant-history-title">{historyText.heading}</h3>
        {history.runs.map((pastRun) => {
          const pastState = assistantSessionState(pastRun), pastResults = sessionResults(pastRun);
          return <article className={styles.historyTurn} key={pastRun.id}>
            {sessionConversationTurns(pastRun).map((turn) => <div className={turn.role === 'user' ? styles.historyUser : styles.historyAssistant} key={turn.key}><span>{turn.role === 'user' ? historyText.you : historyText.assistant}</span><p>{turn.content}</p></div>)}
            <div className={styles.historyAssistant}><span>{historyText.assistant}</span><strong>{text.states[pastState]}</strong>{pastRun.progress.summary && <p>{pastRun.progress.summary}</p>}{pastRun.failure && <p>{sessionFailureMessage(pastRun, runText.failures, text.failureWithoutResults)}</p>}
              {pastResults.length > 0 && <div className={styles.historyResults}><small>{historyText.results}</small>{pastResults.map((result) => { const href = sessionResultHref(pastRun, result, resultHref); const title = pastRun.progress.results.find((item) => item.kind === result.kind && item.id === result.id)?.title ?? runText[result.kind]; return href ? <Link key={`${result.kind}:${result.id}:${result.revision ?? ''}`} href={href}>{title}<ArrowUpRight size={13} aria-hidden="true" /></Link> : <span key={`${result.kind}:${result.id}:${result.revision ?? ''}`}>{title}</span>; })}</div>}
            </div>
          </article>;
        })}
        {history.unavailable && <div className={styles.historyNotice} role="status"><span>{historyText.unavailable}</span><Button variant="quiet" icon={RefreshCw} onClick={() => setHistoryReload((value) => value + 1)}>{historyText.retry}</Button></div>}
        {history.nextParentRunId && history.runs.length < HISTORY_LIMIT && !history.unavailable && <Button className={styles.historyLoad} variant="quiet" pending={history.loading} onClick={() => { void loadEarlierHistory(); }}>{history.loading ? historyText.loading : historyText.loadEarlier}</Button>}
      </section>}
      <article className={styles.currentTurn}>
        {sessionConversationTurns(data).map((turn) => <div className={turn.role === 'user' ? styles.historyUser : styles.historyAssistant} key={turn.key}><span>{turn.role === 'user' ? historyText.you : historyText.assistant}</span><p>{turn.content}</p></div>)}
        <div className={`${styles.historyAssistant} ${styles.currentAssistant}`}><span>{historyText.assistant}</span><strong><span className={styles.assistantState} data-state={state}>{text.states[state]}</span></strong>
          {data.progress.summary && <p className={styles.resultSummary}>{data.progress.summary}</p>}
          {error !== undefined && <div className={styles.sessionError} role="alert"><p>{runText.errors.unavailable}</p><Button icon={RefreshCw} onClick={() => setReload((value) => value + 1)}>{text.checkAgain}</Button></div>}
          {data.failure && <p className={styles.sessionNotice}>{sessionFailureMessage(data, runText.failures, text.failureWithoutResults)}</p>}
          {missingDecisionPrompt && <div className={styles.sessionError} role="alert"><p>{historyText.missingPrompt}</p><Button icon={RefreshCw} onClick={() => setReload((value) => value + 1)}>{historyText.retry}</Button></div>}
          {visibleLiveEvent && liveAction && liveState && <div className={styles.liveActivity} role="status" aria-live="polite">{visibleLiveEvent.stepState === 'claimed' || visibleLiveEvent.state === 'queued' || visibleLiveEvent.state === 'running' ? <LoaderCircle className="tl-spin" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}<span><strong>{liveAction}</strong><small>{liveState}</small></span></div>}
          {resultlessCompletion && <div className={styles.resultRequired} role="status"><strong>{text.resultRequired}</strong><p>{text.resultRequiredText}</p></div>}
          {data.progress.decision && <DecisionPanel decision={data.progress.decision} locale={locale} workspaceId={workspaceId} copy={text} context={{ projectId, runId: data.id }} canChoose={data.actions.resume && data.progress.decision.selectedOptionId === null} pending={pending} pendingConditions={decisionConditions} onChoose={(selectedOptionId) => { void mutate('resume', { selectedOptionId }); }} onAcceptConditions={(acceptedConditionIds) => { void mutate('resume', { acceptedConditionIds }); }} />}
          {data.progress.workDecision && <WorkDecisionPanel decision={data.progress.workDecision} locale={locale} resultHrefs={workDecisionResultHrefs} canChoose={data.actions.resume && data.progress.workDecision.selectedOptionId === null} pending={pending} onChoose={(selectedOptionId) => { void mutate('resume', { selectedOptionId }); }} />}
          {data.progress.workPreview && <WorkPreviewPanel key={`${data.id}:${data.progress.workPreview.editable.artifactId}:${data.progress.workPreview.editable.revision}`} run={data} preview={data.progress.workPreview} locale={locale} context={{ userId, workspaceId, projectId }} resultHref={resultHref} onFinanceRecalculate={transport.recalculateFinance} />}
          <RunContinuation key={`${data.id}:${data.epoch}`} run={data} locale={locale} pending={pending} draftOwnerId={draftScopeKey ?? userId} structuredDecision compact runHref={runHref ?? ((targetRunId) => `${sessionPath ?? `/app/projects/${projectId}`}?run=${targetRunId}`)} onRefresh={() => setReload((value) => value + 1)} onContinue={(change) => { void mutate('resume', change); }} />
          {results.length > 0 && <div className={styles.turnResults}><small>{text.results}</small>{results.map((result) => { const href = sessionResultHref(data, result, resultHref); const title = data.progress.results.find((item) => item.kind === result.kind && item.id === result.id)?.title ?? runText[result.kind]; return href ? <Link key={`${result.kind}:${result.id}:${result.revision ?? ''}`} href={href}>{result.kind === 'artifact' ? <FileText size={16} aria-hidden="true" /> : null}{title}<ArrowUpRight size={14} aria-hidden="true" /></Link> : <span key={`${result.kind}:${result.id}:${result.revision ?? ''}`}>{title}</span>; })}</div>}
          {data.failure && retryStepId && <div className={styles.sessionActions}><Button variant="primary" icon={RefreshCw} pending={pending} onClick={() => { void mutate('resume', {}, retryStepId); }}>{runText.retryStep}</Button></div>}
          {showGenericResume(data) && <div className={styles.sessionActions}><Button variant="primary" icon={Play} pending={pending} onClick={() => { void mutate('resume'); }}>{runText.resume}</Button></div>}
          {hasActivity && <details className={styles.activityDisclosure}><summary>{text.activity}</summary><div>
            {!!data.progress.plan.length && <section className={styles.assistantPlan}><h3>{text.plan}</h3><ol>{data.progress.plan.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol></section>}
            {!!data.progress.branches?.length && <section className={styles.assistantBranches}><h3>{text.branches}</h3><ul>{data.progress.branches.map((branch) => <li key={branch.id}><div><strong>{branch.title}</strong><span data-state={branch.state}>{text.branchStates[branch.state]}</span></div>{branch.resultRefs.length > 0 && <div className={styles.branchResults}>{branch.resultRefs.map((result) => { const href = sessionResultHref(data, result, resultHref); const title = data.progress.results.find((item) => item.kind === result.kind && item.id === result.id)?.title ?? runText[result.kind]; return href ? <Link key={`${result.kind}:${result.id}:${result.revision ?? ''}`} href={href}>{title}<ArrowUpRight size={14} aria-hidden="true" /></Link> : <span key={`${result.kind}:${result.id}:${result.revision ?? ''}`}>{title}</span>; })}</div>}</li>)}</ul></section>}
            {receipts.length > 0 && <section className={styles.assistantReceipts}><ol>{receipts.map((step) => { const Icon = actionIcons[step.state]; return <li key={step.id}><Icon aria-hidden="true" size={17} className={step.state === 'claimed' ? 'tl-spin' : undefined} /><span><strong>{runText.actions[step.action]}</strong><small>{runText.stepStates[step.state]}</small></span>{data.actions.retryStepIds.includes(step.id) && <Button variant="quiet" icon={RefreshCw} pending={pending} onClick={() => { void mutate('resume', {}, step.id); }}>{runText.retryStep}</Button>}</li>; })}</ol></section>}
          </div></details>}
          {canStop && <div className={styles.sessionActions}><Button icon={Square} disabled={pending} onClick={() => setCancelOpen(true)}>{text.stop}</Button></div>}
        </div>
      </article>
      <Dialog open={cancelOpen} onOpenChange={(open) => { if (!pending) setCancelOpen(open); }} title={text.stopTitle} description={text.stopText} footer={<><DialogClose disabled={pending}>{text.keepWorking}</DialogClose><Button variant="danger" icon={Square} pending={pending} onClick={() => { void mutate('cancel'); }}>{text.stop}</Button></>}><p>{data.goal}</p></Dialog>
    </div>}
    {data && composerState !== 'hidden' && <RunFollowupComposer key={`${data.id}:${currentArtifactId ?? 'none'}`} run={data} locale={locale} pending={pending} disabled={composerState === 'disabled'} draftOwnerId={draftScopeKey ?? userId} artifactId={currentArtifactId} error={commandError === undefined ? undefined : runErrorText(commandError, runText)} onContinue={(change) => { void mutate('resume', change, undefined, true); }} />}
  </aside></>;
}
