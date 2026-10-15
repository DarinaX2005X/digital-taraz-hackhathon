import { z } from 'zod';
import { BindingTargetPropertySchema, FieldBindingSchema, SourceRefSchema, fieldBindingIdentity, fieldBindingProperty, fieldBindingStateKey, type BindingTargetProperty, type FieldBinding } from '../../../contracts/artifacts';
import { CommandOperationSchema } from '../../../contracts/commands';
import { ElementIdSchema } from '../../../contracts/primitives';
import { ContentValidationError, CONTENT_LIMITS, assertBoundedJson, hashJson, measureJson, jsonBytes } from './canonical';
import { collectSourceRefs, countTreeNodes, measureArtifactContent } from './content-state';
import { TableSheetSettingsSchema, type ArtifactContent, type DesignLayer, type DocumentNode, type JsonValue, type TableCell, type TableSheet } from './content-models';
import { MerkleJson, type JsonPath } from './merkle-json';
import { buildTargetIndex, describeTarget, locateTarget, parseCellTargetId, readPath, replaceTargetPropertyValue, tableColumnTargetId, tableRowTargetId, tableSheetTargetId, targetPropertyValue, targetValue, type ArtifactState, type ArtifactTarget, type TargetLocator, type TargetLock } from './targets';
import { validateArtifactContent, validateDesignLayer, validateDocumentNode, validateTableCell, parseJsonValue } from './semantic-validation';

export type ArtifactOperation = z.infer<typeof CommandOperationSchema>;
export interface OperationContext { actorId: string; at: string; reason: string; origin: 'human' | 'ai' | 'import' | 'history' }
export interface MetadataRestore { binding: FieldBinding | null; lock: TargetLock | null; targetElementId?: string; targetProperty?: BindingTargetProperty }
export interface ReversibleOperation {
  operation: ArtifactOperation; metadata: Record<string, MetadataRestore>; metadataExpectedHashes?: Record<string, string | null>;
  sheetMerges?: { sheetId: string; value: JsonValue | null; expectedHash: string };
  tableFormulas?: { targetId: string; value: TableCell; expectedHash: string | null }[];
  tableSettings?: { sheetId: string; key: 'freeze' | 'calculation'; value: JsonValue | null; expectedHash: string }[];
}
export interface AppliedOperations { root: string; inverse: ReversibleOperation[]; beforeHashes: Record<string, string | null>; afterHashes: Record<string, string | null> }

export class TargetConflictError extends Error {
  constructor(public readonly targetId: string, public readonly reason: 'before-hash' | 'locked' | 'target-missing', public readonly expectedHash: string | null, public readonly currentHash: string | null) { super(reason); }
}

const PlacementSchema = z.strictObject({ parentId: ElementIdSchema.optional(), beforeId: ElementIdSchema.nullable() });
const InsertSchema = PlacementSchema.extend({ node: z.json() });
const TableInsertSchema = z.strictObject({ sheetId: ElementIdSchema, axis: z.enum(['row', 'column']), id: ElementIdSchema, beforeId: ElementIdSchema.nullable(), cells: z.record(ElementIdSchema, z.json()).default({}), data: z.record(z.string(), z.json()).optional() });
const BindSchema = z.strictObject({ sourceRef: SourceRefSchema, transformId: ElementIdSchema, updateMode: z.enum(['deterministic', 'propose', 'manual']), targetProperty: BindingTargetPropertySchema.optional(), overrideReason: z.string().trim().min(1).max(1000).optional() });
const LockSchema = z.strictObject({ locked: z.boolean(), reason: z.string().trim().min(1).max(1000).optional() }).refine((value) => !value.locked || !!value.reason);

function asJson(value: unknown): JsonValue { return value as JsonValue; }
function operationTargetKey(operation: Pick<ArtifactOperation, 'targetId' | 'targetProperty'>): string {
  return operation.targetProperty ? fieldBindingStateKey(operation.targetId, operation.targetProperty) : operation.targetId;
}
function safeSet(content: ArtifactContent, path: JsonPath, value: unknown): void {
  if (!path.length) throw new ContentValidationError('cannot-replace-kind-envelope');
  let current = content as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    if (['__proto__', 'constructor', 'prototype'].includes(String(key))) throw new ContentValidationError('unsafe-property');
    current = current[key] as Record<string | number, unknown>;
    if (!current) throw new ContentValidationError('missing-target-path');
  }
  const last = path.at(-1)!;
  if (Array.isArray(current) && value === undefined) current.splice(Number(last), 1);
  else if (value === undefined) delete current[last];
  else current[last] = value;
}

function sameLocatorIds(before: ArtifactContent, after: ArtifactContent): boolean {
  const a = buildTargetIndex(before), b = buildTargetIndex(after);
  const keys = Object.keys(a.targets);
  return keys.length === Object.keys(b.targets).length && keys.every((key) => JSON.stringify(a.targets[key]) === JSON.stringify(b.targets[key]));
}
function documentGeometry(node: DocumentNode): string {
  const stack = [node], shape: JsonValue[] = [];
  while (stack.length) { const item = stack.pop()!; if (['table', 'tableRow', 'tableCell', 'tableHeader'].includes(item.type)) shape.push({ id: item.attrs?.id ?? null, type: item.type, colspan: item.attrs?.colspan ?? 1, rowspan: item.attrs?.rowspan ?? 1, colwidth: item.attrs?.colwidth ?? null }); stack.push(...item.content ?? []); }
  return hashJson(shape);
}

function siblingPlacement(state: ArtifactState, target: TargetLocator): { parentId?: string; beforeId: string | null } {
  const siblings = Object.entries(state.index.targets).filter(([, candidate]) => candidate.kind === target.kind && candidate.parentId === target.parentId && candidate.position !== undefined).sort(([, a], [, b]) => a.position! - b.position!);
  const next = siblings.find(([, candidate]) => candidate.position! > (target.position ?? -1));
  return { ...(target.parentId === undefined ? {} : { parentId: target.parentId }), beforeId: next?.[0] ?? null };
}

