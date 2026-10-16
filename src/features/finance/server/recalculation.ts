import type { Pool } from 'pg';
import { z } from 'zod';

import { SourceRefSchema, type SourceRef } from '@/contracts/artifacts';
import { BusinessWorkResultSchema, type BusinessWorkResult } from '@/contracts/business-work';
import type { Locale } from '@/contracts/primitives';
import type { ArtifactMutationResult } from '@/features/artifacts/contracts';
import { validateArtifactContent } from '@/features/artifacts/domain/semantic-validation';
import type { ArtifactContent, TableCell } from '@/features/artifacts/domain/content-models';
import { createArtifactService } from '@/features/artifacts/server/service';
import { ArtifactConflict } from '@/features/artifacts/server/service-support';
import type { IdentityPrincipal } from '@/features/identity/server/access';
import { IdentityError } from '@/features/identity/server/http';
import {
  FinanceAnalysisInputSchema,
  FinanceRecalculateRequestSchema,
  FinanceRecalculateResultSchema,
  type FinanceAnalysisInput,
  type FinanceRecalculateRequest,
  type FinanceRecalculateResult,
} from '../contracts';
import { analyzeFinance } from '../domain/analyze-finance';
import { buildFinanceArtifacts } from '../domain/artifact-builders';
import { createFinanceWorkPreview } from './work-preview';

type TableContent = Extract<ArtifactContent, { kind: 'table' }>;
type CellValue = NonNullable<TableCell['v']> | undefined;

const sourceRefsSchema = z.array(SourceRefSchema).max(20);
const optionalSourceRefSchema = SourceRefSchema.nullable();
const derivedSheetIds = ['finance_overview', 'cash_calendar', 'coverage'] as const;
const inputSheetIds = ['assumptions', 'finance_settings'] as const;

function invalid(): never {
  throw new IdentityError('VALIDATION_FAILED', 'artifacts.errors.validationFailed');
}

function tableRows(content: TableContent, sheetId: string) {
  const sheet = content.workbook.sheets[sheetId], axes = content.stableIds[sheetId];
  if (!sheet || !axes || axes.rows.length !== sheet.rowCount || axes.columns.length !== sheet.columnCount) invalid();
  return axes.rows.slice(1).map((_rowId, rowOffset) => {
    const row = sheet.cellData[rowOffset + 1] ?? {};
    return Object.fromEntries(axes.columns.map((columnId, column) => [columnId, row[column]?.v])) as Record<string, CellValue>;
  });
}

function text(value: CellValue, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) invalid();
  return value;
}

function nullableText(value: CellValue) {
  if (value === undefined || value === null || value === '') return null;
  return text(value);
}

function integerText(value: CellValue) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  const parsed = text(value);
  if (!/^-?(?:0|[1-9]\d*)$/.test(parsed)) invalid();
  return parsed;
}

function truth(value: CellValue) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'TRUE') return true;
  if (value === 'false' || value === 'FALSE') return false;
  return invalid();
}

function json<T>(value: CellValue, schema: z.ZodType<T>): T {
  if (typeof value !== 'string') invalid();
  try { return schema.parse(JSON.parse(value)); }
  catch { return invalid(); }
}

/** Reads the durable, user-editable finance workbook back into the canonical engine input. */
export function financeInputFromWorkbook(content: TableContent): FinanceAnalysisInput {
  const settings = new Map(tableRows(content, 'finance_settings').map((row) => [text(row.key), row.value]));
  const currency = text(settings.get('currency'));
  const accounting = text(settings.get('accounting'));
  const openingRaw = settings.get('opening_balance_minor_units');
  const openingBalance = openingRaw === undefined || openingRaw === null || openingRaw === '' ? null : { currency, minorUnits: integerText(openingRaw) };
  const scenarioRows = tableRows(content, 'finance_overview').filter((row) => row.scenario_id !== undefined && row.scenario_id !== null);
  const assumptionRows = tableRows(content, 'assumptions').filter((row) => row.id !== undefined && row.id !== null);
  const transactions = tableRows(content, 'transactions').filter((row) => row.id !== undefined && row.id !== null).map((row) => {
    const amount = row.amount === undefined || row.amount === null || row.amount === '' ? null : { currency: text(row.currency), minorUnits: integerText(row.amount) };
    return {
      id: text(row.id), kind: text(row.kind), occurredOn: text(row.occurred), cashDate: nullableText(row.cash), amount,
      status: text(row.status), sourceRefs: json(row.source_refs, sourceRefsSchema), note: typeof row.note === 'string' ? row.note : '',
    };
  });
  const scenarios = scenarioRows.map((row) => {
    const id = text(row.scenario_id);
    return {
      id,
      title: text(row.scenario),
      assumptions: assumptionRows.filter((assumption) => assumption.scenario_id === id).map((assumption) => {
        const amount = assumption.amount === undefined || assumption.amount === null || assumption.amount === '' ? null : { currency, minorUnits: integerText(assumption.amount) };
        const sourceRef = json(assumption.source_ref, optionalSourceRefSchema);
        return {
          id: text(assumption.id), title: text(assumption.title), effectiveOn: text(assumption.date), direction: text(assumption.direction),
          amount, confirmed: truth(assumption.confirmed), ...(sourceRef ? { sourceRef } : {}),
        };
      }),
    };
  });
  return FinanceAnalysisInputSchema.parse({
    currency,
    accounting,
    openingBalance,
    period: { start: text(settings.get('period_start')), end: text(settings.get('period_end')) },
    transactions,
    scenarios,
    excludedTransactionIds: [],
  });
}

