import { z } from 'zod';
import { SourceRefSchema } from './artifacts';
import { SourceChunkSchema, SourceManifestSchema } from './sources';
import { CalendarDateSchema, CurrencySchema, ElementIdSchema, IdSchema, InstantSchema, RevisionSchema } from './primitives';

const ExactDecimalSchema = z.string().max(80).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const AdjustmentSchema = z.enum(['return', 'correction']);
export const MaterialValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().max(16000) }),
  z.strictObject({ kind: z.literal('decimal'), decimal: ExactDecimalSchema, adjustmentReason: AdjustmentSchema.optional() }),
  z.strictObject({ kind: z.literal('money'), minorUnits: z.string().max(80).regex(/^-?(?:0|[1-9]\d*)$/), currency: CurrencySchema, adjustmentReason: AdjustmentSchema.optional() }),
  z.strictObject({ kind: z.literal('quantity'), decimal: ExactDecimalSchema, unit: z.string().trim().min(1).max(40), adjustmentReason: AdjustmentSchema.optional() }),
  z.strictObject({ kind: z.literal('date'), date: CalendarDateSchema, precision: z.literal('day') }),
  z.strictObject({ kind: z.literal('unknown'), reason: z.string().max(120).nullable() }),
]);
export const MaterialLineageSchema = z.strictObject({
  fragmentId: z.string().min(1).max(300), row: z.number().int().positive().optional(), column: z.number().int().min(0).max(99),
  sheet: z.string().max(240).optional(), page: z.number().int().positive().optional(),
});
export const MaterialCellSchema = z.strictObject({
  value: MaterialValueSchema, rawValue: z.string().max(16000), sourceRawValue: z.string().max(16000).optional(), reviewState: z.enum(['observed', 'needs-review', 'confirmed']),
  origin: z.enum(['observed', 'derived', 'assumed']), lineage: MaterialLineageSchema,
  sourceRef: SourceRefSchema, factRevision: RevisionSchema,
});
export const MaterialFieldSchema = z.strictObject({
  id: ElementIdSchema, label: z.string().trim().min(1).max(160),
  column: z.number().int().min(0).max(99), header: z.string().max(1000).nullable(),
  kind: z.enum(['text', 'decimal', 'money', 'quantity', 'date']),
  decimalSeparator: z.enum(['.', ',']).default('.'), groupSeparator: z.enum(['none', 'space', '.', ',']).default('none'),
  currency: CurrencySchema.default('KZT'), unit: z.string().trim().max(40).default(''), sourceUnit: z.string().trim().max(40).default(''),
  dateFormat: z.enum(['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']).default('YYYY-MM-DD'),
  adjustmentReason: AdjustmentSchema.optional(), emptyValues: z.array(z.string().max(120)).max(20).default(['']),
});
export const RecordKeySpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fields'), fieldIds: z.array(ElementIdSchema).min(1).max(10), trim: z.boolean(), caseSensitive: z.boolean(), confirmed: z.literal(true) }),
  z.strictObject({ kind: z.literal('fingerprint'), confirmed: z.literal(true) }),
]);
export const ImportMappingSchema = z.strictObject({
  fields: z.array(MaterialFieldSchema).min(1).max(100), sheet: z.string().max(240).nullable().default(null),
  headerRow: z.number().int().min(0).max(100000).default(1), headers: z.array(z.string().max(1000)).max(100),
  importMode: z.enum(['replace-snapshot', 'append', 'upsert']), recordKeySpec: RecordKeySpecSchema,
}).superRefine((mapping, context) => {
  if (new Set(mapping.fields.map((field) => field.id)).size !== mapping.fields.length) context.addIssue({ code: 'custom', message: 'Field identities must be unique.' });
  if (mapping.recordKeySpec.kind === 'fields' && (new Set(mapping.recordKeySpec.fieldIds).size !== mapping.recordKeySpec.fieldIds.length || mapping.recordKeySpec.fieldIds.some((id) => !mapping.fields.some((field) => field.id === id)))) context.addIssue({ code: 'custom', message: 'Record keys must use mapped fields.' });
  for (const field of mapping.fields) {
    if (field.kind === 'quantity' && !field.unit) context.addIssue({ code: 'custom', message: 'A quantity requires its unit.' });
    if (field.groupSeparator === field.decimalSeparator) context.addIssue({ code: 'custom', message: 'Decimal and group separators must differ.' });
    if (mapping.headerRow > 0 && (mapping.headers[field.column] !== field.header)) context.addIssue({ code: 'custom', message: 'Every mapped column must match its confirmed header.' });
  }
});
export const MaterialKindSchema = z.enum(['catalog', 'prices', 'history', 'brand', 'general']);
export const MaterialViewerSchema = z.strictObject({ userId: IdSchema, workspaceId: IdSchema, authzVersion: z.number().int().positive() });
export const CollectionSchema = z.strictObject({
  id: IdSchema, workspaceId: IdSchema, projectId: IdSchema, title: z.string(), kind: MaterialKindSchema,
  accessClass: z.enum(['internal', 'confidential']), revision: RevisionSchema, mapping: ImportMappingSchema.nullable(),
  recordCount: z.number().int().nonnegative(), updatedAt: InstantSchema, createdAt: InstantSchema,
});
export const CollectionListInputSchema = z.strictObject({
  workspaceId: IdSchema, projectId: IdSchema.optional(), query: z.string().trim().max(120).default(''), kind: MaterialKindSchema.optional(),
  from: CalendarDateSchema.optional(), to: CalendarDateSchema.optional(), after: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(30),
});
export const CollectionListSchema = z.strictObject({ viewer: MaterialViewerSchema, collections: z.array(CollectionSchema).max(50), nextCursor: z.string().nullable() });
export const CreateCollectionSchema = z.strictObject({ workspaceId: IdSchema, projectId: IdSchema, title: z.string().trim().min(1).max(240), kind: MaterialKindSchema.default('general'), accessClass: z.enum(['internal', 'confidential']).default('internal'), expectedAuthzVersion: z.number().int().positive() });
export const MaterialMutationSchema = z.strictObject({ workspaceId: IdSchema, expectedAuthzVersion: z.number().int().positive(), expectedRevision: RevisionSchema });
export const BeginImportSchema = MaterialMutationSchema.extend({ collectionId: IdSchema, sourceId: IdSchema, sourceVersionId: IdSchema, mapping: ImportMappingSchema });
export const ImportChangeSchema = z.enum(['added', 'changed', 'unchanged', 'missing', 'ambiguous']);
export const ImportCountsSchema = z.strictObject({ added: z.number().int().nonnegative(), changed: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), ambiguous: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(), unknownCells: z.number().int().nonnegative(), total: z.number().int().nonnegative() });
export const MaterialImportSchema = z.strictObject({
  id: IdSchema, collectionId: IdSchema, sourceRef: SourceRefSchema, mapping: ImportMappingSchema,
  status: z.enum(['preparing', 'preview', 'applied', 'cancelled', 'failed']), expectedRevision: RevisionSchema,
  nextChunk: z.number().int().nonnegative(), chunkCount: z.number().int().nonnegative(), counts: ImportCountsSchema,
  errorCode: z.string().nullable(), appliedRevision: RevisionSchema.nullable(), reviewRevision: RevisionSchema, createdAt: InstantSchema,
});
export const ImportRowSchema = z.strictObject({ ordinal: z.number().int().nonnegative(), recordId: IdSchema, key: z.string().nullable(), label: z.string(), change: ImportChangeSchema, issues: z.array(z.string()), cells: z.record(ElementIdSchema, MaterialCellSchema), before: z.record(ElementIdSchema, MaterialCellSchema).nullable(), excluded: z.boolean() });
export const ImportPreviewSchema = z.strictObject({ viewer: MaterialViewerSchema, collection: CollectionSchema, canEdit: z.boolean(), import: MaterialImportSchema, rows: z.array(ImportRowSchema).max(50), nextCursor: z.string().nullable() });
export const ApplyImportSchema = MaterialMutationSchema.extend({ expectedReviewRevision: RevisionSchema, confirmCompleteSnapshot: z.boolean().default(false), allowPartial: z.boolean().default(false) });
export const ImportResolutionSchema = MaterialMutationSchema.extend({
  expectedReviewRevision: RevisionSchema,
  changes: z.array(z.strictObject({ ordinal: z.number().int().nonnegative(), exclude: z.boolean().optional(), keyOverride: z.string().trim().min(1).max(1000).nullable().optional(), values: z.record(ElementIdSchema, z.string().max(16000)).optional() })).min(1).max(100),
});
export const DatasetFilterSchema = z.strictObject({ fieldId: ElementIdSchema, op: z.enum(['eq', 'contains', 'gt', 'gte', 'lt', 'lte', 'unknown']), value: z.string().max(1000).optional() });
export const DatasetQuerySchema = z.strictObject({
  workspaceId: IdSchema, collectionId: IdSchema, revision: RevisionSchema.optional(), fieldIds: z.array(ElementIdSchema).min(1).max(100).optional(),
  filters: z.array(DatasetFilterSchema).max(10).default([]), query: z.string().trim().max(120).default(''),
  after: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(50), includeMissing: z.boolean().default(false),
});
export type DatasetExpression =
  | { type: 'predicate'; predicate: z.infer<typeof DatasetFilterSchema> }
  | { type: 'group'; operator: 'and' | 'or'; children: DatasetExpression[] }
  | { type: 'not'; child: DatasetExpression };