function insertedNodeId(content: ArtifactContent, node: JsonValue): string | undefined {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined;
  if (content.kind === 'document') return typeof (node.attrs as Record<string, unknown> | undefined)?.id === 'string' ? (node.attrs as Record<string, string>).id : undefined;
  return typeof node.id === 'string' ? node.id : undefined;
}

function insertionContainer(state: ArtifactState, parentId: string | undefined, targetKind?: TargetLocator['kind']): { path: (string | number)[]; array: unknown[] } {
  const content = state.content;
  if (content.kind === 'plan') {
    if (parentId !== undefined) throw new ContentValidationError('plan-entry-has-no-parent');
    return { path: ['entries'], array: content.entries };
  }
  if (content.kind === 'design' && parentId === undefined && (targetKind === undefined || targetKind === 'design-page')) return { path: ['pages'], array: content.pages };
  if (parentId === undefined) throw new ContentValidationError('missing-insert-parent');
  const parent = locateTarget(state.index, parentId);
  if (!parent) throw new ContentValidationError('missing-insert-parent');
  const value = readPath(content, parent.path) as Record<string, unknown>;
  if (content.kind === 'document') {
    if (!['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader'].includes(String(value.type))) throw new ContentValidationError('invalid-insert-parent');
    if (!value.content) value.content = [];
    return { path: [...parent.path, 'content'], array: value.content as unknown[] };
  }
  if (content.kind === 'design' && (parent.kind === 'design-page' || (parent.kind === 'design-layer' && value.type === 'group'))) {
    if (!value.layers) value.layers = [];
    return { path: [...parent.path, 'layers'], array: value.layers as unknown[] };
  }
  throw new ContentValidationError('invalid-insert-parent');
}

function insertPosition(state: ArtifactState, parentId: string | undefined, beforeId: string | null, array: unknown[]): number {
  if (beforeId === null) return array.length;
  const before = locateTarget(state.index, beforeId);
  if (!before || before.parentId !== parentId || before.position === undefined) throw new ContentValidationError('invalid-insert-position');
  return before.position;
}

function reorderSheet(sheet: TableSheet, axis: 'row' | 'column', oldIds: string[], newIds: string[]): void {
  const existingIds = new Set(oldIds);
  const nextIndex = new Map(newIds.map((id, i) => [id, String(i)]));
  const remap = (old: string) => nextIndex.get(oldIds[Number(old)]!);
  const cellData: TableSheet['cellData'] = {};
  for (const [r, cells] of Object.entries(sheet.cellData)) {
    const newRow = axis === 'row' ? remap(r) : r;
    if (newRow === undefined) continue;
    const output: Record<string, TableCell> = {};
    for (const [c, cell] of Object.entries(cells)) {
      const newColumn = axis === 'column' ? remap(c) : c;
      if (newColumn !== undefined) output[newColumn] = cell;
    }
    if (Object.keys(output).length) cellData[newRow] = output;
  }
  sheet.cellData = cellData;
  const data = axis === 'row' ? sheet.rowData : sheet.columnData;
  const shifted: Record<string, Record<string, JsonValue>> = {};
  for (const [position, value] of Object.entries(data ?? {})) { const next = remap(position); if (next !== undefined) shifted[next] = value; }
  if (axis === 'row') { sheet.rowCount = newIds.length; if (sheet.rowData) sheet.rowData = shifted; }
  else { sheet.columnCount = newIds.length; if (sheet.columnData) sheet.columnData = shifted; }
  const merges: NonNullable<TableSheet['mergeData']> = [];
  for (const merge of sheet.mergeData ?? []) {
    const start = axis === 'row' ? merge.startRow : merge.startColumn, end = axis === 'row' ? merge.endRow : merge.endColumn;
    const positions = oldIds.slice(start, end + 1).map((id) => nextIndex.get(id)).filter((index): index is string => index !== undefined).map(Number).sort((a, b) => a - b);
    if (!positions.length) continue;
    const mergedIds = new Set(oldIds.slice(start, end + 1));
    if (newIds.slice(positions[0]!, positions.at(-1)! + 1).some((id) => existingIds.has(id) && !mergedIds.has(id))) throw new ContentValidationError('move-splits-merged-range');
    merges.push(axis === 'row' ? { ...merge, startRow: positions[0]!, endRow: positions.at(-1)! } : { ...merge, startColumn: positions[0]!, endColumn: positions.at(-1)! });
  }
  if (sheet.mergeData) sheet.mergeData = merges;
}

function tableInsertValue(state: ArtifactState, locator: TargetLocator): JsonValue {
  const content = state.content as Extract<ArtifactContent, { kind: 'table' }>;
  const sheetId = locator.sheetId!, sheet = content.workbook.sheets[sheetId]!, ids = content.stableIds[sheetId]!;
  const axis = locator.kind === 'table-row' ? 'row' : 'column';
  const cells: Record<string, JsonValue> = {};
  if (axis === 'row') for (const [column, cell] of Object.entries(sheet.cellData[String(locator.position)] ?? {})) cells[ids.columns[Number(column)]!] = asJson(cell);
  else for (const [row, values] of Object.entries(sheet.cellData)) if (values[String(locator.position)]) cells[ids.rows[Number(row)]!] = asJson(values[String(locator.position)]);
  const data = axis === 'row' ? sheet.rowData?.[String(locator.position)] : sheet.columnData?.[String(locator.position)];
  return { sheetId, axis, id: (axis === 'row' ? locator.rowId : locator.columnId)!, beforeId: siblingPlacement(state, locator).beforeId, cells, ...(data ? { data } : {}) };
}

