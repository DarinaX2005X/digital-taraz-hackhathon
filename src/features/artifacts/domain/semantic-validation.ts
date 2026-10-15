import { z } from 'zod';
import { ElementIdSchema, IdSchema } from '../../../contracts/primitives';
import { ArtifactContentSchema, DocumentNodeSchema, DesignLayerSchema, PlanEntrySchema, TableCellSchema, type ArtifactContent, type DesignLayer, type DocumentNode, type JsonValue, type PlanEntry, type TableCell } from './content-models';
import { assertBoundedJson, ContentValidationError, CONTENT_LIMITS, stableToken } from './canonical';
import { parseCellTargetId } from './targets';

function fail(reason: string, path: readonly (string | number)[] = []): never { throw new ContentValidationError(reason, path); }
const blocks = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'table', 'image', 'pageBreak']);
const inline = new Set(['text', 'hardBreak', 'dataField']);
const color = /^(?:#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})|transparent)$/;
const safeLink = (href: unknown) => {
  if (typeof href !== 'string' || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return false;
  try { return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(href).protocol); } catch { return false; }
};

export function uniqueIds(values: readonly string[], reason = 'duplicate-element-id'): void {
  if (new Set(values).size !== values.length) fail(reason);
}

function identity(value: unknown, ids: Set<string>): string {
  const result = ElementIdSchema.safeParse(value);
  if (!result.success) return fail('missing-stable-id');
  if (['__proto__', 'constructor', 'prototype'].includes(result.data)) fail('unsafe-element-id');
  if (ids.has(result.data)) fail('duplicate-element-id');
  ids.add(result.data);
  return result.data;
}

function checkAttrs(node: DocumentNode): void {
  const attrs = node.attrs ?? {};
  const allowed = new Set(['id']);
  if (node.type === 'heading') { allowed.add('level'); if (!Number.isInteger(attrs.level) || Number(attrs.level) < 1 || Number(attrs.level) > 6) fail('invalid-heading-level'); }
  if (node.type === 'paragraph' || node.type === 'heading') {
    allowed.add('textAlign');
    if (attrs.textAlign !== undefined && !['left', 'center', 'right', 'justify'].includes(String(attrs.textAlign))) fail('invalid-text-alignment');
  }
  if (node.type === 'orderedList') { allowed.add('start'); if (attrs.start !== undefined && (!Number.isInteger(attrs.start) || Number(attrs.start) < 1)) fail('invalid-list-start'); }
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    for (const key of ['colspan', 'rowspan', 'colwidth']) allowed.add(key);
    for (const key of ['colspan', 'rowspan']) if (attrs[key] !== undefined && (!Number.isInteger(attrs[key]) || Number(attrs[key]) < 1 || Number(attrs[key]) > 100)) fail('invalid-table-span');
    if (attrs.colwidth !== undefined && (!Array.isArray(attrs.colwidth) || attrs.colwidth.length !== Number(attrs.colspan ?? 1) || attrs.colwidth.some((width) => typeof width !== 'number' || width <= 0 || width > 100000))) fail('invalid-column-width');
  }
  if (node.type === 'image') {
    for (const key of ['assetId', 'alt', 'title', 'width', 'height']) allowed.add(key);
    if (!IdSchema.safeParse(attrs.assetId).success) fail('image-requires-asset-id');
    for (const key of ['alt', 'title']) if (attrs[key] !== undefined && (typeof attrs[key] !== 'string' || attrs[key].length > 2000)) fail('invalid-image-description');
    for (const key of ['width', 'height']) if (attrs[key] !== undefined && (typeof attrs[key] !== 'number' || attrs[key] <= 0 || attrs[key] > 100000)) fail('invalid-image-size');
  }
  if (node.type === 'dataField') { allowed.add('value'); if (typeof attrs.value !== 'string' || attrs.value.length > 100000) fail('invalid-data-field'); }
  if (Object.keys(attrs).some((key) => !allowed.has(key))) fail('unsupported-node-attribute');
}

