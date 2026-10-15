import { LocaleType, LogLevel, Univer, UniverInstanceType, type IWorkbookData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverDocsPlugin } from '@univerjs/docs';
import { ERROR_TYPE_SET, UniverFormulaEnginePlugin, type ErrorType } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-formula/facade';
import '@univerjs/sheets-numfmt/facade';
import { inspectFormula, type FormulaDiagnostic, type FormulaReference } from '../domain/formulas';
import { columnUnit, requireTable, type CellAddress, type TableContent } from '../domain/model';
import { findFormulaCycles, formulaKey } from './cycles';

export type CalculationResult = { content: TableContent; diagnostics: FormulaDiagnostic[]; formulaCount: number };

/** Registers only model services. No DOM, canvas, rendering surface or browser is created. */
export function createDataEngine(content: TableContent) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS }, logLevel: LogLevel.ERROR });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  const api = FUniver.newAPI(univer);
  univer.createUnit(UniverInstanceType.UNIVER_SHEET, structuredClone(content.workbook) as unknown as IWorkbookData);
  return { univer, api };
}

export async function calculateWorkbook(input: TableContent, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CalculationResult> {
  const content = requireTable(structuredClone(input));
  const temporary = structuredClone(content);
  const diagnostics: FormulaDiagnostic[] = [];
  const formulas = new Map<string, { address: CellAddress; references: FormulaReference[] }>();
  let formulaCount = 0, referencedCells = 0;
  options.signal?.throwIfAborted();
  for (const [sheetId, sheet] of Object.entries(temporary.workbook.sheets)) {
    for (const [row, cells] of Object.entries(sheet.cellData)) for (const [column, cell] of Object.entries(cells)) {
      if (!cell.f) continue;
      formulaCount++;
      const address = { sheetId, row: Number(row), column: Number(column) };
      const inspection = inspectFormula(cell.f, content, sheetId);
      let issue = inspection.issue;
      const units = new Set<string>();
      for (const reference of inspection.references) {
        const target = content.workbook.sheets[reference.sheetId]!;
        const startRow = Math.max(0, reference.range.startRow), endRow = Math.min(target.rowCount - 1, reference.range.endRow);
        const startColumn = Math.max(0, reference.range.startColumn), endColumn = Math.min(target.columnCount - 1, reference.range.endColumn);
        referencedCells += Math.max(0, endRow - startRow + 1) * Math.max(0, endColumn - startColumn + 1);
        for (let c = startColumn; c <= endColumn; c++) {
          const unit = columnUnit(content, reference.sheetId, c);
          if (unit?.kind === 'money') units.add(`money:${unit.currency}`);
          if (unit?.kind === 'quantity') units.add(`quantity:${unit.unit}`);
        }
      }
      if (units.size > 1 && /^=\s*(?:SUM|AVERAGE|MIN|MAX)\s*\(/i.test(cell.f)) issue = { code: 'unit-mismatch', detail: [...units].join(', ') };
      if (formulaCount > 20_000 || referencedCells > 10_000_000) issue = { code: 'complexity', detail: '#NUM!' };
      // Never accept cached results from a source workbook or previous revision.
      delete cell.v; delete cell.t;
      if (issue) {
        diagnostics.push({ ...address, formula: cell.f, ...issue });
        const error = issue.code === 'reference' ? '#REF!' : issue.code === 'syntax' || issue.code === 'unit-mismatch' ? '#VALUE!' : issue.code === 'complexity' ? '#NUM!' : '#NAME?';
        cell.f = `=${error}`;
      } else formulas.set(formulaKey(address), { address, references: inspection.references });
    }
  }
  if (!formulaCount) return { content, diagnostics, formulaCount };
  // Univer can publish zero for an SCC and its dependants. Break only the cyclic
  // members into explicit error values before evaluation; dependent IFERROR is
  // still allowed to recover, while SUM/arithmetic propagate the actual error.
  const cycles = findFormulaCycles(content, formulas);
  for (const key of cycles) {
    const { address } = formulas.get(key)!;
    const cell = temporary.workbook.sheets[address.sheetId]!.cellData[address.row]![address.column]!;
    diagnostics.push({ ...address, formula: cell.f!, code: 'cycle', detail: '#CYCLE!' });
    cell.f = '=#CYCLE!';
    delete cell.v; delete cell.t;
  }
  const { univer, api } = createDataEngine(temporary);
  try {
    const formula = api.getFormula();
    const completion = formula.onCalculationResultApplied(options.timeoutMs ?? 10_000);
    formula.executeCalculation();
    await completion;
    options.signal?.throwIfAborted();
    const saved = api.getActiveWorkbook()?.save();
    if (!saved) throw new Error('sheets.errors.calculation');
    for (const [sheetId, sheet] of Object.entries(content.workbook.sheets)) {
      for (const [row, cells] of Object.entries(sheet.cellData)) for (const [column, cell] of Object.entries(cells)) {
        if (!cell.f) continue;
        const calculated = saved.sheets[sheetId]?.cellData?.[Number(row)]?.[Number(column)];
        const value = calculated?.v;
        delete cell.v; delete cell.t;
        if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
          cell.v = value;
          cell.t = typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : 1;
        } else { cell.v = '#VALUE!'; cell.t = 4; }
        if (typeof cell.v === 'string' && ERROR_TYPE_SET.has(cell.v as ErrorType) && !diagnostics.some((item) => item.sheetId === sheetId && item.row === Number(row) && item.column === Number(column))) {
          diagnostics.push({ sheetId, row: Number(row), column: Number(column), formula: cell.f, code: 'calculation', detail: String(cell.v) });
        }
      }
    }
    return { content, diagnostics, formulaCount };
  } finally { univer.dispose(); }
}
