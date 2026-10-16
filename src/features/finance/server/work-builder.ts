import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  BusinessWorkResultSchema,
  BuildFinanceWorkInputSchema,
  BuildProcurementWorkInputSchema,
  ForecastInputSchema,
  ForecastRunSchema,
  WorkExecutionContextSchema,
  type BuildFinanceWorkInput,
  type BuildProcurementWorkInput,
  type BusinessWorkResult,
  type BusinessWorkToolDescriptor,
  type ForecastInput,
  type WorkExecutionContext,
} from '@/contracts/business-work';
import type { BusinessWorkPreview } from '@/contracts/work-preview';
import type { SourceRef } from '@/contracts/artifacts';
import type { DatasetPage, DatasetQuery } from '@/contracts/materials';
import { FinanceAnalysisInputSchema } from '../contracts';
import { analyzeFinance } from '../domain/analyze-finance';
import { buildFinanceArtifacts } from '../domain/artifact-builders';
import { normalizeFinanceRecords, normalizeFinanceScenarios } from './normalization';
import { createDatasetService } from '@/features/materials/server/datasets';
import { createMaterialFactReader } from '@/features/materials/server/facts';
import { createArtifactService } from '@/features/artifacts/server/service';
import { identityTransaction, type IdentityPrincipal } from '@/features/identity/server/access';
import type { ArtifactContent } from '@/features/artifacts/domain/content-models';
import { normalizeForecastSeries } from '@/features/forecast/server/normalization';
import { runForecast } from '@/features/forecast/domain/run-forecast';
import { buildForecastArtifacts } from '@/features/forecast/domain/artifact-builders';
import { normalizeProcurementFacts } from '@/features/procurement/server/normalization';
import { compareSuppliers } from '@/features/procurement/domain/compare-suppliers';
import { buildProcurementArtifacts } from '@/features/procurement/domain/artifact-builders';

const ForecastBusinessWorkResultSchema = BusinessWorkResultSchema.extend({ forecast: ForecastRunSchema });
export type ForecastBusinessWorkResult = z.infer<typeof ForecastBusinessWorkResultSchema>;

type Finding = { code: string; targetIds: string[]; sourceRefs: SourceRef[] };
type ArtifactDraft = { title: string; content: ArtifactContent; sourceRefs: SourceRef[] };
export interface BusinessWorkBuilderOptions {
  principalForContext?: (context: WorkExecutionContext) => IdentityPrincipal;
  now?: () => Date;
}

function editablePreviewRef(saved: Awaited<ReturnType<ReturnType<typeof createArtifactService>['create']>>[]) {
  const workbook = saved[0];
  if (!workbook) throw new Error('BUSINESS_WORK_PREVIEW_ARTIFACT_MISSING');
  return { artifactId: workbook.artifact.id, revision: workbook.version.revision };
}

function roundRobin<T>(groups: readonly (readonly T[])[], limit: number) {
  const selected: T[] = [];
  for (let offset = 0; selected.length < limit; offset++) {
    let found = false;
    for (const group of groups) {
      if (group[offset] === undefined) continue;
      selected.push(group[offset]!); found = true;
      if (selected.length === limit) break;
    }
    if (!found) break;
  }
  return selected;
}

function alignedSample(length: number, limit: number) {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  return [...new Set(Array.from({ length: limit }, (_, index) => Math.round((index * (length - 1)) / (limit - 1))))];
}

