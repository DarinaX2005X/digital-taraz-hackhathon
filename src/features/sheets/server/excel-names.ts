import { LexerTreeBuilder, deserializeRangeWithSheet, sequenceNodeType, serializeRangeWithSheet } from '@univerjs/engine-formula';
import type { TableContent } from '../domain/model';

/** Excel worksheet limits differ from our human-readable titles. Make the output
 * names unique before rewriting references; never let ExcelJS truncate silently. */
export function excelSheetNames(content: TableContent) {
  const names = new Map<string, string>(), used = new Set<string>();
  for (const sheetId of content.workbook.sheetOrder) {
    const original = content.workbook.sheets[sheetId]!.name;
    let base = original.replace(/[*?:/\\[\]]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Sheet';
    if (base.toLocaleLowerCase('en-US') === 'history') base = 'History_';
    base = base.slice(0, 31); let name = base, index = 2;
    while (used.has(name.toLocaleLowerCase('en-US'))) { const suffix = ` (${index++})`; name = `${base.slice(0, 31 - suffix.length)}${suffix}`; }
    used.add(name.toLocaleLowerCase('en-US')); names.set(original.toLocaleLowerCase('en-US'), name);
  }
  return names;
}
export function excelFormulaNames(formula: string, names: Map<string, string>): string {
  const lexer = new LexerTreeBuilder();
  try {
    const nodes = lexer.sequenceNodesBuilder(formula); if (!nodes) return formula;
    const transformed = nodes.map((node) => {
      if (typeof node === 'string') return node;
      if (node.nodeType !== sequenceNodeType.REFERENCE) return node.token;
      const ref = deserializeRangeWithSheet(node.token), name = names.get((ref.sheetName ?? '').toLocaleLowerCase('en-US'));
      return name && name !== ref.sheetName ? serializeRangeWithSheet(name, ref.range) : node.token;
    }).join('');
    return transformed.startsWith('=') ? transformed : `=${transformed}`;
  } finally { lexer.dispose(); }
}
