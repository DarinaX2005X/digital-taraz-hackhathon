import { requireTable, type TableContent } from './model';

/** Unconfirmed results are never displayed as if they survived a changed input.
 * Formatting alone keeps the existing cache. The checked command fills it again. */
export function editableChange(before: TableContent, desired: TableContent): TableContent {
  const content = requireTable(desired);
  let changedInput = false;
  for (const id of content.workbook.sheetOrder) {
    const sheet = content.workbook.sheets[id]!, old = before.workbook.sheets[id];
    for (const row of new Set([...Object.keys(old?.cellData ?? {}), ...Object.keys(sheet.cellData)])) for (const column of new Set([...Object.keys(old?.cellData[row] ?? {}), ...Object.keys(sheet.cellData[row] ?? {})])) {
      const a = old?.cellData[row]?.[column], b = sheet.cellData[row]?.[column];
      if (a?.f !== b?.f || !a?.f && !b?.f && (a?.v !== b?.v || a?.t !== b?.t)) changedInput = true;
    }
  }
  if (changedInput) for (const sheet of Object.values(content.workbook.sheets)) for (const row of Object.values(sheet.cellData)) for (const cell of Object.values(row)) if (cell.f) { delete cell.v; delete cell.t; }
  return content;
}