function financePreview(input: ReturnType<typeof FinanceAnalysisInputSchema.parse>, result: ReturnType<typeof analyzeFinance>, saved: Awaited<ReturnType<ReturnType<typeof createArtifactService>['create']>>[]): BusinessWorkPreview {
  const assumptions = roundRobin(input.scenarios.map((scenario) => scenario.assumptions.map((item) => ({
    scenarioId: scenario.id, id: item.id, title: item.title.slice(0, 160), effectiveOn: item.effectiveOn,
    direction: item.direction, amountMinorUnits: item.amount?.minorUnits ?? null, confirmed: item.confirmed,
  }))), 12);
  const calendar = roundRobin(result.scenarios.map((scenario) => scenario.calendar.map((row) => ({
    scenarioId: scenario.id, date: row.date, knownInflowsMinorUnits: row.knownInflowsMinorUnits,
    knownOutflowsMinorUnits: row.knownOutflowsMinorUnits, closingBalanceMinorUnits: row.closingBalanceMinorUnits,
    unknownCount: row.unknownItemIds.length,
  }))), 24);
  return {
    kind: 'finance', editable: editablePreviewRef(saved), currency: result.currency, period: result.period,
    scenarios: result.scenarios.map((scenario) => ({
      id: scenario.id, title: scenario.title, accounting: scenario.accounting,
      knownIncomeMinorUnits: scenario.knownIncomeMinorUnits, knownExpenseMinorUnits: scenario.knownExpenseMinorUnits,
      knownResultMinorUnits: scenario.knownResultMinorUnits, closingBalanceMinorUnits: scenario.closingBalanceMinorUnits,
      minimumBalanceMinorUnits: scenario.minimumBalanceMinorUnits, unknownCount: scenario.unknownItemIds.length,
    })),
    assumptions, assumptionCount: input.scenarios.reduce((count, scenario) => count + scenario.assumptions.length, 0),
    calendar, calendarRowCount: result.scenarios.reduce((count, scenario) => count + scenario.calendar.length, 0),
  };
}

function forecastPreview(series: ReturnType<typeof normalizeForecastSeries>['series'], run: ReturnType<typeof runForecast>, saved: Awaited<ReturnType<ReturnType<typeof createArtifactService>['create']>>[]): BusinessWorkPreview {
  const indexes = alignedSample(run.points.length, 36);
  return {
    kind: 'forecast', editable: editablePreviewRef(saved), target: series.target, aggregation: series.aggregation, coverage: series.coverage,
    eligibility: run.eligibility, modelFamily: run.model.family, backtestMetrics: run.backtest.metrics,
    baseline: run.baseline, interval: run.interval,
    points: indexes.map((index) => ({ ...run.points[index]!, lower: run.ranges[index]!.lower, upper: run.ranges[index]!.upper })),
    pointCount: run.points.length, folds: run.backtest.folds.slice(-8), foldCount: run.backtest.folds.length,
  };
}

function procurementPreview(result: ReturnType<typeof compareSuppliers>, saved: Awaited<ReturnType<ReturnType<typeof createArtifactService>['create']>>[]): BusinessWorkPreview {
  const recommended = new Set(result.recommendedOfferIds);
  const candidates = [...result.candidates].sort((left, right) => Number(recommended.has(right.offerId)) - Number(recommended.has(left.offerId)) || Number(right.eligible) - Number(left.eligible)).slice(0, 12);
  return {
    kind: 'procurement', editable: editablePreviewRef(saved), currency: result.currency, candidateCount: result.candidates.length,
    candidates: candidates.map((candidate) => ({
      offerId: candidate.offerId, needId: candidate.needId, supplierName: candidate.supplierName,
      netRequired: candidate.netRequired, unit: candidate.unit, packs: candidate.packs,
      knownTotalMinorUnits: candidate.knownTotalMinorUnits, leadDays: candidate.leadDays, arrivesOn: candidate.arrivesOn,
      paymentTerms: candidate.paymentTerms?.slice(0, 240) ?? null, complete: candidate.complete, eligible: candidate.eligible, missing: candidate.missing,
    })),
    draftOrder: {
      status: result.draftOrder.status, destination: result.draftOrder.destination, lineCount: result.draftOrder.lines.length,
      lines: result.draftOrder.lines.slice(0, 12).map((line) => ({
        needId: line.needId, offerId: line.offerId, description: line.description.slice(0, 500), supplierName: line.supplierName,
        packs: line.packs, deliveredQuantity: line.deliveredQuantity, knownTotal: line.knownTotal,
        arrivesOn: line.arrivesOn, paymentTerms: line.paymentTerms.slice(0, 240),
      })),
      unresolvedNeedIds: result.draftOrder.unresolvedNeedIds.slice(0, 20), unresolvedCount: result.draftOrder.unresolvedNeedIds.length,
      externalAction: 'none',
    },
  };
}

