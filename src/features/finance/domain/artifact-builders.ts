import { createHash, randomUUID } from 'node:crypto';
import type { SourceRef } from '@/contracts/artifacts';
import type { Locale } from '@/contracts/primitives';
import { validateArtifactContent } from '@/features/artifacts/domain/semantic-validation';
import type { ArtifactContent, DocumentNode, JsonValue, TableCell, TableSheet } from '@/features/artifacts/domain/content-models';
import type { FinanceAnalysisInput, FinanceAnalysisResult } from '../contracts';

type CellValue = string | number | boolean | null;
export type GridSheet = {
  id: string;
  name: string;
  columns: { id: string; title: string; width?: number; unit?: Record<string, JsonValue> }[];
  rows: { id: string; values: CellValue[] }[];
  chart?: { id: string; title: string; type: 'bar' | 'line'; labelColumnId: string; valueColumnIds: string[]; rowIds: string[] };
};

const text = (value: string, bold = false): DocumentNode => ({ type: 'text', text: value, ...(bold ? { marks: [{ type: 'bold' }] } : {}) });
export const paragraph = (value: string, id = randomUUID()): DocumentNode => ({ type: 'paragraph', attrs: { id }, content: [text(value)] });
export const heading = (value: string, level: 1 | 2 | 3 = 1, id = randomUUID()): DocumentNode => ({ type: 'heading', attrs: { id, level }, content: [text(value)] });
export const bulletList = (values: string[], id = randomUUID()): DocumentNode => ({ type: 'bulletList', attrs: { id }, content: values.map((value) => ({ type: 'listItem', attrs: { id: randomUUID() }, content: [paragraph(value)] })) });