function applyFinanceEdits(base: FinanceAnalysisInput, request: FinanceRecalculateRequest): FinanceAnalysisInput {
  const scenarioEdits = new Map(request.scenarios.map((edit) => [edit.scenarioId, edit]));
  for (const edit of request.scenarios) if (!base.scenarios.some((scenario) => scenario.id === edit.scenarioId)) invalid();
  const scenarios = base.scenarios.map((scenario) => {
    const edit = scenarioEdits.get(scenario.id);
    if (!edit) return scenario;
    const assumptionEdits = new Map(edit.assumptions.map((assumption) => [assumption.assumptionId, assumption]));
    for (const assumption of edit.assumptions) if (!scenario.assumptions.some((candidate) => candidate.id === assumption.assumptionId)) invalid();
    return {
      ...scenario,
      ...(edit.title === undefined ? {} : { title: edit.title }),
      assumptions: scenario.assumptions.map((assumption) => {
        const patch = assumptionEdits.get(assumption.id);
        if (!patch) return assumption;
        if (patch.amount && patch.amount.currency !== base.currency) invalid();
        return { ...assumption, ...Object.fromEntries(Object.entries(patch).filter(([key, value]) => key !== 'assumptionId' && value !== undefined)) };
      }),
    };
  });
  return FinanceAnalysisInputSchema.parse({ ...base, scenarios });
}

function preserveCellPresentation(before: TableCell | undefined, after: TableCell | undefined): TableCell {
  const presentation = before ? Object.fromEntries(Object.entries(before).filter(([key]) => key === 's' || key === 'p')) : {};
  return { ...presentation, ...(after ?? {}) };
}

function overlayInputSheet(target: TableContent, generated: TableContent, sheetId: string) {
  const before = target.workbook.sheets[sheetId], after = generated.workbook.sheets[sheetId];
  const beforeAxes = target.stableIds[sheetId], afterAxes = generated.stableIds[sheetId];
  if (!before || !after || !beforeAxes || !afterAxes) invalid();
  const rowIndexes = new Map(beforeAxes.rows.map((id, index) => [id, index]));
  const columnIndexes = new Map(beforeAxes.columns.map((id, index) => [id, index]));
  for (const [afterRow, rowId] of afterAxes.rows.entries()) {
    const beforeRow = rowIndexes.get(rowId);
    if (beforeRow === undefined) return replaceSheet(target, generated, sheetId);
    for (const [afterColumn, columnId] of afterAxes.columns.entries()) {
      const beforeColumn = columnIndexes.get(columnId);
      if (beforeColumn === undefined) return replaceSheet(target, generated, sheetId);
      const afterCell = after.cellData[afterRow]?.[afterColumn];
      if (!afterCell) continue;
      (before.cellData[beforeRow] ??= {})[beforeColumn] = preserveCellPresentation(before.cellData[beforeRow]?.[beforeColumn], afterCell);
    }
  }
}

function replaceSheet(target: TableContent, generated: TableContent, sheetId: string) {
  const sheet = generated.workbook.sheets[sheetId], axes = generated.stableIds[sheetId];
  if (!sheet || !axes) invalid();
  target.workbook.sheets[sheetId] = structuredClone(sheet);
  target.stableIds[sheetId] = structuredClone(axes);
  if (!target.workbook.sheetOrder.includes(sheetId)) target.workbook.sheetOrder.push(sheetId);
}

