import { fieldBindingIdentity, fieldBindingProperty, fieldBindingStateKey, type BindingTargetProperty, type FieldBinding, type SourceRef } from '../../../contracts/artifacts';
import type { ArtifactContent, DesignLayer, DocumentNode, JsonValue } from './content-models';
import { ContentValidationError, hashJson, stableToken } from './canonical';
import type { JsonPath } from './merkle-json';

export type TargetKind = 'document-node' | 'design-layer' | 'design-page' | 'plan-entry' | 'table-sheet' | 'table-row' | 'table-column' | 'table-cell';
export interface TargetLock { reason: string; actorId: string; at: string }
export interface TargetLocator { kind: TargetKind; path: (string | number)[]; parentId?: string; position?: number; sheetId?: string; rowId?: string; columnId?: string }
export interface TableTargetIndex { sheetId: string; rows: Record<string, { id: string; index: number }>; columns: Record<string, { id: string; index: number }> }
export interface ArtifactTargetIndex { targets: Record<string, TargetLocator>; tables: Record<string, TableTargetIndex> }
export interface ArtifactState {
  format: 1;
  content: ArtifactContent;
  contentMetrics: { bytes: number; values: number; documentNodes: number; designLayers: number };
  sourceRefs: SourceRef[];
  bindings: Record<string, FieldBinding>;
  locks: Record<string, TargetLock>;
  retiredTargets: Record<string, true>;
  index: ArtifactTargetIndex;
}
export interface ArtifactTarget {
  targetId: string; kind: TargetKind; value: JsonValue; hash: string;
  binding: FieldBinding | null; lock: TargetLock | null;
  targetProperty?: BindingTargetProperty;
  parentId?: string; position?: number;
}

export const tableSheetTargetId = (sheetId: string): string => `sheet_${stableToken(sheetId)}`;
export const tableRowTargetId = (sheetId: string, rowId: string): string => `row_${stableToken(sheetId)}_${stableToken(rowId)}`;
export const tableColumnTargetId = (sheetId: string, columnId: string): string => `column_${stableToken(sheetId)}_${stableToken(columnId)}`;
export const tableCellTargetId = (sheetId: string, rowId: string, columnId: string): string => `cell_${stableToken(sheetId)}_${stableToken(rowId)}_${stableToken(columnId)}`;

export function buildTargetIndex(content: ArtifactContent): ArtifactTargetIndex {
  const index: ArtifactTargetIndex = { targets: {}, tables: {} };
  const add = (id: string, locator: TargetLocator) => {
    if (['__proto__', 'constructor', 'prototype'].includes(id)) throw new ContentValidationError('unsafe-element-id');
    if (Object.hasOwn(index.targets, id)) throw new ContentValidationError('duplicate-element-id');
    index.targets[id] = locator;
  };
  if (content.kind === 'document') {
    const visit = (node: DocumentNode, path: (string | number)[], parentId?: string, position?: number) => {
      const id = typeof node.attrs?.id === 'string' ? node.attrs.id : undefined;
      if (id) add(id, { kind: 'document-node', path, ...(parentId === undefined ? {} : { parentId }), ...(position === undefined ? {} : { position }) });
      node.content?.forEach((child, i) => visit(child, [...path, 'content', i], id ?? parentId, i));
    };
    visit(content.document, ['document']);
  } else if (content.kind === 'design') {
    const visit = (layer: DesignLayer, path: (string | number)[], parentId: string, position: number) => {
      add(layer.id, { kind: 'design-layer', path, parentId, position });
      layer.layers?.forEach((child, i) => visit(child, [...path, 'layers', i], layer.id, i));
    };
    content.pages.forEach((page, p) => {
      add(page.id, { kind: 'design-page', path: ['pages', p], position: p });
      page.layers.forEach((layer, l) => visit(layer, ['pages', p, 'layers', l], page.id, l));
    });
  } else if (content.kind === 'plan') {
    content.entries.forEach((entry, position) => add(entry.id, { kind: 'plan-entry', path: ['entries', position], position }));
  } else {
    for (const sheetId of content.workbook.sheetOrder) {
      const ids = content.stableIds[sheetId]!;
      const table: TableTargetIndex = { sheetId, rows: {}, columns: {} };
      const parentId = tableSheetTargetId(sheetId);
      add(parentId, { kind: 'table-sheet', path: ['workbook', 'sheets', sheetId], position: content.workbook.sheetOrder.indexOf(sheetId), sheetId });
      ids.rows.forEach((id, position) => {
        const token = stableToken(id);
        if (Object.hasOwn(table.rows, token)) throw new ContentValidationError('stable-token-collision');
        table.rows[token] = { id, index: position };
        add(tableRowTargetId(sheetId, id), { kind: 'table-row', path: ['workbook', 'sheets', sheetId, 'cellData', String(position)], parentId, position, sheetId, rowId: id });
      });
      ids.columns.forEach((id, position) => {
        const token = stableToken(id);
        if (Object.hasOwn(table.columns, token)) throw new ContentValidationError('stable-token-collision');
        table.columns[token] = { id, index: position };
        add(tableColumnTargetId(sheetId, id), { kind: 'table-column', path: ['workbook', 'sheets', sheetId, 'columnData', String(position)], parentId, position, sheetId, columnId: id });
      });
      if (Object.hasOwn(index.tables, stableToken(sheetId))) throw new ContentValidationError('stable-token-collision');
      index.tables[stableToken(sheetId)] = table;
    }
  }
  return index;
}