function deterministicUuid(label: string) {
  const bytes = createHash('sha256').update(label).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableDocumentNode(node: DocumentNode, path: string): DocumentNode {
  const content = node.content?.map((child, index) => stableDocumentNode(child, `${path}.${index}`));
  return { ...node, ...(node.attrs && 'id' in node.attrs ? { attrs: { ...node.attrs, id: deterministicUuid(`tirlik-document-node:${path}`) } } : {}), ...(content ? { content } : {}) };
}

export function documentArtifact(nodes: DocumentNode[]): Extract<ArtifactContent, { kind: 'document' }> {
  const content = nodes.map((node, index) => stableDocumentNode(node, String(index)));
  return validateArtifactContent({ kind: 'document', schemaVersion: 1, document: { type: 'doc', attrs: { id: deterministicUuid('tirlik-document-root') }, content } }) as Extract<ArtifactContent, { kind: 'document' }>;
}

function tableCell(value: CellValue, header = false): TableCell {
  if (typeof value === 'number') return { v: value, t: 2, ...(header ? { s: { bold: true, bg: '#E7F1EC' } } : {}) };
  if (typeof value === 'boolean') return { v: value, t: 3, ...(header ? { s: { bold: true, bg: '#E7F1EC' } } : {}) };
  return { v: value, t: 1, ...(header ? { s: { bold: true, bg: '#E7F1EC' } } : {}) };
}

/** Builds a canonical editable table with stable row/column identities and tabular chart data. */
export function workbookArtifact(name: string, locale: Locale, sheets: GridSheet[]): Extract<ArtifactContent, { kind: 'table' }> {
  const workbookSheets: Record<string, TableSheet> = {}, stableIds: Extract<ArtifactContent, { kind: 'table' }>['stableIds'] = {};
  for (const spec of sheets) {
    const rows = [`${spec.id}_header`, ...spec.rows.map((row) => row.id)], columns = spec.columns.map((column) => column.id);
    const cellData: TableSheet['cellData'] = { 0: Object.fromEntries(spec.columns.map((column, index) => [index, tableCell(column.title, true)])) };
    for (let rowIndex = 0; rowIndex < spec.rows.length; rowIndex++) {
      cellData[rowIndex + 1] = Object.fromEntries(spec.rows[rowIndex]!.values.map((value, columnIndex) => [columnIndex, tableCell(value)]));
    }
    workbookSheets[spec.id] = {
      id: spec.id, name: spec.name, rowCount: rows.length, columnCount: columns.length, cellData,
      freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      columnData: Object.fromEntries(spec.columns.map((column, index) => [index, { w: column.width ?? 150, ...(column.unit ? { tirlikUnit: column.unit } : {}) }])),
      ...(spec.chart ? { charts: [spec.chart] } : {}),
    };
    stableIds[spec.id] = { rows, columns };
  }
  return validateArtifactContent({ kind: 'table', schemaVersion: 1, workbook: { id: deterministicUuid(`tirlik-workbook:${locale}:${name}:${sheets.map((sheet) => sheet.id).join('|')}`), name, appVersion: '1.0.4', locale: locale === 'ru' ? 'ruRU' : locale === 'kk' ? 'kkKZ' : 'enUS', sheetOrder: sheets.map((sheet) => sheet.id), sheets: workbookSheets }, stableIds }) as Extract<ArtifactContent, { kind: 'table' }>;
}

export function uniqueSourceRefs(refs: readonly SourceRef[]) {
  return [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()];
}

const labels = {
  ru: { title: 'Финансовая модель', overview: 'Сценарии', calendar: 'Календарь денег', transactions: 'Операции', assumptions: 'Допущения', coverage: 'Покрытие', settings: 'Параметры модели', report: 'Отчёт по финансовой модели', unknown: 'Не подтверждено', external: 'Денежный результат и движение денег показаны отдельно.' },
  kk: { title: 'Қаржы моделі', overview: 'Сценарийлер', calendar: 'Ақша күнтізбесі', transactions: 'Операциялар', assumptions: 'Болжамдар', coverage: 'Қамту', settings: 'Модель параметрлері', report: 'Қаржы моделі туралы есеп', unknown: 'Расталмаған', external: 'Ақшалай нәтиже мен ақша қозғалысы бөлек көрсетілген.' },
  en: { title: 'Financial model', overview: 'Scenarios', calendar: 'Cash calendar', transactions: 'Transactions', assumptions: 'Assumptions', coverage: 'Coverage', settings: 'Model settings', report: 'Financial model report', unknown: 'Unconfirmed', external: 'Financial result and cash movement are shown separately.' },
} as const;

export function buildFinanceArtifacts(input: FinanceAnalysisInput, result: FinanceAnalysisResult, locale: Locale) {
  const copy = labels[locale], moneyUnit = { kind: 'money', currency: input.currency };
  const overviewRows = result.scenarios.map((scenario) => ({ id: `scenario_${scenario.id}`, values: [scenario.title, scenario.accounting, scenario.knownIncomeMinorUnits, scenario.knownExpenseMinorUnits, scenario.knownResultMinorUnits, scenario.closingBalanceMinorUnits, scenario.minimumBalanceMinorUnits, scenario.unknownItemIds.length, scenario.id] }));
  const calendarRows = result.scenarios.flatMap((scenario) => scenario.calendar.map((row, index) => ({ id: `calendar_${scenario.id}_${index}`, values: [scenario.title, row.date, row.knownInflowsMinorUnits, row.knownOutflowsMinorUnits, row.netKnownMinorUnits, row.closingBalanceMinorUnits, row.unknownItemIds.join(', ')] })));
  const transactionRows = input.transactions.map((item, index) => ({ id: `transaction_${index}`, values: [item.id, item.kind, item.occurredOn, item.cashDate, item.amount?.minorUnits ?? null, item.amount?.currency ?? input.currency, item.status, item.note, JSON.stringify(item.sourceRefs)] }));
  const assumptionRows = input.scenarios.flatMap((scenario) => scenario.assumptions.map((item, index) => ({ id: `assumption_${scenario.id}_${index}`, values: [scenario.title, item.id, item.title, item.effectiveOn, item.direction, item.amount?.minorUnits ?? null, item.confirmed, scenario.id, JSON.stringify(item.sourceRef ?? null)] })));
  const coverageRows = result.coverage.issues.map((issue, index) => ({ id: `coverage_${index}`, values: [issue.code, issue.transactionId, issue.sourceRefs.length] }));
  const settingRows = [
    { id: 'setting_currency', values: ['currency', input.currency] },
    { id: 'setting_accounting', values: ['accounting', input.accounting] },
    { id: 'setting_opening_balance', values: ['opening_balance_minor_units', input.openingBalance?.minorUnits ?? null] },
    { id: 'setting_period_start', values: ['period_start', input.period.start] },
    { id: 'setting_period_end', values: ['period_end', input.period.end] },
  ];
  const workbook = workbookArtifact(copy.title, locale, [
    { id: 'finance_overview', name: copy.overview, columns: [{ id: 'scenario', title: copy.overview, width: 220 }, { id: 'accounting', title: 'Accounting' }, { id: 'income', title: `Income (${input.currency} minor)`, unit: moneyUnit }, { id: 'expense', title: `Expense (${input.currency} minor)`, unit: moneyUnit }, { id: 'result', title: `Result (${input.currency} minor)`, unit: moneyUnit }, { id: 'closing', title: `Closing (${input.currency} minor)`, unit: moneyUnit }, { id: 'minimum', title: `Minimum (${input.currency} minor)`, unit: moneyUnit }, { id: 'unknown', title: copy.unknown }, { id: 'scenario_id', title: 'Scenario ID' }], rows: overviewRows, chart: { id: 'finance_result_chart', title: copy.overview, type: 'bar', labelColumnId: 'scenario', valueColumnIds: ['result'], rowIds: overviewRows.map((row) => row.id) } },
    { id: 'cash_calendar', name: copy.calendar, columns: [{ id: 'scenario', title: copy.overview }, { id: 'date', title: 'Date', unit: { kind: 'date' } }, { id: 'inflow', title: 'Inflow', unit: moneyUnit }, { id: 'outflow', title: 'Outflow', unit: moneyUnit }, { id: 'net', title: 'Net', unit: moneyUnit }, { id: 'balance', title: 'Balance', unit: moneyUnit }, { id: 'unknown', title: copy.unknown }], rows: calendarRows.length ? calendarRows : [{ id: 'calendar_empty', values: [null, null, null, null, null, null, copy.unknown] }] },
    { id: 'transactions', name: copy.transactions, columns: [{ id: 'id', title: 'ID' }, { id: 'kind', title: 'Kind' }, { id: 'occurred', title: 'Occurred', unit: { kind: 'date' } }, { id: 'cash', title: 'Cash date', unit: { kind: 'date' } }, { id: 'amount', title: 'Amount' }, { id: 'currency', title: 'Currency' }, { id: 'status', title: 'Status' }, { id: 'note', title: 'Note', width: 280 }, { id: 'source_refs', title: 'Source refs', width: 280 }], rows: transactionRows.length ? transactionRows : [{ id: 'transactions_empty', values: [null, null, null, null, null, input.currency, null, null, '[]'] }] },
    { id: 'assumptions', name: copy.assumptions, columns: [{ id: 'scenario', title: copy.overview }, { id: 'id', title: 'ID' }, { id: 'title', title: 'Title', width: 240 }, { id: 'date', title: 'Date', unit: { kind: 'date' } }, { id: 'direction', title: 'Direction' }, { id: 'amount', title: 'Amount', unit: moneyUnit }, { id: 'confirmed', title: 'Confirmed' }, { id: 'scenario_id', title: 'Scenario ID' }, { id: 'source_ref', title: 'Source ref', width: 280 }], rows: assumptionRows.length ? assumptionRows : [{ id: 'assumptions_empty', values: [null, null, null, null, null, null, false, null, 'null'] }] },
    { id: 'coverage', name: copy.coverage, columns: [{ id: 'code', title: 'Issue' }, { id: 'transaction', title: 'Transaction' }, { id: 'sources', title: 'Sources' }], rows: coverageRows.length ? coverageRows : [{ id: 'coverage_complete', values: ['complete', '', 0] }] },
    { id: 'finance_settings', name: copy.settings, columns: [{ id: 'key', title: 'Setting' }, { id: 'value', title: 'Value', width: 240 }], rows: settingRows },
  ]);
  const unknowns = result.scenarios.flatMap((scenario) => scenario.unknownItemIds.map((id) => `${scenario.title}: ${id}`));
  const report = documentArtifact([
    heading(copy.report), paragraph(`${result.period.start} — ${result.period.end} · ${input.currency} · ${input.accounting}`), paragraph(copy.external),
    heading(copy.overview, 2),
    ...result.scenarios.map((scenario) => paragraph(`${scenario.title}: ${scenario.knownResultMinorUnits} ${input.currency} minor units; closing ${scenario.closingBalanceMinorUnits ?? copy.unknown}.`)),
    heading(copy.coverage, 2), paragraph(`${result.coverage.acceptedTransactions} accepted; ${result.coverage.excludedTransactions} excluded; ${result.coverage.issues.length} issues.`),
    ...(unknowns.length ? [heading(copy.unknown, 2), bulletList(unknowns)] : []),
  ]);
  return { workbook, report, sourceRefs: uniqueSourceRefs([...input.transactions.flatMap((item) => item.sourceRefs), ...input.scenarios.flatMap((scenario) => scenario.assumptions.flatMap((item) => item.sourceRef ? [item.sourceRef] : []))]) };
}

export type FinanceArtifactBuild = ReturnType<typeof buildFinanceArtifacts>;

