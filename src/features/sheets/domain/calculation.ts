import Decimal from 'decimal.js';
import {
  CalculationSpecSchema,
  PreparedCalculationSchema,
  evaluateExactCalculation,
  type CalculationExactInput,
  type CalculationFormulaNode,
  type PreparedCalculation,
} from '@/contracts/calculations';
import { hashJson } from '@/features/artifacts/domain/canonical';
import type { JsonValue, TableCell } from '@/features/artifacts/domain/content-models';
import { createArtifactTargetResolver, tableCellTargetId } from '@/features/artifacts/domain/targets';
import { requireTable, type TableContent } from './model';

const Exact = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -200, toExpPos: 200 });
const exactPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function exactCellValue(cell: TableCell | undefined): string | null {
  if (!cell || cell.f || (typeof cell.v !== 'string' && typeof cell.v !== 'number')) return null;
  const text = String(cell.v);
  if (!exactPattern.test(text) || text.length > 80) return null;
  const value = new Exact(text);
  return value.isFinite() ? value.toFixed() : null;
}

function calculationGraph(spec: ReturnType<typeof CalculationSpecSchema.parse>): CalculationFormulaNode[] {
  const nodes: CalculationFormulaNode[] = spec.lines.map((line) => ({ outputCellId: line.amountCellId, formula: line.expectedFormula, inputCellIds: [line.quantityCellId, line.priceCellId] }));
  nodes.push({ outputCellId: spec.subtotalCellId, formula: spec.subtotalFormula, inputCellIds: spec.lines.map((line) => line.amountCellId) });
  if (spec.discount) nodes.push({ outputCellId: spec.discount.amountCellId, formula: spec.discount.expectedFormula, inputCellIds: [spec.subtotalCellId, spec.discount.rateCellId] });
  if (spec.tax) nodes.push({ outputCellId: spec.tax.amountCellId, formula: spec.tax.expectedFormula, inputCellIds: [spec.subtotalCellId, ...(spec.discount ? [spec.discount.amountCellId] : []), spec.tax.rateCellId] });
  nodes.push({ outputCellId: spec.totalCellId, formula: spec.totalFormula, inputCellIds: [spec.subtotalCellId, ...(spec.discount ? [spec.discount.amountCellId] : []), ...(spec.tax ? [spec.tax.amountCellId] : [])] });
  return nodes;
}

function cellIndex(content: TableContent, sheetId: string): Map<string, TableCell> {
  const sheet = content.workbook.sheets[sheetId], ids = content.stableIds[sheetId];
  if (!sheet || !ids) throw new Error('sheets.errors.calculationSheet');
  const cells = new Map<string, TableCell>();
  for (const [row, rowId] of ids.rows.entries()) for (const [column, columnId] of ids.columns.entries()) {
    const cell = sheet.cellData[row]?.[column];
    if (cell) cells.set(tableCellTargetId(sheetId, rowId, columnId), cell);
  }
  return cells;
}

export interface PreparedCalculationInput {
  artifactId: string;
  projectId: string;
  baseRevision: number;
  contentHash: string;
  preparedAt: string;
  expectedSourceRevisions: Record<string, number>;
  content: TableContent;
  sheetId?: string;
}