function mutateTableStructure(state: ArtifactState, operation: ArtifactOperation, locator: TargetLocator | undefined): ArtifactOperation {
  const content = state.content as Extract<ArtifactContent, { kind: 'table' }>;
  if (operation.op === 'insert') {
    const value = parseJsonValue(TableInsertSchema, operation.value!);
    const sheet = content.workbook.sheets[value.sheetId], ids = content.stableIds[value.sheetId];
    if (!sheet || !ids) throw new ContentValidationError('missing-sheet');
    const list = value.axis === 'row' ? ids.rows : ids.columns, targetId = value.axis === 'row' ? tableRowTargetId(value.sheetId, value.id) : tableColumnTargetId(value.sheetId, value.id);
    if (operation.targetId !== targetId || list.includes(value.id)) throw new ContentValidationError('invalid-insert-identity');
    const before = value.beforeId === null ? undefined : locateTarget(state.index, value.beforeId);
    if (value.beforeId !== null && (!before || before.sheetId !== value.sheetId || before.kind !== `table-${value.axis}`)) throw new ContentValidationError('invalid-insert-position');
    const next = [...list]; next.splice(before?.position ?? list.length, 0, value.id);
    reorderSheet(sheet, value.axis, list, next);
    if (value.axis === 'row') ids.rows = next; else ids.columns = next;
    const position = String(next.indexOf(value.id));
    for (const [oppositeId, cell] of Object.entries(value.cells)) {
      const other = (value.axis === 'row' ? ids.columns : ids.rows).indexOf(oppositeId);
      if (other < 0) throw new ContentValidationError('missing-opposite-cell-axis');
      const row = value.axis === 'row' ? position : String(other), column = value.axis === 'row' ? String(other) : position;
      const checked = validateTableCell(cell);
      sheet.cellData[row] ??= {}; sheet.cellData[row]![column] = checked;
    }
    if (value.data) { if (value.axis === 'row') { sheet.rowData ??= {}; sheet.rowData[position] = value.data; } else { sheet.columnData ??= {}; sheet.columnData[position] = value.data; } }
    return { targetId: operation.targetId, op: 'remove', beforeHash: null };
  }
  if (!locator || !['table-row', 'table-column'].includes(locator.kind)) throw new ContentValidationError('unsupported-table-structural-operation');
  const sheet = content.workbook.sheets[locator.sheetId!]!, ids = content.stableIds[locator.sheetId!]!, axis = locator.kind === 'table-row' ? 'row' : 'column';
  const list = axis === 'row' ? ids.rows : ids.columns, next = [...list];
  const inverse: ArtifactOperation = operation.op === 'remove' ? { targetId: operation.targetId, op: 'insert', value: tableInsertValue(state, locator), beforeHash: null } : { targetId: operation.targetId, op: 'move', value: siblingPlacement(state, locator), beforeHash: null };
  next.splice(locator.position!, 1);
  if (operation.op === 'move') {
    const value = parseJsonValue(PlacementSchema, operation.value!);
    if (value.parentId !== tableSheetTargetId(locator.sheetId!)) throw new ContentValidationError('cannot-move-axis-to-another-sheet');
    const before = value.beforeId === null ? undefined : locateTarget(state.index, value.beforeId);
    if (value.beforeId !== null && (!before || before.kind !== locator.kind || before.sheetId !== locator.sheetId || value.beforeId === operation.targetId)) throw new ContentValidationError('invalid-insert-position');
    const beforeRawId = before && (axis === 'row' ? before.rowId : before.columnId);
    next.splice(beforeRawId ? next.indexOf(beforeRawId) : next.length, 0, list[locator.position!]!);
  } else if (operation.op !== 'remove') throw new ContentValidationError('unsupported-table-structural-operation');
  reorderSheet(sheet, axis, list, next);
  if (axis === 'row') ids.rows = next; else ids.columns = next;
  return inverse;
}

function mutateStructure(state: ArtifactState, operation: ArtifactOperation, locator: TargetLocator | undefined): ArtifactOperation {
  if (state.content.kind === 'table') return mutateTableStructure(state, operation, locator);
  if (operation.op === 'insert') {
    const value = parseJsonValue(InsertSchema, operation.value!);
    if (insertedNodeId(state.content, value.node) !== operation.targetId) throw new ContentValidationError('invalid-insert-identity');
    const container = insertionContainer(state, value.parentId);
    container.array.splice(insertPosition(state, value.parentId, value.beforeId, container.array), 0, value.node);
    return { targetId: operation.targetId, op: 'remove', beforeHash: null };
  }
  if (!locator || (locator.kind === 'document-node' && locator.path.length === 1)) throw new ContentValidationError('cannot-remove-document-root');
  const value = readPath(state.content, locator.path), placement = siblingPlacement(state, locator);
  const inverse: ArtifactOperation = operation.op === 'remove' ? { targetId: operation.targetId, op: 'insert', value: { ...placement, node: asJson(value) }, beforeHash: null } : { targetId: operation.targetId, op: 'move', value: placement, beforeHash: null };
  if (operation.op === 'remove') safeSet(state.content, locator.path, undefined);
  else if (operation.op === 'move') {
    const destination = parseJsonValue(PlacementSchema, operation.value!);
    const parent = destination.parentId ? locateTarget(state.index, destination.parentId) : undefined;
    if (parent && locator.path.every((key, i) => parent.path[i] === key)) throw new ContentValidationError('cannot-move-into-descendant');
    if (destination.beforeId === operation.targetId) throw new ContentValidationError('cannot-move-before-self');
    safeSet(state.content, locator.path, undefined);
    state.index = buildTargetIndex(state.content);
    const container = insertionContainer(state, destination.parentId, locator.kind);
    container.array.splice(insertPosition(state, destination.parentId, destination.beforeId, container.array), 0, value);
  } else throw new ContentValidationError('unsupported-structural-operation');
  return inverse;
}

