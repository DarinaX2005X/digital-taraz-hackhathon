import { describe, expect, it } from 'vitest';
import { DatasetBrowseQuerySchema, ImportMappingSchema } from '../../src/contracts/materials';
import { datasetWhere } from '../../src/features/materials/server/datasets';

const mapping = ImportMappingSchema.parse({
  fields: [
    { id: 'sku', label: 'SKU', column: 0, header: 'SKU', kind: 'text' },
    { id: 'price', label: 'Price', column: 1, header: 'price', kind: 'money', currency: 'KZT' },
  ],
  headerRow: 1, headers: ['SKU', 'price'], importMode: 'upsert',
  recordKeySpec: { kind: 'fields', fieldIds: ['sku'], trim: true, caseSensitive: true, confirmed: true },
});

describe('bounded material query AST', () => {
  it('compiles nested predicates to bound parameters without interpolating input', () => {
    const input = DatasetBrowseQuerySchema.parse({
      workspaceId: '1055508f-463f-489a-af19-cb6dcc52d713',
      collectionId: 'a564e8ae-e224-426c-b65d-57887ec922be',
      query: "lamp%' OR true --",
      where: { type: 'group', operator: 'or', children: [
        { type: 'predicate', predicate: { fieldId: 'sku', op: 'eq', value: '001' } },
        { type: 'not', child: { type: 'predicate', predicate: { fieldId: 'price', op: 'lt', value: '10000' } } },
      ] },
    });
    const parameters: unknown[] = ['collection', 1, false];
    const sql = datasetWhere(input, mapping.fields, parameters);
    expect(sql).not.toContain('OR true');
    expect(sql).toContain('ILIKE $4');
    expect(sql).toContain('NOT (');
    expect(parameters).toEqual(['collection', 1, false, "%lamp\\%' OR true --%", 'sku', '001', 'price', '10000']);
  });

  it('rejects excessive nesting and predicate counts without weakening leaf validation', () => {
    let expression: unknown = { type: 'predicate', predicate: { fieldId: 'sku', op: 'eq', value: '001' } };
    for (let index = 0; index < 4; index++) expression = { type: 'not', child: expression };
    expect(DatasetBrowseQuerySchema.safeParse({ workspaceId: '1055508f-463f-489a-af19-cb6dcc52d713', collectionId: 'a564e8ae-e224-426c-b65d-57887ec922be', where: expression }).success).toBe(false);
    expect(DatasetBrowseQuerySchema.safeParse({ workspaceId: '1055508f-463f-489a-af19-cb6dcc52d713', collectionId: 'a564e8ae-e224-426c-b65d-57887ec922be', where: { type: 'predicate', predicate: { fieldId: 'price', op: 'gt', value: undefined } } }).success).toBe(true);
    const parsed = DatasetBrowseQuerySchema.parse({ workspaceId: '1055508f-463f-489a-af19-cb6dcc52d713', collectionId: 'a564e8ae-e224-426c-b65d-57887ec922be', where: { type: 'predicate', predicate: { fieldId: 'price', op: 'gt' } } });
    expect(() => datasetWhere(parsed, mapping.fields, [])).toThrow();
  });
});
