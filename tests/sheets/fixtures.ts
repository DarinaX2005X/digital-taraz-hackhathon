import { snapshot as artifactSnapshot } from '../artifacts/client/fixtures';
import { createBlankTable, type TableContent } from '@/features/sheets/domain/model';
export function table(): TableContent { const content = createBlankTable('Data', { rows: 10, columns: 5 }); content.workbook.sheets[content.workbook.sheetOrder[0]!]!.cellData = { 0: { 0: { v: 10, t: 2 }, 1: { v: 20, t: 2 } }, 1: { 0: { f: '=SUM(A1:B1)', v: 30, t: 2 } } }; return content; }
export function snapshot(content = table()) { const original = artifactSnapshot(); return { ...original, artifact: { ...original.artifact, kind: 'table' as const }, content, history: [] }; }
