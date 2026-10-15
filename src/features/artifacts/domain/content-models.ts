import { z } from 'zod';
import { CalendarDateSchema, DecimalStringSchema, ElementIdSchema, IdSchema, InstantSchema } from '../../../contracts/primitives';
import { CalculationSpecSchema } from '../../../contracts/calculations';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface DocumentNode {
  type: 'doc' | 'paragraph' | 'heading' | 'text' | 'bulletList' | 'orderedList' | 'listItem' | 'blockquote' | 'table' | 'tableRow' | 'tableCell' | 'tableHeader' | 'image' | 'hardBreak' | 'pageBreak' | 'dataField';
  attrs?: Record<string, JsonValue>;
  text?: string;
  marks?: { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link' | 'textStyle'; attrs?: Record<string, JsonValue> }[];
  content?: DocumentNode[];
}
export const DocumentNodeSchema: z.ZodType<DocumentNode> = z.lazy(() => z.strictObject({
  type: z.enum(['doc', 'paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'hardBreak', 'pageBreak', 'dataField']),
  attrs: z.record(z.string().max(80), z.json()).optional(),
  text: z.string().max(100000).optional(),
  marks: z.array(z.strictObject({ type: z.enum(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle']), attrs: z.record(z.string().max(80), z.json()).optional() })).max(20).optional(),
  content: z.array(DocumentNodeSchema).max(20000).optional(),
}));

export const TableCellSchema = z.strictObject({
  v: z.union([z.string().max(100000), z.number().finite(), z.boolean(), z.null()]).optional(),
  t: z.number().int().min(1).max(4).optional(),
  f: z.string().max(8000).optional(),
  s: z.union([z.string().max(128), z.record(z.string().max(80), z.json())]).optional(),
  p: z.record(z.string().max(80), z.json()).optional(),
});
export const TableFreezeSchema = z.strictObject({
  xSplit: z.number().int().min(0).max(100), ySplit: z.number().int().min(0).max(20000),
  startRow: z.number().int().min(-1).max(19999), startColumn: z.number().int().min(-1).max(99),
});
export const TableChartSchema = z.strictObject({
  id: ElementIdSchema, title: z.string().trim().min(1).max(240), type: z.enum(['bar', 'line']),
  labelColumnId: ElementIdSchema, valueColumnIds: z.array(ElementIdSchema).min(1).max(8), rowIds: z.array(ElementIdSchema).min(1).max(500),
});
export const TableSheetSchema = z.strictObject({
  id: ElementIdSchema, name: z.string().min(1).max(240), rowCount: z.number().int().min(1).max(20000), columnCount: z.number().int().min(1).max(100),
  cellData: z.record(z.string().regex(/^(0|[1-9]\d*)$/), z.record(z.string().regex(/^(0|[1-9]\d*)$/), TableCellSchema)),
  rowData: z.record(z.string().regex(/^(0|[1-9]\d*)$/), z.record(z.string().max(80), z.json())).optional(),
  columnData: z.record(z.string().regex(/^(0|[1-9]\d*)$/), z.record(z.string().max(80), z.json())).optional(),
  mergeData: z.array(z.strictObject({ startRow: z.number().int().nonnegative(), endRow: z.number().int().nonnegative(), startColumn: z.number().int().nonnegative(), endColumn: z.number().int().nonnegative() })).max(10000).optional(),
  freeze: TableFreezeSchema.optional(), charts: z.array(TableChartSchema).max(20).optional(), calculation: CalculationSpecSchema.optional(),
});
/** A bounded metadata update; cells and stable axes remain separate checked operations. */
export const TableSheetSettingsSchema = z.strictObject({
  kind: z.literal('sheet-settings'), name: z.string().min(1).max(240).optional(),
  freeze: TableFreezeSchema.nullable().optional(), charts: z.array(TableChartSchema).max(20).nullable().optional(),
  calculation: CalculationSpecSchema.nullable().optional(),
  mergeData: TableSheetSchema.shape.mergeData.unwrap().nullable().optional(),
  rowData: TableSheetSchema.shape.rowData.unwrap().nullable().optional(),
  columnData: TableSheetSchema.shape.columnData.unwrap().nullable().optional(),
}).refine((value) => Object.keys(value).length > 1);
export const TableWorkbookSchema = z.strictObject({
  id: ElementIdSchema, name: z.string().min(1).max(240), appVersion: z.string().max(40), locale: z.string().max(20),
  sheetOrder: z.array(ElementIdSchema).min(1).max(100), sheets: z.record(ElementIdSchema, TableSheetSchema),
  styles: z.record(ElementIdSchema, z.record(z.string().max(80), z.json())).optional(),
});

export interface DesignLayer {
  id: string; type: 'text' | 'image' | 'shape' | 'group';
  name?: string;
  transform: { x: number; y: number; width: number; height: number; rotation: number };
  style: Record<string, JsonValue>;
  text?: string; assetId?: string; fontAssetId?: string; crop?: { x: number; y: number; width: number; height: number }; shape?: 'rect' | 'ellipse' | 'line'; hidden?: boolean; layers?: DesignLayer[];
}
export const DesignLayerSchema: z.ZodType<DesignLayer> = z.lazy(() => z.strictObject({
  id: ElementIdSchema, type: z.enum(['text', 'image', 'shape', 'group']),
  name: z.string().trim().min(1).max(240).optional(),
  transform: z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), rotation: z.number().finite() }),
  style: z.record(z.string().max(80), z.json()), text: z.string().max(100000).optional(), assetId: IdSchema.optional(),
  fontAssetId: IdSchema.optional(), crop: z.strictObject({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1), width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1) }).optional(),
  shape: z.enum(['rect', 'ellipse', 'line']).optional(), hidden: z.boolean().optional(), layers: z.array(DesignLayerSchema).max(10000).optional(),
}));
export const PlanEntrySchema = z.strictObject({
  id: ElementIdSchema, title: z.string().min(1).max(1000), status: z.enum(['todo', 'in-progress', 'done', 'cancelled']),
  startDate: CalendarDateSchema.optional(), endDate: CalendarDateSchema.optional(), startAt: InstantSchema.optional(), endAt: InstantSchema.optional(),
  resourceIds: z.array(IdSchema).max(100), dependencies: z.array(ElementIdSchema).max(1000),
  effort: z.strictObject({ decimal: DecimalStringSchema, unit: z.string().min(1).max(40) }).optional(),
  durationMinutes: z.number().int().nonnegative().optional(), quantity: z.strictObject({ decimal: DecimalStringSchema, unit: z.string().min(1).max(40) }).optional(),
  checklist: z.array(z.strictObject({ id: ElementIdSchema, text: z.string().min(1).max(1000), done: z.boolean() })).max(1000),
  availabilityVersionIds: z.array(IdSchema).max(100), notes: z.string().max(12000).optional(),
});

// These are the C7 engine documents, not a second editor-independent document format.
export const ArtifactContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('document'), schemaVersion: z.literal(1), document: DocumentNodeSchema }),
  z.strictObject({ kind: z.literal('table'), schemaVersion: z.literal(1), workbook: TableWorkbookSchema,
    stableIds: z.record(ElementIdSchema, z.strictObject({ rows: z.array(ElementIdSchema).min(1).max(20000), columns: z.array(ElementIdSchema).min(1).max(100) })) }),
  z.strictObject({ kind: z.literal('design'), schemaVersion: z.literal(1), pages: z.array(z.strictObject({
    id: ElementIdSchema, width: z.number().finite().positive().max(100000), height: z.number().finite().positive().max(100000), unit: z.enum(['px', 'mm']),
    background: z.string().max(80), layers: z.array(DesignLayerSchema).max(10000),
  })).min(1).max(100) }),
  z.strictObject({ kind: z.literal('plan'), schemaVersion: z.literal(1), timezone: z.string().min(1).max(80), entries: z.array(PlanEntrySchema).max(20000) }),
]);

export type ArtifactContent = z.infer<typeof ArtifactContentSchema>;
export type TableCell = z.infer<typeof TableCellSchema>;
export type TableSheet = z.infer<typeof TableSheetSchema>;
export type PlanEntry = z.infer<typeof PlanEntrySchema>;