function recalculatedWorkbook(base: TableContent, canonical: TableContent) {
  const merged = structuredClone(base);
  for (const sheetId of derivedSheetIds) replaceSheet(merged, canonical, sheetId);
  for (const sheetId of inputSheetIds) overlayInputSheet(merged, canonical, sheetId);
  return validateArtifactContent(merged) as TableContent;
}

function workbookLocale(content: TableContent): Locale {
  if (content.workbook.locale === 'ruRU') return 'ru';
  if (content.workbook.locale === 'kkKZ') return 'kk';
  return 'en';
}

function revisionVector(base: FinanceRecalculateRequest['base'], refs: readonly SourceRef[]) {
  const vector: Record<string, number> = { [base.artifactId]: base.revision };
  for (const ref of refs) {
    if (vector[ref.sourceId] !== undefined && vector[ref.sourceId] !== ref.revision) invalid();
    vector[ref.sourceId] = ref.revision;
  }
  return vector;
}

function workResult(
  input: FinanceAnalysisInput,
  branch: ArtifactMutationResult,
  refs: SourceRef[],
  base: FinanceRecalculateRequest['base'],
  locale: Locale,
): BusinessWorkResult {
  const result = analyzeFinance(input);
  const unresolved = result.coverage.issues.map((issue) => ({ code: `finance.${issue.code.replaceAll('-', '_')}`, targetIds: [issue.transactionId], sourceRefs: issue.sourceRefs }));
  return BusinessWorkResultSchema.parse({
    artifacts: [branch],
    inputRevisionVector: revisionVector(base, refs),
    workPreview: createFinanceWorkPreview(input, result, { artifactId: branch.artifact.id, revision: branch.version.revision }),
    checks: [
      { code: 'finance.recalculated', status: 'passed', targetIds: result.scenarios.map((scenario) => scenario.id), sourceRefs: refs },
      { code: 'finance.prior_revision.retained', status: 'passed', targetIds: [base.artifactId, branch.artifact.id], sourceRefs: refs },
    ],
    unresolved,
    ...(result.scenarios.length > 1 ? { decision: { id: 'finance_scenario_selection', options: result.scenarios.map((scenario, index) => ({ id: `scenario_${index + 1}`, label: scenario.title, artifactIds: [branch.artifact.id] })), requiresConsent: true } } : {}),
    summary: locale === 'ru' ? 'Пересчитанная модель сохранена новой веткой; исходная версия и ручные правки в ней сохранены.' : locale === 'kk' ? 'Қайта есептелген модель жаңа тармақ ретінде сақталды; бастапқы нұсқа мен ондағы қолмен енгізілген түзетулер сақталды.' : 'The recalculated model was saved as a new branch; the prior version and its manual edits remain available.',
  });
}

export function createFinanceRecalculationService(pool: Pool) {
  const artifacts = createArtifactService(pool);
  return {
    async recalculate(principal: IdentityPrincipal, operationId: string, raw: FinanceRecalculateRequest): Promise<FinanceRecalculateResult> {
      const request = FinanceRecalculateRequestSchema.parse(raw);
      const base = await artifacts.version(principal, { workspaceId: request.workspaceId, artifactId: request.base.artifactId, revision: request.base.revision, expectedProjectId: request.projectId });
      if (base.headRevision !== request.base.revision) throw new ArtifactConflict(undefined, base.headRevision, 'reload');
      if (base.content.kind !== 'table' || base.sourceFreshness.some((freshness) => freshness.status !== 'current')) throw new IdentityError('CONFLICT', 'artifacts.errors.sourcesUnavailable');
      const input = applyFinanceEdits(financeInputFromWorkbook(base.content), request);
      const analysis = analyzeFinance(input), locale = workbookLocale(base.content);
      const canonical = buildFinanceArtifacts(input, analysis, locale).workbook;
      const content = recalculatedWorkbook(base.content, canonical);
      const branch = await artifacts.branch(principal, operationId, request.base.artifactId, {
        workspaceId: request.workspaceId,
        expectedAuthzVersion: base.viewer.authzVersion,
        baseRevision: request.base.revision,
        parentRevision: request.base.revision,
        projectId: request.projectId,
        title: request.branchTitle,
        content,
      });
      const work = workResult(input, branch, base.artifact.sourceRefs, request.base, locale);
      return FinanceRecalculateResultSchema.parse({
        work,
        comparison: { base: request.base, branch: { artifactId: branch.artifact.id, revision: branch.version.revision } },
      });
    },
  };
}

export type FinanceRecalculationService = ReturnType<typeof createFinanceRecalculationService>;