function adjustTableSettings(content: Extract<ArtifactContent, { kind: 'table' }>, changedSheetId: string, changes: { targetId: string; before: TableCell; after: TableCell }[]) {
  const sheet = content.workbook.sheets[changedSheetId]!;
  if (sheet.freeze) sheet.freeze = {
    xSplit: Math.min(sheet.freeze.xSplit, sheet.columnCount), ySplit: Math.min(sheet.freeze.ySplit, sheet.rowCount),
    startRow: Math.min(sheet.freeze.startRow, sheet.rowCount - 1), startColumn: Math.min(sheet.freeze.startColumn, sheet.columnCount - 1),
  };
  const rewritten = new Map(changes.map((change) => [change.targetId, change]));
  const formula = (targetId: string, expected: string) => {
    const change = rewritten.get(targetId);
    return change?.before.f === expected ? change.after.f! : expected;
  };
  for (const item of Object.values(content.workbook.sheets)) {
    const calculation = item.calculation;
    if (!calculation) continue;
    for (const line of calculation.lines) line.expectedFormula = formula(line.amountCellId, line.expectedFormula);
    calculation.subtotalFormula = formula(calculation.subtotalCellId, calculation.subtotalFormula);
    calculation.totalFormula = formula(calculation.totalCellId, calculation.totalFormula);
    if (calculation.discount) calculation.discount.expectedFormula = formula(calculation.discount.amountCellId, calculation.discount.expectedFormula);
    if (calculation.tax) calculation.tax.expectedFormula = formula(calculation.tax.amountCellId, calculation.tax.expectedFormula);
  }
}

export class ArtifactDraft {
  constructor(readonly graph: MerkleJson, public root: string) {}

  async state(): Promise<ArtifactState> { return await this.graph.materialize(this.root) as unknown as ArtifactState; }
  async metadata(targetId: string, targetProperty?: BindingTargetProperty): Promise<MetadataRestore> {
    return {
      binding: (await this.graph.get(this.root, ['bindings', fieldBindingStateKey(targetId, targetProperty ?? 'value')]) ?? null) as FieldBinding | null,
      lock: (await this.graph.get(this.root, ['locks', targetId]) ?? null) as TargetLock | null,
      targetElementId: targetId,
      ...(targetProperty ? { targetProperty } : {}),
    };
  }
  async locator(targetId: string): Promise<TargetLocator | undefined> {
    const direct = await this.graph.get(this.root, ['index', 'targets', targetId]);
    if (direct) return direct as unknown as TargetLocator;
    const cell = parseCellTargetId(targetId);
    if (!cell) return undefined;
    const sheetId = await this.graph.get(this.root, ['index', 'tables', cell.sheetToken, 'sheetId']);
    const row = await this.graph.get(this.root, ['index', 'tables', cell.sheetToken, 'rows', cell.rowToken]) as { id: string; index: number } | undefined;
    const column = await this.graph.get(this.root, ['index', 'tables', cell.sheetToken, 'columns', cell.columnToken]) as { id: string; index: number } | undefined;
    if (typeof sheetId !== 'string' || !row || !column) return undefined;
    return { kind: 'table-cell', path: ['workbook', 'sheets', sheetId, 'cellData', String(row.index), String(column.index)], sheetId, rowId: row.id, columnId: column.id };
  }
  async target(targetId: string, targetProperty?: BindingTargetProperty): Promise<ArtifactTarget | null> {
    const locator = await this.locator(targetId);
    if (!locator) return null;
    const metadata = await this.metadata(targetId, targetProperty);
    let value: JsonValue;
    if (locator.kind === 'table-row' || locator.kind === 'table-column') value = targetValue((await this.state()).content, locator);
    else value = await this.graph.get(this.root, ['content', ...locator.path]) ?? null;
    return describeTarget(targetId, locator, value, metadata.binding, metadata.lock ?? metadata.binding?.lock ?? null, targetProperty);
  }

  private async targetBindings(targetId: string): Promise<FieldBinding[]> {
    const bindings = (await this.graph.get(this.root, ['bindings']) ?? {}) as unknown as Record<string, FieldBinding>;
    return Object.values(bindings).filter((binding) => binding.targetElementId === targetId);
  }

  private async protectedTarget(operation: ArtifactOperation, locator: TargetLocator | undefined): Promise<string | null> {
    const ids = new Set([operation.targetId]);
    const addAncestors = async (id: string | undefined) => { while (id && !ids.has(id)) { ids.add(id); id = (await this.locator(id))?.parentId; } };
    if (locator?.sheetId) {
      ids.add(tableSheetTargetId(locator.sheetId));
      if (locator.rowId) ids.add(tableRowTargetId(locator.sheetId, locator.rowId));
      if (locator.columnId) ids.add(tableColumnTargetId(locator.sheetId, locator.columnId));
    }
    await addAncestors(locator?.parentId);
    if (operation.op === 'insert' || operation.op === 'move') {
      const value = operation.value as Record<string, JsonValue>;
      if (typeof value.parentId === 'string') await addAncestors(value.parentId);
      if (typeof value.sheetId === 'string') ids.add(tableSheetTargetId(value.sheetId));
    }
    for (const id of ids) {
      const metadata = await this.metadata(id, operation.targetProperty);
      const bindings = operation.targetProperty && id === operation.targetId ? [metadata.binding].filter(Boolean) as FieldBinding[] : await this.targetBindings(id);
      if (metadata.lock || bindings.some((binding) => binding.lock || binding.override)) return id;
    }
    // Adding protection to a parent does not mutate its protected descendants.
    // Direct and ancestor protection is still checked above for lock commands.
    if (operation.op !== 'lock' && locator && !['table-cell', 'plan-entry'].includes(locator.kind)) {
      const bindings = (await this.graph.get(this.root, ['bindings']) ?? {}) as unknown as Record<string, FieldBinding>;
      const locks = (await this.graph.get(this.root, ['locks']) ?? {}) as unknown as Record<string, TargetLock>;
      for (const id of new Set([...Object.keys(locks), ...Object.values(bindings).filter((binding) => binding.lock || binding.override).map((binding) => binding.targetElementId)])) {
        const child = await this.locator(id);
        if (child && locator.path.every((key, index) => child.path[index] === key)) return id;
        if (child?.sheetId && child.sheetId === locator.sheetId && ((locator.kind === 'table-row' && child.rowId === locator.rowId) || (locator.kind === 'table-column' && child.columnId === locator.columnId))) return id;
      }
    }
    return null;
  }