function derivedOperationId(parent: string, label: string) {
  const bytes = createHash('sha256').update(`${parent}\0${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sourceKey = (ref: SourceRef) => `${ref.sourceId}/${ref.revision}`;
const sourceRefKey = (ref: SourceRef) => [ref.sourceId, ref.sourceVersionId, ref.revision, ref.fragmentId ?? '', ref.collectionId ?? '', ref.recordId ?? '', ref.fieldId ?? '', ref.factRevision ?? ''].join('|');
function uniqueFindings(findings: Finding[]) {
  return [...new Map(findings.map((finding) => [`${finding.code}|${finding.targetIds.join(',')}|${finding.sourceRefs.map(sourceRefKey).join(',')}`, finding])).values()];
}

function assertAllowedSources(context: WorkExecutionContext, refs: SourceRef[]) {
  const allowed = new Set(context.allowedInputRefs.filter((ref) => ref.kind === 'source').map((ref) => `${ref.id}/${ref.revision}`));
  if (refs.some((ref) => !allowed.has(sourceKey(ref)))) throw new Error('BUSINESS_WORK_INPUT_NOT_ALLOWED');
}

function defaultPrincipal(context: WorkExecutionContext): IdentityPrincipal {
  if (context.authority.kind !== 'user') throw new Error('BUSINESS_WORK_DEMO_PRINCIPAL_REQUIRED');
  return { kind: 'job', userId: context.authority.userId, authzVersion: context.expectedAuthzVersion };
}

function localDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function createFinanceWorkBuilder(pool: Pool, options: BusinessWorkBuilderOptions = {}) {
  const datasets = createDatasetService(pool), facts = createMaterialFactReader(pool), artifacts = createArtifactService(pool);
  const principalFor = options.principalForContext ?? defaultPrincipal, now = options.now ?? (() => new Date());

  async function readAll(principal: IdentityPrincipal, query: DatasetQuery, fieldIds?: string[]) {
    const records: DatasetPage['records'] = [];
    let after = query.after;
    for (let pageIndex = 0; pageIndex < 2_000; pageIndex++) {
      const page = await datasets.query(principal, { ...query, ...(fieldIds ? { fieldIds } : {}), after, limit: 50 });
      records.push(...page.records);
      if (!page.nextCursor) return { records, revision: page.revision, collection: page.collection };
      after = page.nextCursor;
    }
    throw new Error('BUSINESS_WORK_DATASET_PAGE_LIMIT');
  }

  async function readFacts(principal: IdentityPrincipal, context: WorkExecutionContext, refs: SourceRef[]) {
    const all: Awaited<ReturnType<typeof facts.read>>['facts'] = [];
    for (let index = 0; index < refs.length; index += 100) all.push(...(await facts.read(principal, { workspaceId: context.workspaceId, refs: refs.slice(index, index + 100) })).facts);
    return all;
  }

  async function save(context: WorkExecutionContext, principal: IdentityPrincipal, drafts: ArtifactDraft[]) {
    return identityTransaction(pool, async (transaction) => {
      const saved = [];
      for (let index = 0; index < drafts.length; index++) {
        const draft = drafts[index]!;
        saved.push(await artifacts.createInTransaction(transaction, principal, derivedOperationId(context.operationId, `artifact:${index}:${draft.title}`), {
          workspaceId: context.workspaceId, projectId: context.projectId, expectedAuthzVersion: context.expectedAuthzVersion,
          title: draft.title, content: draft.content, sourceRefs: draft.sourceRefs,
        }));
      }
      return saved;
    });
  }

  async function buildFinanceWork(raw: BuildFinanceWorkInput, rawContext: WorkExecutionContext): Promise<BusinessWorkResult> {
    const input = BuildFinanceWorkInputSchema.parse(raw), context = WorkExecutionContextSchema.parse(rawContext), principal = principalFor(context);
    if (input.query.workspaceId !== context.workspaceId) throw new Error('BUSINESS_WORK_WORKSPACE_MISMATCH');
    assertAllowedSources(context, input.sourceRefs);
    const selectedFacts = await readFacts(principal, context, input.sourceRefs);
    const bindableRefs = selectedFacts.filter((fact) => fact.state === 'current' && fact.canBind).map((fact) => fact.requestedRef);
    const factIssues: Finding[] = selectedFacts.filter((fact) => fact.state !== 'current' || !fact.canBind).map((fact) => ({ code: `finance.fact.${fact.state === 'current' ? 'unreviewed' : fact.state}`, targetIds: [fact.requestedRef.recordId ?? fact.requestedRef.sourceId], sourceRefs: [fact.requestedRef] }));
    const page = await readAll(principal, input.query), normalized = normalizeFinanceRecords(page.records, { ...input, sourceRefs: bindableRefs }), scenario = normalizeFinanceScenarios(input);
    const analysisInput = FinanceAnalysisInputSchema.parse({ currency: input.currency, accounting: input.accounting, openingBalance: input.openingBalance, period: input.period, transactions: normalized.transactions, scenarios: scenario.scenarios, excludedTransactionIds: [] });
    const analysis = analyzeFinance(analysisInput), built = buildFinanceArtifacts(analysisInput, analysis, context.locale), sourceRefs = [...new Map([...bindableRefs, ...built.sourceRefs].map((ref) => [sourceRefKey(ref), ref])).values()];
    const saved = await save(context, principal, [
      { title: built.workbook.workbook.name, content: built.workbook, sourceRefs },
      { title: context.locale === 'ru' ? 'Отчёт по финансовой модели' : context.locale === 'kk' ? 'Қаржы моделі туралы есеп' : 'Financial model report', content: built.report, sourceRefs },
    ]);
    const unresolved = uniqueFindings([...factIssues, ...normalized.unresolved, ...scenario.unresolved, ...analysis.coverage.issues.map((issue) => ({ code: `finance.${issue.code.replaceAll('-', '_')}`, targetIds: [issue.transactionId], sourceRefs: issue.sourceRefs }))]);
    return BusinessWorkResultSchema.parse({
      artifacts: saved, inputRevisionVector: context.inputRevisionVector,
      workPreview: financePreview(analysisInput, analysis, saved),
      checks: [
        { code: 'finance.dataset.normalized', status: normalized.transactions.length ? 'passed' : 'unknown', targetIds: normalized.transactions.map((item) => item.id), sourceRefs: input.sourceRefs },
        { code: 'finance.cash_timing.checked', status: analysis.coverage.issues.some((issue) => issue.code === 'cash-date-unknown') ? 'unknown' : 'passed', targetIds: analysis.scenarios.map((item) => item.id), sourceRefs },
        { code: 'finance.unknowns.preserved', status: 'passed', targetIds: analysis.scenarios.flatMap((item) => item.unknownItemIds), sourceRefs },
      ], unresolved,
      ...(analysis.scenarios.length > 1 ? { decision: { id: 'finance_scenario_selection', options: analysis.scenarios.map((item, index) => ({ id: `scenario_${index + 1}`, label: item.title, artifactIds: saved.map((artifact) => artifact.artifact.id) })), requiresConsent: true } } : {}),
      summary: context.locale === 'ru' ? 'Сохранены редактируемая финансовая модель и отчёт с отдельным денежным календарём и явными неизвестными.' : context.locale === 'kk' ? 'Бөлек ақша күнтізбесі және анық белгісіздері бар өңделетін қаржы моделі мен есеп сақталды.' : 'An editable financial model and report were saved with separate cash timing and explicit unknowns.',
    });
  }

  async function buildForecastWork(raw: ForecastInput, rawContext: WorkExecutionContext): Promise<ForecastBusinessWorkResult> {
    const input = ForecastInputSchema.parse(raw), context = WorkExecutionContextSchema.parse(rawContext), principal = principalFor(context);
    assertAllowedSources(context, [input.seriesRef]);
    let records: DatasetPage['records'] = [], mappingIssue: Finding[] = [];
    if (input.seriesRef.collectionId && input.seriesRef.factRevision !== undefined) {
      const fact = (await readFacts(principal, context, [input.seriesRef]))[0];
      if (!fact || fact.state !== 'current' || !fact.canBind) mappingIssue = [{ code: `forecast.series.fact_${fact?.state === 'current' ? 'unreviewed' : fact?.state ?? 'unknown'}`, targetIds: [input.target], sourceRefs: [input.seriesRef] }];
      else {
        const result = await readAll(principal, { workspaceId: context.workspaceId, collectionId: input.seriesRef.collectionId, fieldIds: [input.dateColumn, input.valueColumn], filters: [], query: '', limit: 50, includeMissing: false }, [input.dateColumn, input.valueColumn]);
        if (result.revision !== input.seriesRef.factRevision) mappingIssue = [{ code: 'forecast.series.revision_stale', targetIds: [input.target], sourceRefs: [input.seriesRef] }];
        else records = result.records;
      }
    } else mappingIssue = [{ code: 'forecast.series.mapping_missing', targetIds: [input.target], sourceRefs: [input.seriesRef] }];
    const normalized = normalizeForecastSeries(input, records, context.inputRevisionVector), forecast = runForecast(normalized.series), built = buildForecastArtifacts(normalized.series, forecast, context.locale);
    const saved = await save(context, principal, [
      { title: built.workbook.workbook.name, content: built.workbook, sourceRefs: built.sourceRefs },
      { title: context.locale === 'ru' ? 'Отчёт по прогнозу' : context.locale === 'kk' ? 'Болжам есебі' : 'Forecast report', content: built.report, sourceRefs: built.sourceRefs },
    ]);
    const eligibilityIssues: Finding[] = forecast.eligibility.state === 'insufficient' ? forecast.eligibility.reasons.map((code) => ({ code, targetIds: [input.target], sourceRefs: [input.seriesRef] })) : [];
    const unresolved = uniqueFindings([...mappingIssue, ...normalized.unresolved, ...eligibilityIssues]);
    return ForecastBusinessWorkResultSchema.parse({
      artifacts: saved, inputRevisionVector: context.inputRevisionVector,
      workPreview: forecastPreview(normalized.series, forecast, saved),
      checks: [
        { code: 'forecast.eligibility.checked', status: forecast.eligibility.state === 'eligible' ? 'passed' : 'unknown', targetIds: [input.target], sourceRefs: [input.seriesRef] },
        { code: 'forecast.rolling_origin.checked', status: forecast.eligibility.state === 'eligible' && forecast.backtest.folds.length >= 2 ? 'passed' : 'unknown', targetIds: [input.target], sourceRefs: [input.seriesRef] },
        { code: 'forecast.baseline.compared', status: forecast.eligibility.state === 'eligible' ? 'passed' : 'unknown', targetIds: [input.target], sourceRefs: [input.seriesRef] },
        { code: 'forecast.interval.calibration', status: forecast.interval.empiricalCoverage === null ? 'unknown' : forecast.interval.empiricalCoverage >= 0.8 ? 'passed' : 'failed', targetIds: [input.target], sourceRefs: [input.seriesRef] },
      ], unresolved,
      summary: forecast.eligibility.state === 'eligible'
        ? context.locale === 'ru' ? 'Сохранены прогноз, историческая проверка, сравнение с базовой моделью и честный диапазон.' : context.locale === 'kk' ? 'Болжам, тарихи тексеру, базалық модельмен салыстыру және адал ауқым сақталды.' : 'The forecast, rolling backtest, baseline comparison and an honest range were saved.'
        : context.locale === 'ru' ? 'Истории недостаточно: исходный ряд и сценарный путь сохранены без выдуманного прогноза.' : context.locale === 'kk' ? 'Тарих жеткіліксіз: бастапқы қатар мен сценарийлік жол жалған болжамсыз сақталды.' : 'History is insufficient; the input series and scenario path were saved without a fabricated forecast.',
      forecast,
    });
  }

  async function buildProcurementWork(raw: BuildProcurementWorkInput, rawContext: WorkExecutionContext): Promise<BusinessWorkResult> {
    const input = BuildProcurementWorkInputSchema.parse(raw), context = WorkExecutionContextSchema.parse(rawContext), principal = principalFor(context);
    const requestedRefs = [...input.offerSourceRefs, ...input.stockSourceRefs]; assertAllowedSources(context, requestedRefs);
    const [offerFacts, stockFacts] = await Promise.all([readFacts(principal, context, input.offerSourceRefs), readFacts(principal, context, input.stockSourceRefs)]);
    const factIssues: Finding[] = [...offerFacts, ...stockFacts].filter((fact) => fact.state !== 'current' || !fact.canBind).map((fact) => ({ code: `procurement.fact.${fact.state}`, targetIds: [fact.requestedRef.recordId ?? fact.requestedRef.sourceId], sourceRefs: [fact.requestedRef] }));
    const normalized = normalizeProcurementFacts(input, offerFacts, stockFacts, localDate(now())), comparison = compareSuppliers(normalized.comparison), built = buildProcurementArtifacts(normalized.comparison, comparison, context.locale);
    const saved = await save(context, principal, [
      { title: built.workbook.workbook.name, content: built.workbook, sourceRefs: built.sourceRefs },
      { title: context.locale === 'ru' ? 'Черновик заказа поставщику' : context.locale === 'kk' ? 'Жеткізушіге тапсырыс жобасы' : 'Supplier order draft', content: built.order, sourceRefs: built.sourceRefs },
    ]);
    const candidateIssues: Finding[] = comparison.candidates.filter((candidate) => !candidate.complete).map((candidate) => ({ code: 'procurement.offer.incomplete', targetIds: [candidate.offerId, ...candidate.missing], sourceRefs: candidate.sourceRefs }));
    const unresolved = uniqueFindings([...factIssues, ...normalized.unresolved, ...candidateIssues, ...comparison.draftOrder.unresolvedNeedIds.map((id) => ({ code: 'procurement.need.unresolved', targetIds: [id], sourceRefs: input.needLines.find((line) => line.id === id)?.sourceRefs ?? [] }))]);
    const decisionOptions = comparison.candidates.filter((candidate) => candidate.eligible && candidate.knownTotalMinorUnits !== null).map((candidate, index) => ({ id: `offer_${index + 1}`, label: `${candidate.supplierName} · ${candidate.knownTotalMinorUnits} ${candidate.currency}`, artifactIds: saved.map((artifact) => artifact.artifact.id) }));
    return BusinessWorkResultSchema.parse({
      artifacts: saved, inputRevisionVector: context.inputRevisionVector,
      workPreview: procurementPreview(comparison, saved),
      checks: [
        { code: 'procurement.units.normalized', status: comparison.candidates.some((candidate) => candidate.missing.includes('unit') || candidate.missing.includes('pack-size')) ? 'failed' : 'passed', targetIds: comparison.candidates.map((candidate) => candidate.offerId), sourceRefs: requestedRefs },
        { code: 'procurement.complete_cost.checked', status: comparison.draftOrder.unresolvedNeedIds.length ? 'unknown' : 'passed', targetIds: input.needLines.map((line) => line.id), sourceRefs: requestedRefs },
        { code: 'procurement.external_action.none', status: 'passed', targetIds: comparison.draftOrder.lines.map((line) => line.offerId), sourceRefs: requestedRefs },
      ], unresolved,
      ...(decisionOptions.length ? { decision: { id: 'procurement_offer_selection', options: decisionOptions.slice(0, 20), requiresConsent: true } } : {}),
      summary: context.locale === 'ru' ? 'Сохранены сравнение полной известной стоимости и черновик заказа; поставщику ничего не отправлено.' : context.locale === 'kk' ? 'Толық белгілі құнды салыстыру және тапсырыс жобасы сақталды; жеткізушіге ештеңе жіберілген жоқ.' : 'A complete-known-cost comparison and order draft were saved; nothing was sent to a supplier.',
    });
  }

  const financeToolDescriptor: BusinessWorkToolDescriptor<BuildFinanceWorkInput> = {
    name: 'build_finance_work', version: 1, purpose: 'Build and save an editable financial model with exact scenario calculations, separate cash timing, lineage and explicit unknowns.',
    inputSchema: BuildFinanceWorkInputSchema, outputSchema: BusinessWorkResultSchema, policy: 'edit', costClass: 'local', deadlineMs: 30_000, idempotency: 'operation-receipt', execute: buildFinanceWork,
  };
  const forecastToolDescriptor: BusinessWorkToolDescriptor<ForecastInput, ForecastBusinessWorkResult> = {
    name: 'build_forecast_work', version: 1, purpose: 'Build and save a numerical forecast only after rolling-origin checks against naive baselines; preserve an honest insufficient-history path.',
    inputSchema: ForecastInputSchema, outputSchema: ForecastBusinessWorkResultSchema, policy: 'edit', costClass: 'local', deadlineMs: 30_000, idempotency: 'operation-receipt', execute: buildForecastWork,
  };
  const procurementToolDescriptor: BusinessWorkToolDescriptor<BuildProcurementWorkInput> = {
    name: 'build_procurement_work', version: 1, purpose: 'Normalize stock, packs, MOQ, delivery, payment, tax, FX and lead time; save a comparison and an unsent supplier-order draft.',
    inputSchema: BuildProcurementWorkInputSchema, outputSchema: BusinessWorkResultSchema, policy: 'edit', costClass: 'local', deadlineMs: 30_000, idempotency: 'operation-receipt', execute: buildProcurementWork,
  };
  return { buildFinanceWork, buildForecastWork, buildProcurementWork, financeToolDescriptor, forecastToolDescriptor, procurementToolDescriptor, toolDescriptors: [financeToolDescriptor, forecastToolDescriptor, procurementToolDescriptor] as const };
}