function checkMarks(node: DocumentNode): void {
  if (node.marks?.length && !['text', 'dataField'].includes(node.type)) fail('marks-require-inline-node');
  uniqueIds(node.marks?.map((mark) => mark.type) ?? [], 'duplicate-mark');
  for (const mark of node.marks ?? []) {
    const attrs = mark.attrs ?? {};
    if (mark.type === 'link') {
      if (!safeLink(attrs.href) || Object.keys(attrs).some((key) => key !== 'href' && key !== 'title') || (attrs.title !== undefined && (typeof attrs.title !== 'string' || attrs.title.length > 1000))) fail('invalid-link');
    } else if (mark.type === 'textStyle') {
      if (Object.keys(attrs).some((key) => !['color', 'backgroundColor', 'fontSize', 'fontFamily'].includes(key))) fail('unsupported-text-style');
      for (const key of ['color', 'backgroundColor']) if (attrs[key] !== undefined && (typeof attrs[key] !== 'string' || !color.test(attrs[key]))) fail('invalid-color');
      if (attrs.fontSize !== undefined && (typeof attrs.fontSize !== 'number' || attrs.fontSize < 1 || attrs.fontSize > 400)) fail('invalid-font-size');
      if (attrs.fontFamily !== undefined && (typeof attrs.fontFamily !== 'string' || !/^[\p{L}\p{N} _-]{1,100}$/u.test(attrs.fontFamily))) fail('invalid-font-family');
    } else if (Object.keys(attrs).length) fail('unsupported-mark-attribute');
  }
}

export function validateDocumentTree(document: DocumentNode, root = true): Set<string> {
  if (root && document.type !== 'doc') fail('document-requires-doc-root');
  const ids = new Set<string>();
  const stack: { node: DocumentNode; depth: number; isRoot: boolean }[] = [{ node: document, depth: 0, isRoot: root }];
  let count = 0;
  while (stack.length) {
    const { node, depth, isRoot } = stack.pop()!;
    if (++count > CONTENT_LIMITS.documentNodes || depth > 32) fail('document-too-complex');
    if (node.type === 'doc' && !isRoot) fail('nested-doc-root');
    if (!['text', 'hardBreak'].includes(node.type)) identity(node.attrs?.id, ids);
    else if (node.attrs && Object.keys(node.attrs).length) fail('inline-node-has-attributes');
    checkAttrs(node); checkMarks(node);
    const children = node.content ?? [];
    if (node.type === 'text') { if (typeof node.text !== 'string' || !node.text.length || children.length) fail('invalid-text-node'); }
    else if (node.text !== undefined) fail('unexpected-node-text');
    let allowed: Set<string> | null = null;
    switch (node.type) {
      case 'doc': case 'blockquote': case 'listItem': case 'tableCell': case 'tableHeader': allowed = blocks; break;
      case 'paragraph': case 'heading': allowed = inline; break;
      case 'bulletList': case 'orderedList': allowed = new Set(['listItem']); break;
      case 'table': allowed = new Set(['tableRow']); break;
      case 'tableRow': allowed = new Set(['tableCell', 'tableHeader']); break;
    }
    if ((!allowed && children.length) || (allowed && children.some((child) => !allowed.has(child.type)))) fail('invalid-document-child');
    if (['doc', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader', 'bulletList', 'orderedList'].includes(node.type) && !children.length) fail('empty-document-container');
    if (node.type === 'listItem' && children[0]?.type !== 'paragraph') fail('list-item-requires-paragraph');
    if (node.type === 'table') checkDocumentTable(node);
    for (const child of children) stack.push({ node: child, depth: depth + 1, isRoot: false });
  }
  return ids;
}

function checkDocumentTable(table: DocumentNode): void {
  const rows = table.content ?? [];
  if (rows.length > 20000) fail('table-too-large');
  const occupied = new Set<string>();
  let width = 0;
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.content ?? []) {
      while (occupied.has(`${r}:${c}`)) c++;
      const colspan = Number(cell.attrs?.colspan ?? 1), rowspan = Number(cell.attrs?.rowspan ?? 1);
      if (!Number.isInteger(colspan) || !Number.isInteger(rowspan) || colspan < 1 || rowspan < 1 || c + colspan > 100 || r + rowspan > rows.length) fail('invalid-table-span');
      for (let rr = r; rr < r + rowspan; rr++) for (let cc = c; cc < c + colspan; cc++) {
        const key = `${rr}:${cc}`;
        if (occupied.has(key)) fail('overlapping-table-span');
        occupied.add(key);
      }
      c += colspan;
    }
    while (occupied.has(`${r}:${c}`)) c++;
    width = Math.max(width, c);
  });
  if (!width || rows.some((_, r) => Array.from({ length: width }, (_, c) => !occupied.has(`${r}:${c}`)).some(Boolean))) fail('ragged-document-table');
}

