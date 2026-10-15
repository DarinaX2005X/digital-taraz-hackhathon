import { LexerTreeBuilder, deserializeRangeWithSheet, serializeRange, sequenceNodeType } from '@univerjs/engine-formula';
import { ContentValidationError } from '@/features/artifacts/domain/canonical';
import type { TableCell } from '@/features/artifacts/domain/content-models';
import { stableCellId, type TableContent } from './model';

export type StructuralFormulaChange = { targetId: string; before: TableCell; after: TableCell };

/** `after` already contains remapped cells and stable axes. Mutates only surviving
 * formula cells in `after`; never changes `before`. Returns exact cell snapshots
 * for the canonical command's guarded inverse, including cross-sheet formulas. */
export function rewriteStructuralReferences(before: TableContent, after: TableContent, changedSheetId: string, axis: 'row' | 'column'): StructuralFormulaChange[] {
  const oldIds = before.stableIds[changedSheetId]?.[axis === 'row' ? 'rows' : 'columns'];
  const newIds = after.stableIds[changedSheetId]?.[axis === 'row' ? 'rows' : 'columns'];
  if (!oldIds || !newIds) throw new ContentValidationError('missing-sheet');
  const newIndex = new Map(newIds.map((id, index) => [id, index]));
  const oldSet = new Set(oldIds);
  const changes: StructuralFormulaChange[] = [];
  const lexer = new LexerTreeBuilder();
  try {
    for (const sheetId of after.workbook.sheetOrder) {
      const sheet = after.workbook.sheets[sheetId]!;
      const previousIds = before.stableIds[sheetId];
      if (!previousIds) continue;
      const oldRow = new Map(previousIds.rows.map((id, i) => [id, i]));
      const oldColumn = new Map(previousIds.columns.map((id, i) => [id, i]));
      for (const [row, cells] of Object.entries(sheet.cellData)) for (const [column, cell] of Object.entries(cells)) {
        if (!cell.f) continue;
        const r = oldRow.get(after.stableIds[sheetId]!.rows[Number(row)]!);
        const c = oldColumn.get(after.stableIds[sheetId]!.columns[Number(column)]!);
        // Inserted formula cells are already expressed in the new coordinate space.
        const original = r === undefined || c === undefined ? undefined : before.workbook.sheets[sheetId]?.cellData[r]?.[c];
        if (!original?.f) continue;
        const nodes = lexer.sequenceNodesBuilder(original.f);
        if (!nodes) throw new ContentValidationError('invalid-formula-structure');
        let changed = false;
        const formula = nodes.map((node) => {
          if (typeof node === 'string') return node;
          if (node.nodeType !== sequenceNodeType.REFERENCE) return node.token;
          const reference = deserializeRangeWithSheet(node.token);
          if (reference.unitId) throw new ContentValidationError('external-formula-reference');
          const target = reference.sheetName ? before.workbook.sheetOrder.find((id) => before.workbook.sheets[id]!.name.toLocaleLowerCase('en-US') === reference.sheetName.toLocaleLowerCase('en-US')) : sheetId;
          if (target !== changedSheetId) return node.token;
          const range = { ...reference.range };
          const startKey = axis === 'row' ? 'startRow' : 'startColumn';
          const endKey = axis === 'row' ? 'endRow' : 'endColumn';
          const start = range[startKey], end = range[endKey];
          // Entire-column/row references remain entire-column/row references.
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) return node.token;
          if (start >= oldIds.length || end >= oldIds.length) throw new ContentValidationError('formula-reference-outside-sheet');
          const members = new Set(oldIds.slice(start, end + 1));
          const positions = [...members].flatMap((id) => newIndex.has(id) ? [newIndex.get(id)!] : []).sort((a, b) => a - b);
          if (!positions.length) { changed = true; return '#REF!'; }
          const first = positions[0]!, last = positions.at(-1)!;
          // Insertions inside a range join it; moving unrelated existing members
          // into a range would change its meaning and requires an explicit edit.
          if (newIds.slice(first, last + 1).some((id) => oldSet.has(id) && !members.has(id))) throw new ContentValidationError('move-splits-formula-range');
          if (first === start && last === end) return node.token;
          range[startKey] = first; range[endKey] = last; changed = true;
          // Keep the original quoting/case of the sheet qualifier and $ anchors.
          const bang = node.token.lastIndexOf('!');
          return (bang < 0 ? '' : node.token.slice(0, bang + 1)) + serializeRange(range);
        }).join('');
        if (!changed) continue;
        const next: TableCell = { ...cell, f: formula.startsWith('=') ? formula : `=${formula}` };
        delete next.v; delete next.t;
        sheet.cellData[row]![column] = next;
        changes.push({ targetId: stableCellId(after, { sheetId, row: Number(row), column: Number(column) }), before: structuredClone(original), after: structuredClone(next) });
      }
    }
    return changes;
  } finally { lexer.dispose(); }
}