export function parseCellTargetId(id: string): { sheetToken: string; rowToken: string; columnToken: string } | null {
  const match = /^cell_([a-f0-9]{24})_([a-f0-9]{24})_([a-f0-9]{24})$/.exec(id);
  return match ? { sheetToken: match[1]!, rowToken: match[2]!, columnToken: match[3]! } : null;
}

export function locateTarget(index: ArtifactTargetIndex, id: string): TargetLocator | undefined {
  if (Object.hasOwn(index.targets, id)) return index.targets[id];
  const cell = parseCellTargetId(id);
  if (!cell) return undefined;
  const sheet = index.tables[cell.sheetToken], row = sheet?.rows[cell.rowToken], column = sheet?.columns[cell.columnToken];
  if (!sheet || !row || !column) return undefined;
  return { kind: 'table-cell', path: ['workbook', 'sheets', sheet.sheetId, 'cellData', String(row.index), String(column.index)], sheetId: sheet.sheetId, rowId: row.id, columnId: column.id };
}

export function readPath(value: unknown, path: JsonPath): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

export function targetValue(content: ArtifactContent, locator: TargetLocator): JsonValue {
  if (content.kind === 'table' && locator.sheetId) {
    const sheet = content.workbook.sheets[locator.sheetId]!;
    if (locator.kind === 'table-row') return { id: locator.rowId!, cells: sheet.cellData[String(locator.position)] ?? {}, data: sheet.rowData?.[String(locator.position)] ?? null } as JsonValue;
    if (locator.kind === 'table-column') {
      const cells: Record<string, JsonValue> = {};
      for (const [row, values] of Object.entries(sheet.cellData)) if (Object.hasOwn(values, String(locator.position))) cells[row] = values[String(locator.position)] as JsonValue;
      return { id: locator.columnId!, cells, data: sheet.columnData?.[String(locator.position)] ?? null };
    }
  }
  return (readPath(content, locator.path) ?? null) as JsonValue;
}

/** Resolve one semantic property through a finite kind/property allowlist. */
export function targetPropertyValue(kind: TargetKind, value: JsonValue, property: BindingTargetProperty): JsonValue {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;
  if (!object) throw new ContentValidationError('binding-property-not-supported');
  if (property === 'value') {
    if (kind === 'table-cell') return object.v ?? null;
    if (kind === 'document-node' && object.type === 'dataField') {
      const attrs = object.attrs && typeof object.attrs === 'object' && !Array.isArray(object.attrs) ? object.attrs as Record<string, JsonValue> : undefined;
      return attrs?.value ?? null;
    }
    if (kind === 'plan-entry') {
      const quantity = object.quantity && typeof object.quantity === 'object' && !Array.isArray(object.quantity) ? object.quantity as Record<string, JsonValue> : undefined;
      return quantity?.decimal ?? null;
    }
  }
  if (property === 'text') {
    if (kind === 'document-node' && object.type === 'text') return object.text ?? '';
    if (kind === 'design-layer' && object.type === 'text') return object.text ?? '';
    if (kind === 'plan-entry') return object.title ?? '';
  }
  if (property === 'fill' && kind === 'design-layer') {
    const style = object.style && typeof object.style === 'object' && !Array.isArray(object.style) ? object.style as Record<string, JsonValue> : undefined;
    return style?.fill ?? null;
  }
  throw new ContentValidationError('binding-property-not-supported');
}

