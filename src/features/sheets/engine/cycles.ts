import type { FormulaReference } from '../domain/formulas';
import type { CellAddress, TableContent } from '../domain/model';

export const formulaKey = ({ sheetId, row, column }: CellAddress) => `${sheetId}:${row}:${column}`;

/** Iterative SCC traversal avoids recursion overflow on long, valid formula chains. */
export function findFormulaCycles(content: TableContent, formulas: Map<string, { address: CellAddress; references: FormulaReference[] }>): Set<string> {
  const graph = new Map<string, string[]>(), reverse = new Map<string, string[]>();
  for (const key of formulas.keys()) { graph.set(key, []); reverse.set(key, []); }
  for (const [key, { references }] of formulas) {
    const dependencies = new Set<string>();
    for (const { sheetId, range } of references) {
      const sheet = content.workbook.sheets[sheetId]!;
      for (let row = Math.max(0, range.startRow); row <= Math.min(sheet.rowCount - 1, range.endRow); row++) {
        for (let column = Math.max(0, range.startColumn); column <= Math.min(sheet.columnCount - 1, range.endColumn); column++) {
          const target = formulaKey({ sheetId, row, column });
          if (formulas.has(target)) dependencies.add(target);
        }
      }
    }
    graph.set(key, [...dependencies]);
    for (const target of dependencies) reverse.get(target)!.push(key);
  }
  const visited = new Set<string>(), order: string[] = [];
  for (const root of formulas.keys()) {
    if (visited.has(root)) continue;
    visited.add(root);
    const stack = [{ key: root, next: 0 }];
    while (stack.length) {
      const current = stack[stack.length - 1]!, edges = graph.get(current.key)!;
      if (current.next < edges.length) {
        const target = edges[current.next++]!;
        if (!visited.has(target)) { visited.add(target); stack.push({ key: target, next: 0 }); }
      } else { order.push(current.key); stack.pop(); }
    }
  }
  visited.clear();
  const cycles = new Set<string>();
  for (const root of order.reverse()) {
    if (visited.has(root)) continue;
    const component: string[] = [], stack = [root];
    visited.add(root);
    while (stack.length) {
      const key = stack.pop()!;
      component.push(key);
      for (const target of reverse.get(key)!) if (!visited.has(target)) { visited.add(target); stack.push(target); }
    }
    if (component.length > 1 || graph.get(root)!.includes(root)) for (const key of component) cycles.add(key);
  }
  return cycles;
}