export function validateTableCell(cell: unknown): TableCell {
  assertBoundedJson(cell, { bytes: 768 * 1024, depth: 24, values: 50000 });
  const result = TableCellSchema.safeParse(cell);
  if (!result.success) return fail('invalid-cell');
  if (result.data.f && (!result.data.f.startsWith('=') || /\b(?:WEBSERVICE|HYPERLINK|IMAGE|IMPORTXML|IMPORTDATA|IMPORTHTML|RTD|DDE)\s*\(/i.test(result.data.f) || /\[[^\]]+\]/.test(result.data.f) || result.data.f.includes('|'))) fail('unsafe-formula');
  if (result.data.t === 2 && result.data.v !== undefined && result.data.v !== null && typeof result.data.v !== 'number') fail('cell-type-mismatch');
  if ((result.data.t === 1 || result.data.t === 4) && result.data.v !== undefined && result.data.v !== null && typeof result.data.v !== 'string') fail('cell-type-mismatch');
  if (result.data.t === 3 && result.data.v !== undefined && result.data.v !== null && typeof result.data.v !== 'boolean') fail('cell-type-mismatch');
  return result.data;
}

function validateWorkbook(content: Extract<ArtifactContent, { kind: 'table' }>): void {
  const { workbook, stableIds } = content;
  uniqueIds(workbook.sheetOrder);
  if (Object.keys(workbook.sheets).length !== workbook.sheetOrder.length || Object.keys(stableIds).length !== workbook.sheetOrder.length) fail('sheet-index-mismatch');
  const names = new Set<string>();
  const tokens = new Set<string>();
  let cells = 0;
  for (const sheetId of workbook.sheetOrder) {
    const sheet = workbook.sheets[sheetId], ids = stableIds[sheetId];
    if (!sheet || !ids || sheet.id !== sheetId || ids.rows.length !== sheet.rowCount || ids.columns.length !== sheet.columnCount) fail('sheet-index-mismatch');
    const name = sheet.name.toLocaleLowerCase('en-US');
    if (names.has(name) || /[\[\]:*?/\\]/.test(sheet.name)) fail('invalid-sheet-name');
    names.add(name);
    uniqueIds(ids.rows); uniqueIds(ids.columns);
    const token = stableToken(sheetId);
    if (tokens.has(token)) fail('stable-token-collision');
    tokens.add(token);
    for (const list of [ids.rows, ids.columns]) uniqueIds(list.map(stableToken), 'stable-token-collision');
    if (sheet.freeze && (sheet.freeze.xSplit > sheet.columnCount || sheet.freeze.ySplit > sheet.rowCount || sheet.freeze.startRow >= sheet.rowCount || sheet.freeze.startColumn >= sheet.columnCount)) fail('freeze-outside-sheet');
    uniqueIds((sheet.charts ?? []).map((chart) => chart.id), 'duplicate-chart-id');
    for (const chart of sheet.charts ?? []) {
      uniqueIds(chart.valueColumnIds, 'duplicate-chart-column'); uniqueIds(chart.rowIds, 'duplicate-chart-row');
      // Stable references may become unavailable after a deliberate row/column removal.
      // Consumers must expose that state instead of substituting other data.
      if (chart.valueColumnIds.includes(chart.labelColumnId)) fail('chart-label-is-value-column');
    }
    if (sheet.calculation) {
      const calculation = sheet.calculation;
      const targets = calculation.lines.flatMap((line) => [line.quantityCellId, line.priceCellId, line.amountCellId]);
      targets.push(calculation.subtotalCellId, calculation.totalCellId);
      for (const adjustment of [calculation.discount, calculation.tax]) if (adjustment) targets.push(adjustment.rateCellId, adjustment.amountCellId);
      if (targets.some((id) => parseCellTargetId(id)?.sheetToken !== token)) fail('calculation-target-outside-sheet');
      // Missing stable targets stay explicit in the spec so deletion/undo cannot silently
      // discard financial rules. The evaluator returns unavailable for those targets.
      for (const formula of [calculation.subtotalFormula, calculation.totalFormula, ...calculation.lines.map((line) => line.expectedFormula), ...[calculation.discount, calculation.tax].flatMap((adjustment) => adjustment ? [adjustment.expectedFormula] : [])]) validateTableCell({ f: formula });
    }
    for (const [r, row] of Object.entries(sheet.cellData)) {
      if (Number(r) >= sheet.rowCount) fail('cell-outside-sheet');
      for (const [c, cell] of Object.entries(row)) {
        if (++cells > CONTENT_LIMITS.tableCells || Number(c) >= sheet.columnCount) fail('cell-outside-sheet');
        validateTableCell(cell);
        if (typeof cell.s === 'string' && !Object.hasOwn(workbook.styles ?? {}, cell.s)) fail('missing-cell-style');
      }
    }
    if (Object.keys(sheet.rowData ?? {}).some((r) => Number(r) >= sheet.rowCount) || Object.keys(sheet.columnData ?? {}).some((c) => Number(c) >= sheet.columnCount)) fail('metadata-outside-sheet');
    const ranges = sheet.mergeData ?? [];
    for (const range of ranges) {
      if (range.startRow > range.endRow || range.startColumn > range.endColumn || range.endRow >= sheet.rowCount || range.endColumn >= sheet.columnCount) fail('invalid-merged-range');
    }
    const sorted = [...ranges].sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn);
    const active: typeof sorted = [];
    for (const range of sorted) {
      for (let i = active.length - 1; i >= 0; i--) if (active[i]!.endRow < range.startRow) active.splice(i, 1);
      if (active.some((other) => other.startColumn <= range.endColumn && range.startColumn <= other.endColumn)) fail('overlapping-merged-ranges');
      active.push(range);
    }
  }
}

