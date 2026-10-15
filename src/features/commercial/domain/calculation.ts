import { evaluateExactCalculation, type CalculationSpec, type ExactCalculationCell, type ExactCalculationResult } from '../../../contracts/calculations';
import type { ArtifactContent, TableCell } from '../../artifacts/domain/content-models';
import { tableCellTargetId } from '../../artifacts/domain/targets';

export type CalculationCell = ExactCalculationCell;
export type CalculationResult = ExactCalculationResult;
/** Compatibility name for the single canonical exact evaluator shared with sheets and exports. */
export function evaluateCalculation(raw: CalculationSpec, cells: Record<string, CalculationCell>): CalculationResult {
  return evaluateExactCalculation(raw, cells);
}

/** Called after the spreadsheet engine. Custom formulas remain the user's formulas. */
export function recalculateEstimate(input: Extract<ArtifactContent, { kind: 'table' }>) {
  const content = structuredClone(input), results: Record<string, CalculationResult> = {};
  for (const [sheetId, sheet] of Object.entries(content.workbook.sheets)) {
    const raw = (sheet as typeof sheet & { calculation?: CalculationSpec }).calculation;
    if (!raw) continue;
    const ids = content.stableIds[sheetId];
    if (!ids) continue;
    const cells: Record<string, CalculationCell> = {}, locations = new Map<string, TableCell>();
    for (const [row, rowId] of ids.rows.entries()) for (const [column, columnId] of ids.columns.entries()) {
      const id = tableCellTargetId(sheetId, rowId, columnId), cell = sheet.cellData[row]?.[column];
      if (cell) { cells[id] = { value: cell.v, formula: cell.f }; locations.set(id, cell); }
    }
    const result = evaluateCalculation(raw, cells); results[sheetId] = result;
    if (result.state === 'modified') continue;
    for (const [id, value] of Object.entries(result.values)) {
      const cell = locations.get(id);
      if (cell) { cell.v = value ?? ''; cell.t = 1; }
    }
  }
  return { content, results };
}