/** Replace exactly one allowlisted semantic property and retain all other structure. */
export function replaceTargetPropertyValue(kind: TargetKind, value: JsonValue, property: BindingTargetProperty, next: JsonValue): JsonValue {
  // Validate that the current target/property combination is allowed first.
  targetPropertyValue(kind, value, property);
  const object = structuredClone(value) as Record<string, JsonValue>;
  if (property === 'value' && kind === 'table-cell') {
    object.v = next;
    object.t = typeof next === 'number' ? 2 : typeof next === 'boolean' ? 3 : 1;
    return object;
  }
  if (property === 'value' && kind === 'document-node') {
    object.attrs = { ...object.attrs as Record<string, JsonValue>, value: next };
    return object;
  }
  if (property === 'value' && kind === 'plan-entry') {
    object.quantity = { ...object.quantity as Record<string, JsonValue>, decimal: next };
    return object;
  }
  if (property === 'text' && (kind === 'document-node' || kind === 'design-layer')) { object.text = next; return object; }
  if (property === 'text' && kind === 'plan-entry') { object.title = next; return object; }
  if (property === 'fill' && kind === 'design-layer') {
    object.style = { ...object.style as Record<string, JsonValue>, fill: next };
    return object;
  }
  throw new ContentValidationError('binding-property-not-supported');
}

export function describeTarget(targetId: string, locator: TargetLocator, value: JsonValue, binding: FieldBinding | null, lock: TargetLock | null, targetProperty?: BindingTargetProperty): ArtifactTarget {
  const stableLocation: Record<string, JsonValue> = locator.kind === 'table-cell'
    ? { sheetId: locator.sheetId!, rowId: locator.rowId!, columnId: locator.columnId! }
    : { parentId: locator.parentId ?? null, position: locator.position ?? null };
  const projected = targetProperty ? targetPropertyValue(locator.kind, value, targetProperty) : value;
  return {
    targetId, kind: locator.kind, value: projected, binding, lock, ...(targetProperty ? { targetProperty } : {}),
    ...(locator.parentId === undefined ? {} : { parentId: locator.parentId }), ...(locator.position === undefined ? {} : { position: locator.position }),
    hash: hashJson({ targetId, targetProperty: targetProperty ?? null, kind: locator.kind, value: projected, binding: binding as unknown as JsonValue, lock: lock as unknown as JsonValue, location: stableLocation }),
  };
}

/** Reuse one resolver for one immutable editor snapshot, never between revisions. */
export function createArtifactTargetResolver(content: ArtifactContent, bindings: readonly FieldBinding[] = [], locks: Record<string, TargetLock> = {}) {
  const index = buildTargetIndex(content);
  const byTarget = new Map(bindings.map((binding) => [fieldBindingIdentity(binding), binding]));
  return (targetId: string, targetProperty?: BindingTargetProperty): ArtifactTarget | null => {
    const locator = locateTarget(index, targetId);
    if (!locator) return null;
    const binding = byTarget.get(targetProperty === undefined ? targetId : fieldBindingStateKey(targetId, targetProperty)) ?? null;
    if (binding && targetProperty !== undefined && fieldBindingProperty(binding) !== targetProperty) throw new ContentValidationError('binding-property-mismatch');
    return describeTarget(targetId, locator, targetValue(content, locator), binding, locks[targetId] ?? binding?.lock ?? null, targetProperty);
  };
}