export const DatasetExpressionSchema: z.ZodType<DatasetExpression> = z.lazy(() => z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('predicate'), predicate: DatasetFilterSchema }),
  z.strictObject({ type: z.literal('group'), operator: z.enum(['and', 'or']), children: z.array(DatasetExpressionSchema).min(1).max(10) }),
  z.strictObject({ type: z.literal('not'), child: DatasetExpressionSchema }),
]));
function expressionSize(expression: DatasetExpression, depth = 1): { depth: number; predicates: number } {
  if (expression.type === 'predicate') return { depth, predicates: 1 };
  if (expression.type === 'not') return expressionSize(expression.child, depth + 1);
  return expression.children.reduce((result, child) => {
    const next = expressionSize(child, depth + 1);
    return { depth: Math.max(result.depth, next.depth), predicates: result.predicates + next.predicates };
  }, { depth, predicates: 0 });
}
const DatasetBrowseQueryBaseSchema = DatasetQuerySchema.extend({ where: DatasetExpressionSchema.optional() });
function validateExpression(value: { where?: DatasetExpression }, context: z.RefinementCtx) {
  if (!value.where) return;
  const size = expressionSize(value.where);
  if (size.depth > 4 || size.predicates > 20) context.addIssue({ code: 'custom', message: 'The query expression is too complex.' });
}
export const DatasetBrowseQuerySchema = DatasetBrowseQueryBaseSchema.superRefine(validateExpression);
export const DatasetRecordSchema = z.strictObject({ recordId: IdSchema, label: z.string(), missing: z.boolean(), revision: RevisionSchema, cells: z.record(ElementIdSchema, MaterialCellSchema) });
export const DatasetPageSchema = z.strictObject({ viewer: MaterialViewerSchema, collection: CollectionSchema, revision: RevisionSchema, records: z.array(DatasetRecordSchema).max(50), nextCursor: z.string().nullable(), total: z.number().int().nonnegative() });
export const DatasetCoverageSchema = z.strictObject({
  total: z.number().int().nonnegative(), included: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(), needsReview: z.number().int().nonnegative(),
});
export const DatasetAggregateInputSchema = DatasetBrowseQueryBaseSchema.omit({ after: true, limit: true, fieldIds: true, includeMissing: true }).extend({ fieldId: ElementIdSchema, operation: z.enum(['count', 'sum', 'min', 'max', 'average']) }).superRefine(validateExpression);
export const DatasetAggregateSchema = z.strictObject({ revision: RevisionSchema, fieldId: ElementIdSchema, operation: z.enum(['count', 'sum', 'min', 'max', 'average']), value: z.string().nullable(), currency: z.string().optional(), unit: z.string().optional(), coverage: DatasetCoverageSchema, sourceRefs: z.array(SourceRefSchema).max(1000) });
export const DatasetFacetInputSchema = DatasetBrowseQueryBaseSchema.omit({ after: true, limit: true, fieldIds: true, includeMissing: true }).extend({
  fieldId: ElementIdSchema, after: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20),
}).superRefine(validateExpression);
export const DatasetFacetValueSchema = z.strictObject({ key: z.string().max(16000), value: MaterialValueSchema.nullable(), count: z.number().int().nonnegative() });
export const DatasetFacetSchema = z.strictObject({ revision: RevisionSchema, fieldId: ElementIdSchema, values: z.array(DatasetFacetValueSchema).max(50), nextCursor: z.string().nullable(), coverage: DatasetCoverageSchema });
export const DatasetMeasureSchema = z.strictObject({ id: ElementIdSchema, fieldId: ElementIdSchema, operation: z.enum(['count', 'sum', 'min', 'max', 'average']) });
export const DatasetGroupInputSchema = DatasetBrowseQueryBaseSchema.omit({ after: true, limit: true, fieldIds: true, includeMissing: true }).extend({
  dimensions: z.array(ElementIdSchema).max(3).default([]), measures: z.array(DatasetMeasureSchema).min(1).max(10),
  after: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(50),
}).superRefine((value, context) => {
  validateExpression(value, context);
  if (new Set(value.dimensions).size !== value.dimensions.length || new Set(value.measures.map((measure) => measure.id)).size !== value.measures.length) context.addIssue({ code: 'custom', message: 'Grouped query identifiers must be unique.' });
});
export const DatasetGroupRowSchema = z.strictObject({
  key: z.string().max(2048), dimensions: z.record(ElementIdSchema, MaterialValueSchema.nullable()),
  measures: z.record(ElementIdSchema, z.strictObject({ value: z.string().nullable(), coverage: DatasetCoverageSchema })),
});
export const DatasetGroupPageSchema = z.strictObject({ viewer: MaterialViewerSchema, collection: CollectionSchema, revision: RevisionSchema, rows: z.array(DatasetGroupRowSchema).max(50), nextCursor: z.string().nullable(), totalGroups: z.number().int().nonnegative(), sourceRefs: z.array(SourceRefSchema).max(1000) });
export const MaterialDecisionContextInputSchema = DatasetBrowseQueryBaseSchema.omit({ after: true, limit: true, includeMissing: true }).extend({
  sampleLimit: z.number().int().min(1).max(20).default(12), measures: z.array(DatasetMeasureSchema).min(1).max(10),
  grouping: z.strictObject({ dimensions: z.array(ElementIdSchema).max(3).default([]), limit: z.number().int().min(1).max(20).default(10) }).optional(),
}).superRefine(validateExpression);
export const MaterialDecisionAggregateSchema = DatasetAggregateSchema.omit({ sourceRefs: true }).extend({ measureId: ElementIdSchema });
export const MaterialDecisionGroupPageSchema = DatasetGroupPageSchema.omit({ sourceRefs: true });
export const MaterialDecisionContextSchema = z.strictObject({
  viewer: MaterialViewerSchema, collection: CollectionSchema, revision: RevisionSchema,
  schema: z.array(MaterialFieldSchema).max(100), matchedRecords: z.number().int().nonnegative(), truncated: z.boolean(),
  sample: z.array(DatasetRecordSchema).max(20), aggregates: z.array(MaterialDecisionAggregateSchema).max(10), grouped: MaterialDecisionGroupPageSchema.optional(),
  evidenceRefs: z.array(SourceRefSchema).max(200), evidenceTruncated: z.boolean(),
});
export const FactReadSchema = z.strictObject({ workspaceId: IdSchema, refs: z.array(SourceRefSchema).min(1).max(100) });
export const BoundFactSchema = z.strictObject({
  requestedRef: SourceRefSchema, state: z.enum(['current', 'stale', 'missing', 'unknown']),
  pinned: MaterialCellSchema.extend({ labels: z.strictObject({ collection: z.string(), record: z.string(), field: z.string() }) }).optional(),
  currentSourceRef: SourceRefSchema.optional(), canBind: z.boolean(), canCorrect: z.boolean(),
});
export const BoundFactsSchema = z.strictObject({ facts: z.array(BoundFactSchema).max(100) });
export const CorrectionPreviewSchema = MaterialMutationSchema.extend({ changes: z.array(z.strictObject({ recordId: IdSchema, fieldId: ElementIdSchema, rawValue: z.string().max(16000), reason: z.string().trim().min(1).max(1000) })).min(1).max(100) });
export const ResolutionSchema = z.strictObject({ id: IdSchema, collectionId: IdSchema, revision: RevisionSchema, kind: z.enum(['import', 'correction', 'undo']), reason: z.string(), createdAt: InstantSchema, actorId: IdSchema, undoOf: IdSchema.nullable(), canUndo: z.boolean() });
export const CollectionResultSchema = z.strictObject({ viewer: MaterialViewerSchema, collection: CollectionSchema, canEdit: z.boolean(), imports: z.array(MaterialImportSchema).max(20).optional() });
export const CorrectionResultSchema = z.strictObject({ viewer: MaterialViewerSchema, collection: CollectionSchema, previewHash: z.string().length(64), changes: z.array(z.strictObject({ recordId: IdSchema, fieldId: ElementIdSchema, recordLabel: z.string(), fieldLabel: z.string(), reason: z.string(), before: MaterialCellSchema, after: MaterialCellSchema })).min(1).max(100) });
export const ResolutionResultSchema = z.strictObject({ viewer: MaterialViewerSchema, collection: CollectionSchema, resolutionId: IdSchema });
export const ImportResultSchema = z.strictObject({ viewer: MaterialViewerSchema, import: MaterialImportSchema, collection: CollectionSchema.optional() });
export const MaterialHistorySchema = z.strictObject({ viewer: MaterialViewerSchema, resolutions: z.array(ResolutionSchema).max(50), nextBeforeRevision: RevisionSchema.nullable() });
export const MaterialSourcePreviewSchema = z.strictObject({ viewer: MaterialViewerSchema, sourceRef: SourceRefSchema, projectId: IdSchema, accessClass: z.enum(['internal', 'confidential']), title: z.string(), manifest: SourceManifestSchema, chunk: SourceChunkSchema, chunkCount: z.number().int().nonnegative() });
export type CollectionResult = z.infer<typeof CollectionResultSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export type DatasetPage = z.infer<typeof DatasetPageSchema>;
export type MaterialSourcePreview = z.infer<typeof MaterialSourcePreviewSchema>;
export type MaterialValue = z.infer<typeof MaterialValueSchema>;
export type MaterialCell = z.infer<typeof MaterialCellSchema>;
export type MaterialField = z.infer<typeof MaterialFieldSchema>;
export type ImportMapping = z.infer<typeof ImportMappingSchema>;
export type MaterialCollection = z.infer<typeof CollectionSchema>;
export type CollectionListInput = z.infer<typeof CollectionListInputSchema>;
export type MaterialImport = z.infer<typeof MaterialImportSchema>;
export type ImportCounts = z.infer<typeof ImportCountsSchema>;
export type ImportRow = z.infer<typeof ImportRowSchema>;
export type DatasetQuery = z.infer<typeof DatasetQuerySchema>;
export type DatasetBrowseQuery = z.infer<typeof DatasetBrowseQuerySchema>;
export type DatasetRecord = z.infer<typeof DatasetRecordSchema>;
export type DatasetCoverage = z.infer<typeof DatasetCoverageSchema>;
export type DatasetFacet = z.infer<typeof DatasetFacetSchema>;
export type DatasetGroupPage = z.infer<typeof DatasetGroupPageSchema>;
export type MaterialDecisionContext = z.infer<typeof MaterialDecisionContextSchema>;
export type BoundFact = z.infer<typeof BoundFactSchema>;
