import { describe, expect, it } from 'vitest';
import { createBlankTable, type TableContent } from '@/features/sheets/domain/model';
import { rewriteStructuralReferences } from '@/features/sheets/domain/structure';

function fixture() {
  const content = createBlankTable('Data', { rows: 6, columns: 6 });
  const id = content.workbook.sheetOrder[0]!;
  const second = createBlankTable('Report', { rows: 6, columns: 6 }), other = second.workbook.sheetOrder[0]!;
  content.workbook.sheets[other] = second.workbook.sheets[other]!; content.workbook.sheetOrder.push(other); content.stableIds[other] = second.stableIds[other]!;
  return { content, id, other };
}
function remap(input: TableContent, id: string, axis: 'row' | 'column', ids: string[]) {
  const content = structuredClone(input), sheet = content.workbook.sheets[id]!, old = input.stableIds[id]![axis === 'row' ? 'rows' : 'columns'];
  sheet.cellData = {};
  for (const [row, cells] of Object.entries(input.workbook.sheets[id]!.cellData)) for (const [column, cell] of Object.entries(cells)) {
    const r = axis === 'row' ? ids.indexOf(old[Number(row)]!) : Number(row), c = axis === 'column' ? ids.indexOf(old[Number(column)]!) : Number(column);
    if (r >= 0 && c >= 0) (sheet.cellData[r] ??= {})[c] = structuredClone(cell);
  }
  if (axis === 'row') { content.stableIds[id]!.rows = ids; sheet.rowCount = ids.length; } else { content.stableIds[id]!.columns = ids; sheet.columnCount = ids.length; }
  return content;
}
describe('stable structural reference transformation', () => {
  it('moves absolute and relative references across sheets while preserving string literals', () => {
    const { content, id, other } = fixture();
    content.workbook.sheets[other]!.cellData[0] = { 0: { f: '=IF("A2"="A2",Data!$A$2+Data!A2,0)', v: 999, t: 2 } };
    const after = remap(content, id, 'row', ['new-row', ...content.stableIds[id]!.rows]);
    const changes = rewriteStructuralReferences(content, after, id, 'row');
    expect(after.workbook.sheets[other]!.cellData[0]![0]).toEqual({ f: '=IF("A2"="A2",Data!$A$3+Data!A3,0)' });
    expect(changes).toHaveLength(1); expect(changes[0]!.before.v).toBe(999);
    expect(content.workbook.sheets[other]!.cellData[0]![0]!.v).toBe(999);
  });
  it('grows an interior range insertion and shrinks a deleted endpoint', () => {
    const { content, id } = fixture(); content.workbook.sheets[id]!.cellData[5] = { 4: { f: '=SUM(A1:A3)' } };
    const rows = content.stableIds[id]!.rows, after = remap(content, id, 'row', [rows[0]!, 'new-row', ...rows.slice(1)]);
    rewriteStructuralReferences(content, after, id, 'row');
    expect(after.workbook.sheets[id]!.cellData[6]![4]!.f).toBe('=SUM(A1:A4)');
    const deleted = remap(content, id, 'row', rows.slice(1)); rewriteStructuralReferences(content, deleted, id, 'row');
    expect(deleted.workbook.sheets[id]!.cellData[4]![4]!.f).toBe('=SUM(A1:A2)');
  });
  it('marks a deleted direct reference as REF and rejects non-contiguous membership', () => {
    const { content, id } = fixture(); content.workbook.sheets[id]!.cellData[5] = { 4: { f: '=A2' }, 5: { f: '=SUM(A1:A3)' } };
    const rows = content.stableIds[id]!.rows, after = remap(content, id, 'row', rows.filter((_, index) => index !== 1));
    rewriteStructuralReferences(content, after, id, 'row'); expect(after.workbook.sheets[id]!.cellData[4]![4]!.f).toBe('=#REF!');
    const moved = remap(content, id, 'row', [rows[0]!, rows[3]!, rows[1]!, rows[2]!, ...rows.slice(4)]);
    expect(() => rewriteStructuralReferences(content, moved, id, 'row')).toThrow('move-splits-formula-range');
  });
  it('rewrites columns and does not transform inserted formulas twice', () => {
    const { content, id } = fixture(); content.workbook.sheets[id]!.cellData[0] = { 5: { f: '=$B1+C$2' } };
    const columns = content.stableIds[id]!.columns, after = remap(content, id, 'column', ['new-column', ...columns]);
    after.workbook.sheets[id]!.cellData[0]![0] = { f: '=B1' };
    rewriteStructuralReferences(content, after, id, 'column');
    expect(after.workbook.sheets[id]!.cellData[0]![6]!.f).toBe('=$C1+D$2');
    expect(after.workbook.sheets[id]!.cellData[0]![0]!.f).toBe('=B1');
  });
});
