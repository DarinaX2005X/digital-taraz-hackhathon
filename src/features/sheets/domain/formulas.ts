import { LexerTreeBuilder, deserializeRangeWithSheet, sequenceNodeType, type ISequenceNode } from '@univerjs/engine-formula';
import type { IRange } from '@univerjs/core';
import type { CellAddress, TableContent } from './model';

export const SUPPORTED_FUNCTIONS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'ROUND', 'IF', 'IFERROR', 'COUNT', 'COUNTA', 'COUNTIF', 'SUMIF', 'SUMIFS'] as const;
const supported = new Set<string>(SUPPORTED_FUNCTIONS);
const unsafe = new Set(['WEBSERVICE', 'HYPERLINK', 'IMAGE', 'IMPORTXML', 'IMPORTDATA', 'IMPORTHTML', 'RTD', 'DDE', 'CALL', 'REGISTER.ID', 'EXEC']);
export type FormulaDiagnosticCode = 'unsupported' | 'unsafe' | 'syntax' | 'reference' | 'cycle' | 'calculation' | 'complexity' | 'unit-mismatch';
export type FormulaDiagnostic = CellAddress & { code: FormulaDiagnosticCode; detail: string; formula: string };
export type FormulaReference = { sheetId: string; range: IRange };
export type FormulaInspection = { nodes: (string | ISequenceNode)[]; references: FormulaReference[]; issue?: { code: FormulaDiagnosticCode; detail: string } };

export function inspectFormula(formula: string, content: TableContent, sheetId: string): FormulaInspection {
  const bad = (code: FormulaDiagnosticCode, detail: string): FormulaInspection => ({ nodes: [], references: [], issue: { code, detail } });
  if (!formula.startsWith('=') || formula.length > 8000) return bad('syntax', '#VALUE!');
  const lexer = new LexerTreeBuilder();
  try {
    const nodes = lexer.sequenceNodesBuilder(formula);
    if (!nodes?.length || lexer.treeBuilder(formula) === '#VALUE!' || !lexer.isBracketClose() || !lexer.isDoubleQuotationClose()) return bad('syntax', '#VALUE!');
    const references: FormulaReference[] = [];
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.nodeType === sequenceNodeType.FUNCTION) {
        const name = node.token.toUpperCase();
        if (unsafe.has(name)) return bad('unsafe', name);
        if (!supported.has(name)) return bad('unsupported', name);
      }
      if (node.nodeType === sequenceNodeType.DEFINED_NAME || node.nodeType === sequenceNodeType.TABLE || node.nodeType === sequenceNodeType.ARRAY) return bad('unsupported', node.token);
      if (node.nodeType === sequenceNodeType.REFERENCE) {
        const ref = deserializeRangeWithSheet(node.token);
        if (ref.unitId || /\[|\]|\|/.test(node.token)) return bad('unsafe', '#REF!');
        const target = ref.sheetName
          ? content.workbook.sheetOrder.find((id) => content.workbook.sheets[id]!.name.toLocaleLowerCase('en-US') === ref.sheetName.toLocaleLowerCase('en-US'))
          : sheetId;
        if (!target) return bad('reference', '#REF!');
        references.push({ sheetId: target, range: ref.range });
      }
    }
    return { nodes, references };
  } catch { return bad('syntax', '#VALUE!'); }
  finally { lexer.dispose(); }
}

export function copyFormula(formula: string, deltaRow: number, deltaColumn: number): string {
  const lexer = new LexerTreeBuilder();
  try { return lexer.moveFormulaRefOffset(formula, deltaColumn, deltaRow); }
  finally { lexer.dispose(); }
}