export function validateDesignTree(layer: DesignLayer): Set<string> {
  const ids = new Set<string>();
  const stack = [{ layer, depth: 0 }];
  while (stack.length) {
    const next = stack.pop()!;
    if (next.depth > 32 || ids.size >= CONTENT_LIMITS.designLayers) fail('design-too-complex');
    const item = next.layer;
    identity(item.id, ids);
    if (Object.values(item.transform).some((n) => Math.abs(n) > 1_000_000)) fail('invalid-layer-transform');
    if (item.type === 'text' && item.text === undefined) fail('text-layer-requires-text');
    if (item.type === 'image' && !item.assetId) fail('image-layer-requires-asset');
    if (item.type === 'shape' && !item.shape) fail('shape-layer-requires-shape');
    if ((item.type !== 'text' && item.text !== undefined) || (item.type !== 'image' && item.assetId !== undefined) || (item.type !== 'shape' && item.shape !== undefined) || (item.type !== 'group' && item.layers !== undefined)) fail('layer-kind-mismatch');
    if ((item.fontAssetId !== undefined && item.type !== 'text') || (item.crop !== undefined && item.type !== 'image')) fail('layer-kind-mismatch');
    if (item.crop && (item.crop.x + item.crop.width > 1 || item.crop.y + item.crop.height > 1)) fail('crop-outside-image');
    if (item.type === 'group' && !item.layers) fail('group-requires-layers');
    for (const [key, value] of Object.entries(item.style)) {
      if (!['fill', 'stroke', 'strokeWidth', 'opacity', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textAlign', 'lineHeight', 'letterSpacing', 'radius'].includes(key)) fail('unsupported-layer-style');
      if (['fill', 'stroke'].includes(key) && (typeof value !== 'string' || !color.test(value))) fail('invalid-color');
      if (['strokeWidth', 'fontSize', 'lineHeight', 'radius'].includes(key) && (typeof value !== 'number' || value < 0 || value > 100000)) fail('invalid-style-number');
      if (key === 'letterSpacing' && (typeof value !== 'number' || value < -1000 || value > 1000)) fail('invalid-style-number');
      if (key === 'opacity' && (typeof value !== 'number' || value < 0 || value > 1)) fail('invalid-opacity');
      if (key === 'fontFamily' && (typeof value !== 'string' || !/^[\p{L}\p{N} _-]{1,100}$/u.test(value))) fail('invalid-font-family');
      if (key === 'fontWeight' && (typeof value !== 'number' || ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(value))) fail('invalid-font-weight');
      if (key === 'fontStyle' && !['normal', 'italic'].includes(String(value))) fail('invalid-font-style');
      if (key === 'textAlign' && !['left', 'center', 'right', 'justify'].includes(String(value))) fail('invalid-text-alignment');
    }
    for (const child of item.layers ?? []) stack.push({ layer: child, depth: next.depth + 1 });
  }
  return ids;
}

export function validatePlanEntry(entry: unknown): PlanEntry {
  const result = PlanEntrySchema.safeParse(entry);
  if (!result.success) return fail('invalid-plan-entry');
  const value = result.data;
  if ((value.startDate && value.startAt) || (value.endDate && value.endAt) || Boolean(value.startDate) !== Boolean(value.endDate) || Boolean(value.startAt) !== Boolean(value.endAt)) fail('mixed-plan-time');
  if ((value.startDate && value.endDate && value.startDate > value.endDate) || (value.startAt && value.endAt && Date.parse(value.startAt) > Date.parse(value.endAt))) fail('reversed-plan-time');
  uniqueIds(value.resourceIds); uniqueIds(value.dependencies); uniqueIds(value.availabilityVersionIds); uniqueIds(value.checklist.map((item) => item.id));
  if (value.dependencies.includes(value.id)) fail('plan-self-dependency');
  return value;
}

function validatePlan(content: Extract<ArtifactContent, { kind: 'plan' }>): void {
  try { new Intl.DateTimeFormat('en', { timeZone: content.timezone }); } catch { fail('invalid-timezone'); }
  const entries = new Map(content.entries.map((entry) => [entry.id, validatePlanEntry(entry)]));
  if (entries.size !== content.entries.length) fail('duplicate-element-id');
  const degree = new Map<string, number>(), dependents = new Map<string, string[]>();
  for (const entry of content.entries) {
    degree.set(entry.id, entry.dependencies.length);
    for (const id of entry.dependencies) {
      if (!entries.has(id)) fail('missing-plan-dependency');
      dependents.set(id, [...(dependents.get(id) ?? []), entry.id]);
    }
  }
  const ready = [...degree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (let i = 0; i < ready.length; i++) {
    visited++;
    for (const id of dependents.get(ready[i]!) ?? []) { const next = degree.get(id)! - 1; degree.set(id, next); if (!next) ready.push(id); }
  }
  if (visited !== entries.size) fail('cyclic-plan-dependency');
}

export function validateArtifactContent(input: unknown): ArtifactContent {
  assertBoundedJson(input);
  const result = ArtifactContentSchema.safeParse(input);
  if (!result.success) return fail('invalid-content-shape', result.error.issues[0]?.path.filter((part): part is string | number => typeof part !== 'symbol'));
  const content = result.data;
  if (content.kind === 'document') validateDocumentTree(content.document);
  if (content.kind === 'table') validateWorkbook(content);
  if (content.kind === 'plan') validatePlan(content);
  if (content.kind === 'design') {
    const ids = new Set<string>();
    let count = 0;
    for (const page of content.pages) {
      identity(page.id, ids);
      if (!color.test(page.background)) fail('invalid-background');
      for (const layer of page.layers) for (const id of validateDesignTree(layer)) { identity(id, ids); if (++count > CONTENT_LIMITS.designLayers) fail('design-too-complex'); }
    }
  }
  return content;
}

export function validateDocumentNode(input: unknown): DocumentNode {
  assertBoundedJson(input, { bytes: CONTENT_LIMITS.bytes, depth: 64 });
  const result = DocumentNodeSchema.safeParse(input);
  if (!result.success) return fail('invalid-document-node');
  validateDocumentTree(result.data, result.data.type === 'doc');
  return result.data;
}

export function validateDesignLayer(input: unknown): DesignLayer {
  assertBoundedJson(input);
  const result = DesignLayerSchema.safeParse(input);
  if (!result.success) return fail('invalid-design-layer');
  validateDesignTree(result.data);
  return result.data;
}

export function parseJsonValue<T>(schema: z.ZodType<T>, input: JsonValue): T {
  const result = schema.safeParse(input);
  if (!result.success) return fail('invalid-operation-value');
  return result.data;
}