/** Build the immutable, reviewable exact calculation from one authorized snapshot. */
export function prepareCalculation(input: PreparedCalculationInput): PreparedCalculation {
  const content = requireTable(input.content);
  const sheetId = input.sheetId ?? content.workbook.sheetOrder.find((id) => !!content.workbook.sheets[id]?.calculation);
  if (!sheetId) throw new Error('sheets.errors.calculationMissing');
  const sheet = content.workbook.sheets[sheetId];
  if (!sheet?.calculation) throw new Error('sheets.errors.calculationMissing');
  const spec = CalculationSpecSchema.parse(sheet.calculation), cells = cellIndex(content, sheetId), graph = calculationGraph(spec);
  const inputIds = [...new Set(spec.lines.flatMap((line) => [line.quantityCellId, line.priceCellId]).concat(spec.discount ? [spec.discount.rateCellId] : [], spec.tax ? [spec.tax.rateCellId] : []))];
  const exactInputs: CalculationExactInput[] = inputIds.map((cellId) => {
    const value = exactCellValue(cells.get(cellId));
    if (value === null) throw new Error('sheets.errors.calculationInput');
    return { cellId, value };
  });
  const evaluationCells = Object.fromEntries([...cells].map(([cellId, cell]) => [cellId, { value: cell.v, formula: cell.f }]));
  const result = evaluateExactCalculation(spec, evaluationCells);
  if (result.state !== 'verified' || result.total === null) throw new Error(result.state === 'modified' ? 'sheets.errors.calculationModified' : 'sheets.errors.calculationIncomplete');
  const resolver = createArtifactTargetResolver(content), updates = Object.entries(result.values).map(([cellId, value]) => {
    if (value === null) throw new Error('sheets.errors.calculationIncomplete');
    const before = resolver(cellId), cell = cells.get(cellId);
    if (!before || !cell) throw new Error('sheets.errors.calculationTarget');
    return { cellId, beforeHash: before.hash, cell: { ...structuredClone(cell), v: value, t: 1 as const } };
  });
  const inputHash = hashJson({ spec, formulaGraph: graph, exactInputs } as unknown as JsonValue);
  const calculationHash = hashJson({ inputHash, result, updates } as unknown as JsonValue);
  const unsigned = {
    schemaVersion: 1 as const,
    artifactId: input.artifactId,
    projectId: input.projectId,
    sheetId,
    baseRevision: input.baseRevision,
    contentHash: input.contentHash,
    preparedAt: input.preparedAt,
    expectedSourceRevisions: input.expectedSourceRevisions,
    spec,
    formulaGraph: graph,
    exactInputs,
    result,
    updates,
    inputHash,
    calculationHash,
  };
  return PreparedCalculationSchema.parse({ ...unsigned, preparedHash: hashJson(unsigned as unknown as JsonValue) });
}

export function assertPreparedCalculation(input: PreparedCalculation): PreparedCalculation {
  const prepared = PreparedCalculationSchema.parse(input);
  const { preparedHash, ...unsigned } = prepared;
  if (hashJson(unsigned as unknown as JsonValue) !== preparedHash) throw new Error('sheets.errors.calculationPreparedHash');
  if (hashJson({ spec: prepared.spec, formulaGraph: prepared.formulaGraph, exactInputs: prepared.exactInputs } as unknown as JsonValue) !== prepared.inputHash) throw new Error('sheets.errors.calculationInputHash');
  if (hashJson({ inputHash: prepared.inputHash, result: prepared.result, updates: prepared.updates } as unknown as JsonValue) !== prepared.calculationHash) throw new Error('sheets.errors.calculationHash');
  return prepared;
}

/** Exact finance pass shared by interactive evaluation and every sheet export. */
export function recalculateExactWorkbook(input: TableContent) {
  const content = requireTable(structuredClone(input));
  const results: Record<string, ReturnType<typeof evaluateExactCalculation>> = {};
  for (const sheetId of content.workbook.sheetOrder) {
    const sheet = content.workbook.sheets[sheetId], spec = sheet?.calculation;
    if (!sheet || !spec) continue;
    const cells = cellIndex(content, sheetId), evaluationCells = Object.fromEntries([...cells].map(([cellId, cell]) => [cellId, { value: cell.v, formula: cell.f }]));
    const result = evaluateExactCalculation(spec, evaluationCells); results[sheetId] = result;
    if (result.state === 'modified') continue;
    for (const [cellId, value] of Object.entries(result.values)) {
      const cell = cells.get(cellId);
      if (cell) { cell.v = value ?? ''; cell.t = 1; }
    }
  }
  return { content, results };
}