  private async setMetadata(targetId: string, metadata: MetadataRestore, targetProperty: BindingTargetProperty = metadata.targetProperty ?? fieldBindingProperty(metadata.binding ?? {})): Promise<void> {
    this.root = await this.graph.set(this.root, ['bindings', fieldBindingStateKey(targetId, targetProperty)], metadata.binding ? asJson(metadata.binding) : undefined);
    this.root = await this.graph.set(this.root, ['locks', targetId], metadata.lock ? asJson(metadata.lock) : undefined);
  }
  private async adjustMetrics(previous: JsonValue | undefined, next: JsonValue | undefined, path: JsonPath, kind?: 'document-node' | 'design-layer'): Promise<void> {
    const metrics = await this.graph.get(this.root, ['contentMetrics']) as unknown as ArtifactState['contentMetrics'];
    const before = previous === undefined ? { bytes: 0, values: 0, depth: 0 } : measureJson(previous);
    const after = next === undefined ? { bytes: 0, values: 0, depth: 0 } : measureJson(next);
    if (path.length + after.depth > CONTENT_LIMITS.depth) throw new ContentValidationError('content-too-complex');
    metrics.bytes += after.bytes - before.bytes;
    metrics.values += after.values - before.values;
    if (previous === undefined && next !== undefined) metrics.bytes += jsonBytes(String(path.at(-1))) + 2;
    if (previous !== undefined && next === undefined) metrics.bytes -= jsonBytes(String(path.at(-1))) + 2;
    if (kind === 'document-node') metrics.documentNodes += countTreeNodes(next as unknown as DocumentNode) - countTreeNodes(previous as unknown as DocumentNode);
    if (kind === 'design-layer') metrics.designLayers += countTreeNodes(next as unknown as DesignLayer) - countTreeNodes(previous as unknown as DesignLayer);
    if (metrics.bytes > CONTENT_LIMITS.bytes) throw new ContentValidationError('content-too-large');
    if (metrics.values > CONTENT_LIMITS.values || metrics.documentNodes > CONTENT_LIMITS.documentNodes || metrics.designLayers > CONTENT_LIMITS.designLayers) throw new ContentValidationError('content-too-complex');
    this.root = await this.graph.set(this.root, ['contentMetrics'], asJson(metrics));
  }

  private async setValue(operation: ArtifactOperation, locator: TargetLocator, before: ArtifactTarget, context: OperationContext): Promise<ArtifactOperation> {
    const previous = before.value;
    let value = operation.value;
    const previousProperty = operation.targetProperty ? targetPropertyValue(locator.kind, previous, operation.targetProperty) : undefined;
    if (operation.targetProperty) value = replaceTargetPropertyValue(locator.kind, previous, operation.targetProperty, value ?? null);
    if (locator.kind === 'table-cell') {
      const rowPath = ['content', ...locator.path.slice(0, -1)];
      const oldRow = await this.graph.get(this.root, rowPath);
      if (operation.op === 'remove') value = undefined;
      else if (operation.op === 'style') value = { ...(previous ?? {} as JsonValue) as Record<string, JsonValue>, s: value! };
      if (value !== undefined) {
        const checked = validateTableCell(value);
        if (typeof checked.s === 'string' && await this.graph.get(this.root, ['content', 'workbook', 'styles', checked.s]) === undefined) throw new ContentValidationError('missing-cell-style');
        value = asJson(checked);
      }
      this.root = await this.graph.set(this.root, ['content', ...locator.path], value);
      await this.adjustMetrics(oldRow, await this.graph.get(this.root, rowPath), rowPath.slice(1));
    } else if (locator.kind === 'table-sheet') {
      if (operation.op !== 'set') throw new ContentValidationError('unsupported-target-style');
      const settings = parseJsonValue(TableSheetSettingsSchema, value!);
      const state = await this.state();
      if (state.content.kind !== 'table' || !locator.sheetId) throw new ContentValidationError('missing-sheet');
      const sheet = state.content.workbook.sheets[locator.sheetId]!;
      const restore: Record<string, JsonValue> = { kind: 'sheet-settings' };
      if (settings.name !== undefined) { restore.name = sheet.name; sheet.name = settings.name; }
      for (const key of ['freeze', 'charts', 'calculation', 'mergeData', 'rowData', 'columnData'] as const) {
        if (settings[key] === undefined) continue;
        restore[key] = asJson(sheet[key] ?? null);
        // The strict settings schema excludes cells, dimensions and stable IDs.
        if (settings[key] === null) delete sheet[key];
        else Object.assign(sheet, { [key]: settings[key] });
      }
      this.replaceState(state, context);
      return { targetId: operation.targetId, op: 'set', value: restore, beforeHash: null };
    } else if (locator.kind === 'document-node' || locator.kind === 'design-layer') {
      if (operation.op === 'style') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContentValidationError('invalid-style');
        if (locator.kind === 'design-layer') value = { ...previous as Record<string, JsonValue>, style: { ...((previous as Record<string, JsonValue>).style as Record<string, JsonValue>), ...value } };
        else {
          const change = parseJsonValue(z.strictObject({ attrs: z.record(z.string(), z.json()).optional(), marks: z.array(z.json()).optional() }), value);
          value = { ...previous as Record<string, JsonValue>, ...(change.attrs ? { attrs: { ...(previous as Record<string, JsonValue>).attrs as Record<string, JsonValue>, ...change.attrs } } : {}), ...(change.marks ? { marks: change.marks } : {}) };
        }
      }
      const checked = locator.kind === 'document-node' ? validateDocumentNode(value) : validateDesignLayer(value);
      const old = previous as unknown as DocumentNode | DesignLayer;
      const id = locator.kind === 'document-node' ? (checked as DocumentNode).attrs?.id : (checked as DesignLayer).id;
      if (id !== operation.targetId) throw new ContentValidationError('cannot-change-stable-id');
      const changedType = checked.type !== old.type;
      const a: ArtifactContent = locator.kind === 'document-node' ? { kind: 'document', schemaVersion: 1, document: old as DocumentNode } : { kind: 'design', schemaVersion: 1, pages: [{ id: 'temporary-page', width: 1, height: 1, unit: 'px', background: '#fff', layers: [old as DesignLayer] }] };
      const b: ArtifactContent = locator.kind === 'document-node' ? { kind: 'document', schemaVersion: 1, document: checked as DocumentNode } : { kind: 'design', schemaVersion: 1, pages: [{ id: 'temporary-page', width: 1, height: 1, unit: 'px', background: '#fff', layers: [checked as DesignLayer] }] };
      if (changedType || !sameLocatorIds(a, b) || (locator.kind === 'document-node' && documentGeometry(old as DocumentNode) !== documentGeometry(checked as DocumentNode))) {
        const state = await this.state(); safeSet(state.content, locator.path, checked); this.replaceState(state, context);
      } else {
        await this.adjustMetrics(previous, asJson(checked), locator.path, locator.kind);
        this.root = await this.graph.set(this.root, ['content', ...locator.path], asJson(checked));
      }
    } else {
      if (operation.op !== 'set') throw new ContentValidationError('unsupported-target-style');
      const state = await this.state();
      if (locator.kind === 'plan-entry' && (value as Record<string, JsonValue>)?.id !== operation.targetId) throw new ContentValidationError('cannot-change-stable-id');
      if (locator.kind === 'design-page' && (value as Record<string, JsonValue>)?.id !== operation.targetId) throw new ContentValidationError('cannot-change-stable-id');
      if (locator.kind === 'table-row' || locator.kind === 'table-column') throw new ContentValidationError('use-cell-or-structural-command');
      safeSet(state.content, locator.path, value); this.replaceState(state, context);
    }
    if (operation.targetProperty) return { targetId: operation.targetId, targetProperty: operation.targetProperty, op: 'set', value: previousProperty ?? null, beforeHash: null };
    return { targetId: operation.targetId, op: previous === null && locator.kind === 'table-cell' ? 'remove' : 'set', ...(previous === null && locator.kind === 'table-cell' ? {} : { value: previous }), beforeHash: null };
  }

  private replaceState(state: ArtifactState, context: OperationContext): void {
    const previous = state.index;
    state.content = validateArtifactContent(state.content);
    state.contentMetrics = measureArtifactContent(state.content);
    state.index = buildTargetIndex(state.content);
    for (const id of Object.keys(previous.targets)) if (!Object.hasOwn(state.index.targets, id)) state.retiredTargets[id] = true;
    for (const id of Object.keys(state.index.targets)) {
      if (!Object.hasOwn(previous.targets, id) && state.retiredTargets[id] && context.origin !== 'history') throw new ContentValidationError('cannot-reuse-retired-id');
      if (context.origin === 'history') delete state.retiredTargets[id];
    }
    this.root = this.graph.encode(asJson(state));
  }

  async apply(input: readonly ArtifactOperation[], context: OperationContext, restores?: readonly ReversibleOperation[]): Promise<AppliedOperations> {
    assertBoundedJson(input, { bytes: 20 * 1024 * 1024, depth: 70 });
    const operations = z.array(CommandOperationSchema).min(1).max(1000).parse(input);
    const initialRoot = this.root;
    const inverse: ReversibleOperation[] = [], beforeHashes: Record<string, string | null> = {}, afterHashes: Record<string, string | null> = {};
    try {
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i]!, before = await this.target(operation.targetId, operation.targetProperty), locator = await this.locator(operation.targetId);
        const hash = before?.hash ?? null;
        if (operation.beforeHash !== hash) throw new TargetConflictError(operation.targetId, 'before-hash', operation.beforeHash, hash);
        if (operation.op === 'insert' ? before !== null : before === null) throw new TargetConflictError(operation.targetId, 'target-missing', operation.beforeHash, hash);
        if (context.origin === 'ai' || context.origin === 'import') {
          const blocked = await this.protectedTarget(operation, locator);
          if (blocked) throw new TargetConflictError(blocked, 'locked', null, (await this.target(blocked))?.hash ?? null);
          // A reviewed import may retain protection on a new, unprotected target.
          // It cannot remove or rewrite existing protection, or give AI lock authority.
          if (operation.op === 'lock' && (context.origin === 'ai' || !parseJsonValue(LockSchema, operation.value!).locked)) throw new ContentValidationError('only-human-may-change-lock');
        }
        const operationKey = operationTargetKey(operation);
        if (!Object.hasOwn(beforeHashes, operationKey)) beforeHashes[operationKey] = hash;
        const metadata = await this.metadata(operation.targetId, operation.targetProperty);
        const metadataKey = fieldBindingStateKey(operation.targetId, operation.targetProperty ?? 'value');
        const savedMetadata: Record<string, MetadataRestore> = { [metadataKey]: metadata };
        for (const [id, saved] of Object.entries(restores?.[i]?.metadata ?? {})) savedMetadata[id] = await this.metadata(saved.targetElementId ?? id, saved.targetProperty ?? saved.binding?.targetProperty);
        for (const [id, expected] of Object.entries(restores?.[i]?.metadataExpectedHashes ?? {})) {
          const saved = restores?.[i]?.metadata[id];
          const current = (await this.target(saved?.targetElementId ?? id, saved?.targetProperty))?.hash ?? null;
          if (current !== expected) throw new TargetConflictError(id, 'before-hash', expected, current);
        }
        const formulaRestores = restores?.[i]?.tableFormulas ?? [];
        const settingRestores = restores?.[i]?.tableSettings ?? [];
        for (const restore of formulaRestores) {
          const current = (await this.target(restore.targetId))?.hash ?? null;
          if (current !== restore.expectedHash) throw new TargetConflictError(restore.targetId, 'before-hash', restore.expectedHash, current);
        }
        for (const restore of settingRestores) {
          const current = hashJson(await this.graph.get(this.root, ['content', 'workbook', 'sheets', restore.sheetId, restore.key]) ?? null);
          if (current !== restore.expectedHash) throw new TargetConflictError(tableSheetTargetId(restore.sheetId), 'before-hash', restore.expectedHash, current);
        }
        const savedFormulas = new Map<string, TableCell>();
        const savedFormulaHashes = new Map<string, string | null>();
        const savedSettings: { sheetId: string; key: 'freeze' | 'calculation'; value: JsonValue | null }[] = [];
        const boundBefore = new Map<string, { hash: string | null; binding: FieldBinding }>();
        if (context.origin === 'human' && ['set', 'style', 'remove'].includes(operation.op)) {
          const bindings = (await this.graph.get(this.root, ['bindings']) ?? {}) as unknown as Record<string, FieldBinding>;
          for (const binding of Object.values(bindings)) {
            const id = binding.targetElementId, property = binding.targetProperty, child = await this.locator(id);
            if (id === operation.targetId || (locator && child && locator.path.every((key, index) => child.path[index] === key)) || (locator?.sheetId && child?.sheetId === locator.sheetId && locator.kind === 'table-column' && child.columnId === locator.columnId)) {
              const target = await this.target(id, property), key = fieldBindingIdentity(binding);
              boundBefore.set(key, { hash: target ? hashJson(target.value) : null, binding }); savedMetadata[key] = await this.metadata(id, property);
            }
          }
        }
        const isTableStructure = operation.op === 'insert' || operation.op === 'move' || (operation.op === 'remove' && locator?.kind !== 'table-cell');
        const sheetId = locator?.sheetId ?? (operation.value && typeof operation.value === 'object' && !Array.isArray(operation.value) && typeof operation.value.sheetId === 'string' ? operation.value.sheetId : undefined);
        const oldMerges = isTableStructure && sheetId ? await this.graph.get(this.root, ['content', 'workbook', 'sheets', sheetId, 'mergeData']) ?? null : undefined;
        const restoreMerges = restores?.[i]?.sheetMerges;
        if (restoreMerges) {
          const current = await this.graph.get(this.root, ['content', 'workbook', 'sheets', restoreMerges.sheetId, 'mergeData']) ?? null;
          if (hashJson(current) !== restoreMerges.expectedHash) throw new TargetConflictError(operation.targetId, 'before-hash', restoreMerges.expectedHash, hashJson(current));
        }
        let reverse: ArtifactOperation;
        if (operation.op === 'bind' || operation.op === 'unbind') {
          if (operation.op === 'bind') {
            const value = parseJsonValue(BindSchema, operation.value!);
            const property = operation.targetProperty ?? value.targetProperty ?? 'value';
            if (operation.targetProperty && value.targetProperty && operation.targetProperty !== value.targetProperty) throw new ContentValidationError('binding-property-mismatch');
            const binding = FieldBindingSchema.parse({ targetElementId: operation.targetId, ...(property === 'value' ? {} : { targetProperty: property }), sourceRef: value.sourceRef, transformId: value.transformId, updateMode: value.updateMode, ...(value.overrideReason ? { override: { reason: value.overrideReason, actorId: context.actorId, at: context.at } } : {}) });
            await this.setMetadata(operation.targetId, { ...metadata, binding }, property);
          } else await this.setMetadata(operation.targetId, { ...metadata, binding: null }, operation.targetProperty ?? 'value');
          reverse = metadata.binding ? { targetId: operation.targetId, ...(fieldBindingProperty(metadata.binding) === 'value' ? {} : { targetProperty: fieldBindingProperty(metadata.binding) }), op: 'bind', value: { sourceRef: asJson(metadata.binding.sourceRef), transformId: metadata.binding.transformId, updateMode: metadata.binding.updateMode, ...(fieldBindingProperty(metadata.binding) === 'value' ? {} : { targetProperty: fieldBindingProperty(metadata.binding) }) }, beforeHash: null } : { targetId: operation.targetId, ...(operation.targetProperty ? { targetProperty: operation.targetProperty } : {}), op: 'unbind', beforeHash: null };
        } else if (operation.op === 'lock') {
          const value = parseJsonValue(LockSchema, operation.value!);
          const binding = metadata.binding && { ...metadata.binding }; if (binding) delete binding.lock;
          await this.setMetadata(operation.targetId, { binding, lock: value.locked ? { reason: value.reason!, actorId: context.actorId, at: context.at } : null });
          reverse = { targetId: operation.targetId, op: 'lock', value: { locked: !!(metadata.lock ?? metadata.binding?.lock), ...((metadata.lock ?? metadata.binding?.lock) ? { reason: (metadata.lock ?? metadata.binding!.lock)!.reason } : {}) }, beforeHash: null };
        } else if (operation.op === 'insert' || operation.op === 'move' || (operation.op === 'remove' && locator?.kind !== 'table-cell')) {
          const state = await this.state();
          if (operation.op === 'insert' && state.retiredTargets[operation.targetId] && context.origin !== 'history') throw new ContentValidationError('cannot-reuse-retired-id');
          const oldTable = state.content.kind === 'table' ? structuredClone(state.content) : undefined;
          reverse = mutateStructure(state, operation, locator);
          if (oldTable && state.content.kind === 'table' && sheetId) {
            const axis = locator?.kind === 'table-row' ? 'row' : locator?.kind === 'table-column' ? 'column' : (operation.value as Record<string, JsonValue>).axis;
            if (axis !== 'row' && axis !== 'column') throw new ContentValidationError('unsupported-table-structural-operation');
            const { rewriteStructuralReferences } = await import('@/features/sheets/domain/structure');
            const changes = rewriteStructuralReferences(oldTable, state.content, sheetId, axis);
            for (const change of changes) {
              if (context.origin === 'ai' || context.origin === 'import') {
                const blocked = await this.protectedTarget({ targetId: change.targetId, op: 'set', value: asJson(change.after), beforeHash: null }, await this.locator(change.targetId));
                if (blocked) throw new TargetConflictError(blocked, 'locked', null, (await this.target(blocked))?.hash ?? null);
              }
              savedFormulas.set(change.targetId, change.before);
              savedFormulaHashes.set(change.targetId, (await this.target(change.targetId))?.hash ?? null);
            }
            adjustTableSettings(state.content, sheetId, changes);
            const newIndex = buildTargetIndex(state.content);
            for (const restore of formulaRestores) {
              const oldLocator = locateTarget(state.index, restore.targetId), nextLocator = locateTarget(newIndex, restore.targetId);
              if (!oldLocator || !nextLocator) throw new ContentValidationError('missing-formula-restore-target');
              savedFormulas.set(restore.targetId, structuredClone(readPath(oldTable, oldLocator.path) as TableCell));
              savedFormulaHashes.set(restore.targetId, (await this.target(restore.targetId))?.hash ?? null);
              safeSet(state.content, nextLocator.path, restore.value);
            }
            for (const restore of settingRestores) {
              const targetSheet = state.content.workbook.sheets[restore.sheetId];
              if (!targetSheet) throw new ContentValidationError('missing-sheet');
              if (restore.value === null) delete targetSheet[restore.key]; else Object.assign(targetSheet, { [restore.key]: restore.value });
            }
            for (const [id, previous] of Object.entries(oldTable.workbook.sheets)) {
              const next = state.content.workbook.sheets[id]!;
              for (const key of ['freeze', 'calculation'] as const) if (hashJson(asJson(previous[key] ?? null)) !== hashJson(asJson(next[key] ?? null))) savedSettings.push({ sheetId: id, key, value: asJson(previous[key] ?? null) });
            }
          }
          this.replaceState(state, context);
        } else {
          const fullBefore = operation.targetProperty ? await this.target(operation.targetId) : before;
          reverse = await this.setValue(operation, locator!, fullBefore!, context);
        }
        for (const previous of boundBefore.values()) {
          const property = previous.binding.targetProperty, id = previous.binding.targetElementId;
          const target = await this.target(id, property), value = target ? hashJson(target.value) : null;
          if (value !== previous.hash) {
            const saved = await this.metadata(id, property);
            if (saved.binding) await this.setMetadata(id, { ...saved, binding: { ...saved.binding, override: { reason: context.reason, actorId: context.actorId, at: context.at } } }, property ?? 'value');
          }
        }
        if (restores?.[i]) for (const [id, saved] of Object.entries(restores[i]!.metadata)) await this.setMetadata(saved.targetElementId ?? id, saved, saved.targetProperty ?? saved.binding?.targetProperty);
        if (restoreMerges) this.root = await this.graph.set(this.root, ['content', 'workbook', 'sheets', restoreMerges.sheetId, 'mergeData'], restoreMerges.value ?? undefined);
        const after = await this.target(operation.targetId, operation.targetProperty);
        reverse.beforeHash = after?.hash ?? null;
        const sheetMerges = oldMerges !== undefined && sheetId ? { sheetId, value: oldMerges, expectedHash: hashJson(await this.graph.get(this.root, ['content', 'workbook', 'sheets', sheetId, 'mergeData']) ?? null) } : undefined;
        const metadataExpectedHashes: Record<string, string | null> = {};
        for (const [id, saved] of Object.entries(savedMetadata)) metadataExpectedHashes[id] = (await this.target(saved.targetElementId ?? id, saved.targetProperty))?.hash ?? null;
        const tableFormulas: NonNullable<ReversibleOperation['tableFormulas']> = [];
        for (const [targetId, value] of savedFormulas) {
          tableFormulas.push({ targetId, value, expectedHash: (await this.target(targetId))?.hash ?? null });
          if (!Object.hasOwn(beforeHashes, targetId)) beforeHashes[targetId] = savedFormulaHashes.get(targetId) ?? null;
          afterHashes[targetId] = (await this.target(targetId))?.hash ?? null;
        }
        const tableSettings: NonNullable<ReversibleOperation['tableSettings']> = [];
        for (const saved of savedSettings) tableSettings.push({ ...saved, expectedHash: hashJson(await this.graph.get(this.root, ['content', 'workbook', 'sheets', saved.sheetId, saved.key]) ?? null) });
        inverse.unshift({ operation: reverse, metadata: savedMetadata, metadataExpectedHashes, ...(sheetMerges ? { sheetMerges } : {}), ...(tableFormulas.length ? { tableFormulas } : {}), ...(tableSettings.length ? { tableSettings } : {}) });
        afterHashes[operationKey] = after?.hash ?? null;
      }
      const bindings = (await this.graph.get(this.root, ['bindings']) ?? {}) as unknown as Record<string, FieldBinding>;
      const sourceRefs = (await this.graph.get(this.root, ['sourceRefs']) ?? []) as unknown as ArtifactState['sourceRefs'];
      if (Object.keys(bindings).length > 10000 || collectSourceRefs({ bindings, sourceRefs }).length > 1000 || Object.keys((await this.graph.get(this.root, ['locks']) ?? {}) as object).length > 10000) throw new ContentValidationError('too-many-references');
      return { root: this.root, inverse, beforeHashes, afterHashes };
    } catch (error) { this.root = initialRoot; throw error; }
  }
}

export function inverseInputs(inverse: readonly ReversibleOperation[]): ArtifactOperation[] { return inverse.map((item) => item.operation); }
